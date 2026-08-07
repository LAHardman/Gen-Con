/**
 * Event schedule data and the machinery that ties it to rooms on the map.
 *
 * Events are loaded at runtime from `public/events.json`, which is produced by
 * `npm run fetch:events` from the third-party Gen Con event database at
 * https://gencon.eventdb.us/. Two reasons the app reads a generated file rather
 * than calling that site directly:
 *
 *  - A browser cannot fetch it cross-origin; the site is not set up to allow it.
 *  - Convention centre Wi-Fi is famously bad, and a file that ships with the app
 *    keeps the schedule working when the network doesn't.
 */

import { ROOMS, VENUES, type Room, type Venue } from './venues';
import { boothIn, hallForBooth } from './booths';

export interface ConEvent {
  id: string;
  title: string;
  /** Event type as the source lists it: RPG, BGM, TCG, SEM, ENT… */
  type?: string;
  gameSystem?: string;
  /** The raw location text from the source, kept for display and debugging. */
  locationText: string;
  /** Room/table detail within the location, when the source separates it. */
  roomText?: string;
  tableText?: string;
  /** ISO 8601 timestamps. */
  start: string;
  end?: string;
  durationMinutes?: number;
  cost?: number;
  ticketsAvailable?: number;
  ageRequirement?: string;
  /**
   * Link back to the event on the source site.
   *
   * Absent from the generated feed, and derived by `eventUrl` instead — it is
   * the same 30 characters in front of a number the `id` already carries, and
   * 27,467 copies of it were 93 KB gzipped on a file a phone fetches before it
   * can show a single session. Kept on the type because an event from anywhere
   * else may still carry one.
   */
  url?: string;
}

export interface EventFeed {
  source: {
    name: string;
    url: string;
    /** When `fetch:events` produced this file. */
    fetchedAt: string;
    /**
     * When the source itself said it last rebuilt from its spreadsheet, and the
     * change set that was current then. The importer stores the same pair and
     * compares them on the next run to decide what needs re-reading.
     */
    sourceUpdatedAt?: string;
    changeSet?: number;
  };
  year?: number;
  events: ConEvent[];
}

/* ------------------------------------------------------------------ matching */

