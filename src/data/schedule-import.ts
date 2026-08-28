/**
 * Importing the schedule on the phone itself, when nothing else can.
 *
 * This is the insurance behind failure mode 2 — this project's own hosting
 * stops answering and nobody is left to fix it — and it is deliberately the
 * *last* thing tried, not the first. The published feed is one gzipped file
 * against about 1,100 polite requests, so a copy that can reach its host
 * always should. What follows is the rule for when a copy may go direct
 * instead, and the rule matters more than the code: fifty thousand phones
 * each paging Gen Con's API is a footprint nobody asked for, and a
 * never-firing insurance policy is not insurance.
 *
 * WHY THE DECISION IS ITS OWN FUNCTION. `shouldDeviceImport` is pure and
 * tested exhaustively because both directions fail silently. Too eager, and
 * this app is a swarm on somebody else's server — invisible from here,
 * obvious from there. Too shy, and the one copy that genuinely needed this
 * sits with a schedule three years old and never tries. Neither shows up in
 * a screenshot.
 *
 * NATIVE ONLY, and not by preference: a browser cannot read gencon.com at
 * all (no `Access-Control-Allow-Origin`), so on the web this never runs and
 * the mirror is the last resort instead.
 */

import { importCatalogue, type ImportProgress } from '../lib/import-events';
import { fetchJson } from '../platform/http';
import { isNative } from '../platform';
import { packStore } from '../platform/storage';
import type { ConEvent, EventFeed } from './events';

const STORED = 'events.json';
/** When the last attempt was made, so a failure does not become a loop. */
const ATTEMPTED = 'events-attempted.json';

/** A device import may not run more often than this, however bad things are. */
export const MIN_DAYS_BETWEEN_ATTEMPTS = 1;

/**
 * How stale the schedule in hand must be before going direct is justified.
 *
 * A week, because the published feed refreshes weekly: anything fresher
 * means the ordinary path is working and this would be 1,100 requests to
 * learn what one request already said.
 */
export const STALE_AFTER_DAYS = 7;

export interface ImportDecision {
  /** Whether to import from Gen Con directly, now. */
  go: boolean;
  /** Why not, for a status line a person can read. */
  because: string;
}

export interface ImportCircumstances {
  /** A browser can never do this; see the note above. */
  native: boolean;
  online: boolean;
  /** Age in days of the schedule this copy currently holds, or null for none at all. */
  feedAgeDays: number | null;
  /** Days since this copy last tried, or null if it never has. */
  sinceLastAttemptDays: number | null;
  /** False on a metered connection, where 9 MB is somebody's data allowance. */
  unmetered: boolean;
  /** A person pressed the button, which overrides every rule but the first two. */
  asked?: boolean;
}

/** Whether this copy may import from Gen Con directly, and why not when not. */
export function shouldDeviceImport(now: ImportCircumstances): ImportDecision {
  // The two absolutes. A browser cannot do this at all, and neither can a
  // device with no network — no amount of asking changes either.
  if (!now.native) return { go: false, because: 'only the installed app can read Gen Con directly' };
  if (!now.online) return { go: false, because: 'no network' };

  if (now.asked) return { go: true, because: 'asked for' };

  // Never twice in a day. A failing import that retried on every launch
  // would be the swarm, just spread over a worse day.
  if (now.sinceLastAttemptDays !== null && now.sinceLastAttemptDays < MIN_DAYS_BETWEEN_ATTEMPTS) {
    return { go: false, because: 'already tried today' };
  }

  // No schedule at all is the one case worth spending a metered connection
  // on: an app with no catalogue is not much of a convention app.
  if (now.feedAgeDays === null) return { go: true, because: 'no schedule at all' };

  if (now.feedAgeDays < STALE_AFTER_DAYS) {
    return { go: false, because: 'the schedule in hand is current' };
  }
  if (!now.unmetered) return { go: false, because: 'waiting for wi-fi' };
  return { go: true, because: `the schedule in hand is ${Math.floor(now.feedAgeDays)} days old` };
}

/** Days between an ISO timestamp and now, or null for anything unreadable. */
export function ageInDays(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  return Number.isFinite(then) ? (nowMs - then) / 86_400_000 : null;
}

/** The feed this copy imported for itself, if it has one that still reads. */
export async function storedFeed(): Promise<EventFeed | null> {
  if (!packStore.available()) return null;
  const held = await packStore.read(STORED);
  if (!held) return null;
  try {
    const feed = JSON.parse(held) as EventFeed;
    return Array.isArray(feed?.events) && feed.events.length ? feed : null;
  } catch {
    return null;
  }
}

/** When this copy last tried, whether or not it worked. */
export async function lastAttempt(): Promise<string | null> {
  if (!packStore.available()) return null;
  const held = await packStore.read(ATTEMPTED);
  if (!held) return null;
  try {
    const at = (JSON.parse(held) as { at?: string }).at;
    return typeof at === 'string' ? at : null;
  } catch {
    return null;
  }
}

export interface DeviceImportResult {
  status: 'imported' | 'refused' | 'failed';
  /** What happened, in words a person could be shown. */
  because: string;
  events?: number;
}

/**
 * Import the catalogue straight from Gen Con and keep it.
 *
 * The attempt is recorded *before* the work, so an import that dies
 * half-way still counts as today's try — the alternative is a copy that
 * cannot finish retrying on every launch for ever. Nothing is stored until
 * the whole catalogue is in hand and the importer's own arithmetic has
 * passed, so a part-done pull can never replace a good schedule with a
 * short one.
 */
export async function runDeviceImport(options: {
  circumstances: Omit<ImportCircumstances, 'native'>;
  onProgress?: (progress: ImportProgress) => void;
  signal?: { aborted: boolean };
  nowMs?: number;
}): Promise<DeviceImportResult> {
  const decision = shouldDeviceImport({ ...options.circumstances, native: isNative() });
  if (!decision.go) return { status: 'refused', because: decision.because };

  const at = new Date(options.nowMs ?? Date.now()).toISOString();
  await packStore.write(ATTEMPTED, JSON.stringify({ at }));

  try {
    const { events } = await importCatalogue({
      fetchJson,
      onProgress: options.onProgress,
      signal: options.signal,
    });
    const feed: EventFeed = {
      source: {
        name: 'Gen Con event catalogue, imported on this device',
        url: 'https://www.gencon.com/events',
        fetchedAt: at,
      },
      year: yearOf(events),
      events,
    };
    await packStore.write(STORED, JSON.stringify(feed));
    return { status: 'imported', because: decision.because, events: events.length };
  } catch (error) {
    return {
      status: 'failed',
      because: error instanceof Error ? error.message : 'the import did not finish',
    };
  }
}

/** The convention year a set of events belongs to: the latest one they mention. */
function yearOf(events: ConEvent[]): number | undefined {
  let latest = '';
  for (const event of events) if (event.start > latest) latest = event.start;
  const year = Number(latest.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : undefined;
}
