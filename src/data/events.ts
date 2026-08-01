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

import { ROOMS, type Room } from './venues';

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
  /** Link back to the event on the source site. */
  url?: string;
}

export interface EventFeed {
  source: { name: string; url: string; fetchedAt: string };
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

/** Every string that should resolve to a given room, longest first. */
function matchKeys(room: Room): string[] {
  const keys = new Set<string>();
  for (const value of [room.name, room.shortName, ...(room.aliases ?? [])]) {
    if (value) keys.add(normalise(value));
  }
  return [...keys].sort((a, b) => b.length - a.length);
}

const ROOM_MATCH_KEYS: Array<{ room: Room; keys: string[] }> = ROOMS.map((room) => ({
  room,
  keys: matchKeys(room),
}));

/**
 * Resolves an event to a room on the map.
 *
 * Longer keys are tried first across all rooms so that a specific match
 * ("Exhibit Hall J") always beats a shorter, more generic one ("Hall").
 */
export function roomIdForEvent(event: ConEvent): string | null {
  const haystack = normalise(
    [event.locationText, event.roomText, event.tableText].filter(Boolean).join(' '),
  );
  if (!haystack) return null;

  let best: { roomId: string; length: number } | null = null;
  for (const { room, keys } of ROOM_MATCH_KEYS) {
    for (const key of keys) {
      if (containsPhrase(haystack, key) && (!best || key.length > best.length)) {
        best = { roomId: room.id, length: key.length };
      }
    }
  }
  return best?.roomId ?? null;
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