/** Lowercases and strips punctuation so location strings compare sensibly. */
function normalise(text: string) {
  return text
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Matches `needle` only at token boundaries, so "201" doesn't match "2010". */
function containsPhrase(haystack: string, needle: string) {
  if (needle.length === 0) return false;
  const index = haystack.indexOf(needle);
  if (index === -1) return false;
  const before = index === 0 ? ' ' : haystack[index - 1];
  const afterIndex = index + needle.length;
  const after = afterIndex >= haystack.length ? ' ' : haystack[afterIndex];
  return before === ' ' && after === ' ';
}

/** Every string that should resolve to a given room or venue, longest first. */
function matchKeys(subject: Room | Venue): string[] {
  const keys = new Set<string>();
  for (const value of [subject.name, subject.shortName, ...(subject.aliases ?? [])]) {
    if (value) keys.add(normalise(value));
  }
  return [...keys].sort((a, b) => b.length - a.length);
}

interface Candidate<T> {
  subject: T;
  keys: string[];
}

/** Built once at module load: matching runs per event, over tens of thousands. */
const VENUE_CANDIDATES: Array<Candidate<Venue>> = VENUES.map((venue) => ({
  subject: venue,
  keys: matchKeys(venue),
}));

const ROOM_CANDIDATES: Array<Candidate<Room>> = ROOMS.map((room) => ({
  subject: room,
  keys: matchKeys(room),
}));

const ROOM_CANDIDATES_BY_VENUE = ROOM_CANDIDATES.reduce((map, candidate) => {
  const list = map.get(candidate.subject.venueId);
  if (list) list.push(candidate);
  else map.set(candidate.subject.venueId, [candidate]);
  return map;
}, new Map<string, Array<Candidate<Room>>>());

/**
 * The rooms an unrecognised `Location` may still match: those that stand for a
 * whole building, whose aliases are that building's own names and street
 * address.
 *
 * Searching every room instead is actively harmful, because room names recur
 * across the campus — which is the whole reason matching resolves the venue
 * first. An event at "416 Wabash", five blocks east of the convention centre,
 * landed in the convention centre's Wabash Ballroom on the strength of the
 * word "Wabash", and nothing about the result said it was a guess. Leaving it
 * unmatched puts it in the console report instead, which is where a location
 * the map doesn't know belongs.
 */
const WHOLE_VENUE_CANDIDATES = ROOM_CANDIDATES.filter(({ subject }) => subject.fillsVenue);

/** The longest key that `haystack` contains, across the given candidates. */
function bestMatch<T extends { id: string }>(
  haystack: string,
  candidates: Array<Candidate<T>>,
): T | null {
  let best: { subject: T; length: number } | null = null;
  for (const { subject, keys } of candidates) {
    for (const key of keys) {
      if (containsPhrase(haystack, key) && (!best || key.length > best.length)) {
        best = { subject, length: key.length };
      }
    }
  }
  return best?.subject ?? null;
}

/** Resolves an event's `Location` text to a venue on the map. */
export function venueIdForEvent(event: ConEvent): string | null {
  const haystack = normalise(event.locationText);
  if (!haystack) return null;
  return bestMatch(haystack, VENUE_CANDIDATES)?.id ?? null;
}

/**
 * Resolves an event to a room on the map.
 *
 * The source separates where from what: `Location` names the building ("ICC",
 * "JW", "Stadium") and `Room` names the space inside it. Resolving the venue
 * first and only then looking at its own rooms is what keeps the JW Marriott's
 * room 103 apart from the convention center's — both buildings number their
 * meeting rooms the same way, and a single flat search cannot tell them apart.
 *
 * Within a venue, longer keys win, so a specific match ("Exhibit Hall J")
 * always beats a shorter, more generic one ("Hall"). A venue whose interior
 * isn't broken out on the map resolves to its single room, so its events still
 * land on the right building.
 *
 * A booth number is the one thing here that names a room without naming it.
 * `Exhibit Hall Booth #1229` says nothing a key could match — the convention
 * centre has eleven exhibit halls and the text picks none of them — but the
 * number itself does, once you know where the air walls are (`booths.ts`).
 * Tried after the text, so a row that names its hall outright is still read
 * that way: `Exhibit Hall J : Booth #174` is J because it says J.
 */
export function roomIdForEvent(event: ConEvent): string | null {
  const venueId = venueIdForEvent(event);
  const candidates = venueId
    ? (ROOM_CANDIDATES_BY_VENUE.get(venueId) ?? [])
    : WHOLE_VENUE_CANDIDATES;

  const within = normalise([event.roomText, event.tableText].filter(Boolean).join(' '));
  const matched = within ? bestMatch(within, candidates) : null;
  if (matched) return matched.id;

  // A stand in the exhibit hall, which only its number places.
  if (venueId === 'icc') {
    const hall = hallForBooth(boothIn([event.roomText, event.tableText].filter(Boolean).join(' ')));
    if (hall) return hall;
  }

  // Nothing inside the building matched: fall back to the building itself when
  // the map draws it as one room, and otherwise leave the event unmatched so
  // the console report picks it up.
  if (candidates.length === 1) return candidates[0].subject.id;
  if (venueId) return null;

  // No venue either — try the whole location string, still only against the
  // buildings drawn as one room, since one of them may be named or addressed
  // in the `Location` field rather than the `Room` one.
  const haystack = normalise([event.locationText, event.roomText].filter(Boolean).join(' '));
  return haystack ? (bestMatch(haystack, candidates)?.id ?? null) : null;
}

export interface EventIndex {
  /** Events per room id, each list sorted by start time. */
  byRoom: Map<string, ConEvent[]>;
  /** Events whose location didn't resolve to any room on the map. */
  unmatched: ConEvent[];
  /** Distinct days that have events, as YYYY-MM-DD in convention local time. */
  days: string[];
  total: number;
}

export function indexEvents(events: ConEvent[]): EventIndex {
  const byRoom = new Map<string, ConEvent[]>();
  const unmatched: ConEvent[] = [];
  const days = new Set<string>();

  for (const event of events) {
    if (Number.isNaN(Date.parse(event.start))) continue;
    days.add(dayKey(event.start));

    const roomId = roomIdForEvent(event);
    if (!roomId) {
      unmatched.push(event);
      continue;
    }
    const list = byRoom.get(roomId);
    if (list) list.push(event);
    else byRoom.set(roomId, [event]);
  }

  for (const list of byRoom.values()) {
    list.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  }

  return {
    byRoom,
    unmatched,
    days: [...days].sort(),
    total: events.length,
  };
}

/* ------------------------------------------------------------------ schedule */

export function dayKey(iso: string) {
  // Slice rather than use Date, so the day is the one in the timestamp's own
  // offset (convention local time) rather than the viewer's time zone.
  return iso.slice(0, 10);
}

export function eventEndMs(event: ConEvent) {
  const start = Date.parse(event.start);
  if (event.end && !Number.isNaN(Date.parse(event.end))) return Date.parse(event.end);
  const minutes = event.durationMinutes ?? 60;
  return start + minutes * 60_000;
}

export function isHappeningAt(event: ConEvent, atMs: number) {
  return Date.parse(event.start) <= atMs && atMs < eventEndMs(event);
}

export interface RoomSchedule {
  now: ConEvent[];
  upcoming: ConEvent[];
  earlier: ConEvent[];
}

/** Splits a room's day of events into what's on now, still to come, and done. */
export function scheduleForDay(events: ConEvent[], day: string, atMs: number): RoomSchedule {
  const onDay = events.filter((event) => dayKey(event.start) === day);
  return {
    now: onDay.filter((event) => isHappeningAt(event, atMs)),
    upcoming: onDay.filter((event) => Date.parse(event.start) > atMs),
    earlier: onDay.filter((event) => eventEndMs(event) <= atMs),
  };
}

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * The event's page on Gen Con's site.
 *
 * Derived rather than carried. Every id is a category, a two-digit year, a
 * couple of letters and then the event number the URL ends with — `BGM26ND306429`
 * is `gencon.com/events/306429` — so shipping the URL as well was 27,467 copies
 * of the same thirty characters, 93 KB gzipped, on the file that has to arrive
 * before the app can show anything.
 *
 * An event that carries its own URL keeps it, so a feed from somewhere else, or
 * an older one still on somebody's phone, is unaffected. An id that does not
 * end in a number gets no link rather than a wrong one.
 */
export function eventUrl(event: ConEvent): string | undefined {
  if (event.url) return event.url;
  const number = /([0-9]+)$/.exec(event.id)?.[1];
  return number ? `https://www.gencon.com/events/${number}` : undefined;
}

/** Formats a timestamp in the convention's own local time, not the viewer's. */
export function formatTime(iso: string) {
  const offsetMatch = iso.match(/([+-]\d{2}):?(\d{2})$/);
  if (offsetMatch) {
    // Shift into UTC by the timestamp's own offset, then format as UTC so the
    // clock time shown is the one attendees will see on site.
    const offsetMinutes = Number(offsetMatch[1]) * 60 + Math.sign(Number(offsetMatch[1])) * Number(offsetMatch[2]);
    const shifted = new Date(Date.parse(iso) + offsetMinutes * 60_000);
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(shifted);
  }
  return TIME_FORMAT.format(new Date(iso));
}

export function formatDayLabel(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatTimeRange(event: ConEvent) {
  const start = formatTime(event.start);
  if (!event.end) return start;
  return `${start} – ${formatTime(event.end)}`;
}
