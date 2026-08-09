/**
 * The Gen Con schedule, from Gen Con.
 *
 *     node scripts/fetch-events.mjs
 *
 * Writes public/events.json, which is not committed — the deploy builds it.
 *
 * WHY THIS REPLACED A SCRAPER. The schedule used to come from
 * `gencon.eventdb.us`, a third-party site with no API, by fetching one HTML
 * page per event: 27,000 requests, hours of wall clock, a cache and a lock and
 * a resume protocol to make that survivable, and every field recovered by
 * parsing markup somebody else was free to restyle. It worked. It was also the
 * single most fragile thing in this repository, and it was one person's hobby
 * site standing between the app and its entire reason to exist.
 *
 * Gen Con publishes the same catalogue themselves, as JSON, at
 * `/api/event_search`. Every field this app wants is a named field on it —
 * including `location`, `room_name` and `table_number`, which is the whole of
 * what the room matcher needs and which the scraper had to pick back out of a
 * sentence.
 *
 * THE ONE OBSTACLE, and how it is got round. The endpoint pages 25 at a time
 * and stops at page 400 — a 10,000-record window, which is Elasticsearch's
 * default and not something a caller can raise. The catalogue is 27,467.
 *
 * `day[]` slices it, and the slices are exact: 191 + 8,046 + 8,241 + 7,805 +
 * 3,184 = 27,467, which is the number the unsliced query reports for the whole
 * catalogue. So five slices, each comfortably inside the window, add up to
 * everything with nothing double-counted and nothing missed — and that identity
 * is checked on every run rather than assumed, because it is exactly the sort of
 * thing that stops being true when a convention gets bigger.
 *
 * About 1,100 requests, against 27,000.
 */

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'public/events.json');

const SOURCE = {
  name: 'Gen Con event catalogue',
  url: 'https://www.gencon.com/events',
};

const API = 'https://www.gencon.com/api/event_search';
/** Their server. Node's default user-agent is refused. */
const AGENT = 'gen-con-trip/0.1 (personal trip planner; contact via repository)';
/** Between requests. Eleven hundred of them, so be a good guest. */
const PAUSE = 150;
/** What the endpoint returns per page, whatever `per_page` is set to. */
const PER_PAGE = 25;
/** Elasticsearch's default result window. Every slice has to fit inside it. */
const WINDOW = 10_000;

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const PAUSE_MS = Number(value('delay', PAUSE));

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function get(query, tries = 4) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`${API}?${query}`, { headers: { 'User-Agent': AGENT } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt >= tries) throw error;
      // Backing off rather than hammering: a run of eleven hundred requests
      // will meet a blip, and a blip is not a reason to lose the whole pull.
      await wait(500 * 2 ** attempt);
    }
  }
}

/** The days the catalogue is spread over, from the source rather than a guess. */
async function days() {
  const response = await fetch(`${API}/meta_days`, { headers: { 'User-Agent': AGENT } });
  if (!response.ok) throw new Error(`could not read the convention's days: HTTP ${response.status}`);
  const named = await response.json();
  return Object.keys(named).map(Number);
}

/**
 * Gen Con's record for one event, as this app's `ConEvent`.
 *
 * Undefined rather than empty for anything missing, because the feed is a file
 * a phone downloads before it can show a single session and `"tableText":""`
 * 27,000 times is not free.
 */
export function shape(source) {
  const blank = (v) => (v === undefined || v === null || v === '' ? undefined : v);
  const number = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  // Gen Con sends `2026-07-29T09:00:00.000-04:00`. The milliseconds are always
  // zero, they are 220 KB across the catalogue, and this is a file a phone
  // downloads before it can show a single session.
  const when = (v) => (typeof v === 'string' ? v.replace(/\.000(?=[-+Z])/, '') : undefined);
  return {
    // The printed code, which is what the old feed used and what `eventUrl`
    // takes the event's number back off the end of.
    id: blank(source.game_code) ?? String(source.id),
    title: source.title,
    // `event_type` arrives as "BGM - Board Game", and the app wants the code.
    type: blank(String(source.event_type ?? '').split(' - ')[0]),
    gameSystem: blank(source.game_system),
    locationText: blank(source.location) ?? '',
    roomText: blank(source.room_name),
    tableText: blank(String(source.table_number ?? '')),
    start: when(source.start_date),
    end: when(blank(source.end_date)),
    durationMinutes: number(source.event_duration) ? number(source.event_duration) * 60 : undefined,
    cost: number(source.event_cost),
    ticketsAvailable: number(source.tickets_available),
    ageRequirement: blank(source.age_requirement_short),
  };
}

