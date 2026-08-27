/**
 * Importing Gen Con's catalogue — the one implementation, for both callers.
 *
 * `scripts/fetch-events.mjs` runs this on a build machine and writes
 * `events.json`; a native shell runs the identical code on the phone when
 * this project's own hosting can no longer answer. Two callers, one
 * implementation, because the alternative is two importers that agree until
 * the day they quietly don't — and the failure they would share is the
 * quiet one: a feed of exactly the right length in which nothing can be
 * found. (Node strips the types and Vite compiles them, so both really do
 * run these lines.)
 *
 * THE OBSTACLE, and how it is got round. The endpoint pages 25 at a time
 * and stops at page 400 — a 10,000-record window, which is Elasticsearch's
 * default and not something a caller can raise. The catalogue is 27,467.
 * `day[]` slices it, and the slices are exact: five days that add up to
 * everything with nothing double-counted. That identity is checked on every
 * run rather than assumed, because it is exactly the sort of thing that
 * stops being true when a convention gets bigger — and a partial schedule
 * looks precisely like a complete one.
 *
 * WHY A PHONE MAY DO THIS AT ALL. A browser cannot: gencon.com sends no
 * `Access-Control-Allow-Origin`. A native request leaves from native code,
 * where that does not apply. It is about 1,100 requests at a polite pace,
 * so it is the *insurance*, not the ordinary path — see `deviceImport` in
 * `src/data/schedule-import.ts` for the rules about when it is allowed to
 * run at all.
 */

import type { ConEvent } from '../data/events';

/** Gen Con's own catalogue endpoint. */
export const CATALOGUE_API = 'https://www.gencon.com/api/event_search';

/** Their server. Node's default user-agent is refused. */
export const AGENT = 'gen-con-trip/0.1 (personal trip planner; contact via repository)';

/** What the endpoint returns per page, whatever `per_page` is set to. */
export const PER_PAGE = 25;

/** Elasticsearch's default result window. Every slice has to fit inside it. */
export const WINDOW = 10_000;

/** Between requests. Eleven hundred of them, so be a good guest. */
export const PAUSE_MS = 150;

/** Fetches a URL and parses JSON. Throws where the request could not be made. */
export type Fetcher = (url: string) => Promise<{ status: number; body: unknown }>;

export interface ImportProgress {
  /** How many of the catalogue's events are in hand. */
  got: number;
  /** How many it says there are, once the first page has been read. */
  expected: number;
  /** The day slice being read, for a caller that wants to name it. */
  day: number | null;
}

export interface ImportOptions {
  fetchJson: Fetcher;
  /** Called as pages land, for a progress bar. */
  onProgress?: (progress: ImportProgress) => void;
  /** Milliseconds between requests. Their server is not ours. */
  pauseMs?: number;
  /** Stops the import between requests. A part-done import is discarded. */
  signal?: { aborted: boolean };
  /** Overridable so a test can drive this without a clock. */
  wait?: (ms: number) => Promise<void>;
}

/**
 * Gen Con's record for one event, as this app's `ConEvent`.
 *
 * Undefined rather than empty for anything missing, because the feed is a
 * file a phone downloads before it can show a single session and
 * `"tableText":""` 27,000 times is not free.
 */
export function shape(source: Record<string, unknown>): ConEvent {
  const blank = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : v);
  const number = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  // Gen Con sends `2026-07-29T09:00:00.000-04:00`. The milliseconds are always
  // zero, they are 220 KB across the catalogue, and this is a file a phone
  // downloads before it can show a single session.
  const when = (v: unknown) =>
    typeof v === 'string' ? v.replace(/\.000(?=[-+Z])/, '') : undefined;
  const duration = number(source.event_duration);
  return {
    // The printed code, which is what the old feed used and what `eventUrl`
    // takes the event's number back off the end of.
    id: (blank(source.game_code) as string | undefined) ?? String(source.id),
    title: source.title as string,
    // `event_type` arrives as "BGM - Board Game", and the app wants the code.
    type: blank(String(source.event_type ?? '').split(' - ')[0]) as string | undefined,
    gameSystem: blank(source.game_system) as string | undefined,
    locationText: (blank(source.location) as string | undefined) ?? '',
    roomText: blank(source.room_name) as string | undefined,
    tableText: blank(String(source.table_number ?? '')) as string | undefined,
    start: when(source.start_date) as string,
    end: when(blank(source.end_date)),
    durationMinutes: duration ? duration * 60 : undefined,
    cost: number(source.event_cost),
    ticketsAvailable: number(source.tickets_available),
    ageRequirement: blank(source.age_requirement_short) as string | undefined,
  };
}