/**
 * The feed, as columns with the repetition taken out.
 *
 * A schedule written as 27,467 objects is mostly the same few strings over and
 * over: five distinct age requirements cost 0.85 MB, 22 buildings cost 0.62 MB,
 * and the 1,076 distinct start times cost 0.99 MB because each is written out
 * as a 25-character timestamp every time it occurs. The field *names* are
 * repeated 27,467 times too.
 *
 * So each repetitive field becomes a table of its distinct values and a column
 * of indexes into it, and each non-repetitive one becomes a plain column. That
 * is 8.87 MB down to 2.03 MB on disk and 0.99 MB down to 0.48 MB over the wire.
 * The remaining 0.80 MB is the titles, which are nearly all distinct and are
 * the actual payload — this is close to the floor without dropping information.
 *
 * Worth it because the file is stored on a phone, and downloaded over
 * convention wifi, which is the worst network anybody will use this on.
 *
 * `expandFeed` in `src/data/events.ts` is the other half, and reads both this
 * and the old shape — a phone with the old one cached must keep working.
 */
function pack(events, source) {
  const DICT = ['idPrefix', 'type', 'gameSystem', 'locationText', 'roomText', 'tableText', 'start', 'end', 'ageRequirement', 'durationMinutes'];
  const of = (event, field) => (field === 'idPrefix' ? event.id.replace(/[0-9]+$/, '') : event[field]);
  const keys = {};
  const lookup = {};
  for (const field of DICT) {
    const seen = [...new Set(events.map((e) => of(e, field)).filter((v) => v !== undefined && v !== ''))].sort();
    keys[field] = seen;
    lookup[field] = new Map(seen.map((v, i) => [v, i]));
  }
  const column = (field) => events.map((e) => {
    const value = of(e, field);
    return value === undefined || value === '' ? -1 : lookup[field].get(value);
  });
  return {
    // Named so the reader can tell the two apart without guessing, and so a
    // third shape later is a version bump rather than an archaeology problem.
    format: 'columns-1',
    source,
    year: Number(events[0].start.slice(0, 4)),
    count: events.length,
    keys,
    columns: {
      ...Object.fromEntries(DICT.map((field) => [field, column(field)])),
      // The number off the end of the id; its prefix is in the dictionary.
      idNumber: events.map((e) => Number(/[0-9]+$/.exec(e.id)?.[0] ?? 0)),
      title: events.map((e) => e.title),
      cost: events.map((e) => e.cost ?? null),
      ticketsAvailable: events.map((e) => e.ticketsAvailable ?? null),
    },
  };
}

async function main() {
  const started = Date.now();
  const whole = await get('page=1');
  const expected = whole.total_count;
  if (!expected) throw new Error('the catalogue reported no events at all');
  console.log(`the catalogue reports ${expected.toLocaleString('en')} events`);

  const spread = await days();
  console.log(`spread over ${spread.length} days: ${spread.join(', ')}`);

  const events = [];
  const seen = new Set();
  let counted = 0;
  for (const day of spread) {
    const first = await get(`day[]=${day}&page=1`);
    const total = first.total_count;
    counted += total;
    if (total >= WINDOW) {
      throw new Error(
        `day ${day} has ${total} events, which is at or past the ${WINDOW} the endpoint will page through. `
        + 'Slicing by day alone is no longer enough — partition further, by event type as well.',
      );
    }
    const pages = Math.ceil(total / PER_PAGE);
    for (let page = 1; page <= pages; page += 1) {
      const body = page === 1 ? first : await get(`day[]=${day}&page=${page}`);
      for (const record of body.records ?? []) {
        const event = shape(record._source);
        // A day boundary is a start time, so nothing should appear twice — but
        // this is cheap and the alternative is silently double-counting.
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        events.push(event);
      }
      if (page > 1) await wait(PAUSE_MS);
      if (page % 40 === 0) console.log(`  day ${day}: ${page}/${pages} pages`);
    }
    console.log(`  day ${day}: ${total.toLocaleString('en')} events`);
  }

  // The identity the whole method rests on. If the slices ever stop adding up
  // to the whole, this is quietly returning a partial schedule, and a partial
  // schedule looks exactly like a complete one.
  if (counted !== expected) {
    throw new Error(
      `the days add up to ${counted} but the catalogue reports ${expected}. `
      + 'The day slices no longer partition it, so this pull would be missing events.',
    );
  }

  const usable = events.filter((event) => event && event.title && event.start);
  if (!usable.length) throw new Error('no event had both a title and a start time');
  if (usable.length < expected * 0.98) {
    throw new Error(`only ${usable.length} of ${expected} events came back usable; refusing to write a short schedule`);
  }

  usable.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  const feed = pack(usable, { ...SOURCE, fetchedAt: new Date().toISOString() });

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(feed)}\n`);
  const megabytes = ((await stat(OUTPUT)).size / 1024 / 1024).toFixed(1);
  console.log(
    `\nWrote ${usable.length.toLocaleString('en')} events to ${OUTPUT} (${megabytes} MB, columns-1) `
    + `in ${((Date.now() - started) / 1000).toFixed(0)}s`,
  );
}

// Only when run, not when imported for its `shape` — which is the one piece
// here worth testing and the one piece that has no network in it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