interface Page {
  total_count?: number;
  records?: Array<{ _source?: Record<string, unknown> }>;
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** An abort between requests, as a distinguishable error. */
export class ImportAborted extends Error {
  constructor() {
    super('the import was stopped');
    this.name = 'ImportAborted';
  }
}

/**
 * Every event in the catalogue, or a thrown error saying why not.
 *
 * Refusing beats returning less than everything: this answer either
 * replaces a schedule wholesale or is discarded, and a short one that looks
 * complete is the single worst thing this could produce.
 */
export async function importCatalogue(options: ImportOptions): Promise<{
  events: ConEvent[];
  expected: number;
}> {
  const { fetchJson, onProgress, pauseMs = PAUSE_MS, signal, wait = sleep } = options;

  const stopIfAsked = () => {
    if (signal?.aborted) throw new ImportAborted();
  };

  const get = async (query: string): Promise<Page> => {
    stopIfAsked();
    const { status, body } = await fetchJson(`${CATALOGUE_API}?${query}`);
    if (status !== 200) throw new Error(`the catalogue answered HTTP ${status}`);
    if (!body || typeof body !== 'object') throw new Error('the catalogue answered with no records');
    return body as Page;
  };

  const whole = await get('page=1');
  const expected = whole.total_count ?? 0;
  if (!expected) throw new Error('the catalogue reported no events at all');

  const meta = await fetchJson(`${CATALOGUE_API}/meta_days`);
  if (meta.status !== 200 || !meta.body || typeof meta.body !== 'object') {
    throw new Error(`could not read the convention's days: HTTP ${meta.status}`);
  }
  const spread = Object.keys(meta.body as Record<string, unknown>).map(Number);
  if (!spread.length) throw new Error('the catalogue names no days to slice by');

  const events: ConEvent[] = [];
  const seen = new Set<string>();
  let counted = 0;

  for (const day of spread) {
    const first = await get(`day[]=${day}&page=1`);
    const total = first.total_count ?? 0;
    counted += total;
    if (total >= WINDOW) {
      throw new Error(
        `day ${day} has ${total} events, which is at or past the ${WINDOW} the endpoint will page through. ` +
          'Slicing by day alone is no longer enough — partition further, by event type as well.',
      );
    }
    const pages = Math.ceil(total / PER_PAGE);
    for (let page = 1; page <= pages; page += 1) {
      const body = page === 1 ? first : await get(`day[]=${day}&page=${page}`);
      for (const record of body.records ?? []) {
        if (!record?._source) continue;
        const event = shape(record._source);
        // A day boundary is a start time, so nothing should appear twice — but
        // this is cheap and the alternative is silently double-counting.
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        events.push(event);
      }
      onProgress?.({ got: events.length, expected, day });
      if (page < pages) await wait(pauseMs);
    }
  }

  // The identity the whole method rests on. If the slices ever stop adding up
  // to the whole, this is quietly returning a partial schedule, and a partial
  // schedule looks exactly like a complete one.
  if (counted !== expected) {
    throw new Error(
      `the days add up to ${counted} but the catalogue reports ${expected}. ` +
        'The day slices no longer partition it, so this pull would be missing events.',
    );
  }

  const usable = events.filter((event) => event && event.title && event.start);
  if (!usable.length) throw new Error('no event had both a title and a start time');
  if (usable.length < expected * 0.98) {
    throw new Error(
      `only ${usable.length} of ${expected} events came back usable; refusing to write a short schedule`,
    );
  }

  usable.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  return { events: usable, expected };
}
