/**
 * Somebody's own schedule: what they mean to be at, and whether they can get
 * from each one to the next.
 *
 * WHAT IS SAVED IS A COPY, NOT A REFERENCE. An entry carries the event's title,
 * times and place rather than only its id. That is deliberate and it is the
 * whole reason this file has a shape of its own:
 *
 *   - The feed is 27,467 events and is fetched. A saved plan has to render
 *     before it arrives, and on a phone in an exhibit hall with no signal it
 *     has to render whether it arrives or not.
 *   - Gen Con moves events. An id that no longer resolves would silently empty
 *     somebody's Saturday; a copy still shows what they planned, and the
 *     room-check that already exists is what tells them it moved.
 *   - Next year's feed reuses neither the ids nor the days, and a plan from
 *     last year should read as history rather than as corruption.
 *
 * The room *id* is kept alongside the copy, because that is the key into the
 * distance table and into the map. Where the room still exists its current
 * name is preferred over the snapshot; where it does not, the snapshot is all
 * there is, and it is better than a blank.
 *
 * NOTHING HERE TOUCHES STORAGE OR REACT. `usePlan` does that; this is the part
 * that can be tested by calling it.
 */

import { dayKey, eventEndMs, type ConEvent } from './events';
import { roughMinutes, type Spot } from './nearby';
import { ROOMS_BY_ID, VENUES_BY_ID } from './venues';
import type { Pin } from './offsite';

export interface PlanEntry {
  /** The event's own id, which is also what stops it being added twice. */
  id: string;
  title: string;
  /** ISO 8601, carrying the convention's offset — see `offsetMinutesOf`. */
  start: string;
  end?: string;
  durationMinutes?: number;
  /** The room it is in, where it is in one. The key into the distance table. */
  roomId?: string;
  /** Where it is when it is not in a room: an address, a park, a restaurant. */
  at?: { lat: number; lng: number };
  /** What to print for the place, as it read when this was added. */
  where: string;
}

/** What to call where an event is, given whatever the app knows about it. */
export function placeLabelFor(event: ConEvent, room?: { id: string }, pin?: Pin): string {
  if (pin) return pin.name;
  const known = room ? ROOMS_BY_ID[room.id] : undefined;
  if (known) {
    const venue = VENUES_BY_ID[known.venueId];
    return [known.shortName ?? known.name, venue?.shortName ?? venue?.name].filter(Boolean).join(' · ');
  }
  return [event.locationText, event.roomText].filter(Boolean).join(' · ') || 'Location not given';
}

/** An event as a plan holds it. */
export function planEntry(event: ConEvent, room?: { id: string }, pin?: Pin): PlanEntry {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    durationMinutes: event.durationMinutes,
    roomId: room?.id,
    at: pin ? { lat: pin.lat, lng: pin.lng } : undefined,
    where: placeLabelFor(event, room, pin),
  };
}

/** Where an entry is now, preferring the live room over the saved label. */
export function entryWhere(entry: PlanEntry): string {
  const room = entry.roomId ? ROOMS_BY_ID[entry.roomId] : undefined;
  if (!room) return entry.where;
  const venue = VENUES_BY_ID[room.venueId];
  return [room.shortName ?? room.name, venue?.shortName ?? venue?.name].filter(Boolean).join(' · ');
}

/** An entry as the distance table wants it. */
export function entrySpot(entry: PlanEntry): Spot {
  return { roomId: entry.roomId, at: entry.at };
}

export function entryEndMs(entry: PlanEntry): number {
  return eventEndMs(entry as ConEvent & PlanEntry);
}

/* ------------------------------------------------------------------- days */

/**
 * The convention proper is Thursday to Sunday.
 *
 * Wednesday is Trade Day — 191 events against Thursday's 8,046 — and it is not
 * what somebody means by "the four days". Read off the weekday rather than
 * written down as dates, because the dates move every year and the weekdays
 * never have.
 *
 * `T12:00:00Z` rather than midnight so that reading the weekday cannot be
 * knocked into the day before by anybody's offset.
 */
const THURSDAY_TO_SUNDAY = new Set([4, 5, 6, 0]);

export function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/** Whether a day is one of the four the schedule can show. */
export function isConventionDay(day: string): boolean {
  return THURSDAY_TO_SUNDAY.has(weekdayOf(day));
}

/**
 * The four days to show, from whatever days the feed and the plan know about.
 *
 * Both sources, because either can be the only one there is: a plan saved last
 * year outlives the feed that made it, and a feed just fetched has days nobody
 * has planned anything on yet.
 */
export function conventionDays(feedDays: readonly string[], entries: readonly PlanEntry[]): string[] {
  const days = new Set<string>(feedDays);
  for (const entry of entries) days.add(dayKey(entry.start));
  return [...days].filter(isConventionDay).sort();
}

/** "Thursday", in the viewer's language. */
export function dayName(day: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

/* --------------------------------------------------------------- the day */

export interface PlannedItem {
  entry: PlanEntry;
  startMs: number;
  endMs: number;
  /**
   * Minutes to walk here from the entry before it, or null when there is no
   * entry before it and so nothing to walk from.
   */
  travelMinutes: number | null;
  /** When the walk has to start to arrive on time. Null with no walk. */
  leaveByMs: number | null;
  /**
   * The walk does not fit: the previous event is still running when you would
   * have to leave for this one. Worth saying rather than drawing a block that
   * silently overlaps.
   */
  clash: boolean;
}

/**
 * One day of a plan, in order, with the walk between each pair worked out.
 *
 * The travel time is `nearby`'s estimate — the table plus its extra minute —
 * which is the same number the search results show. It is not the router's
 * answer and does not pretend to be: this is a page that can hold a dozen
 * entries and re-render on every tick of the clock, and a dozen real routes is
 * a second and a half of work each time.
 */
export function planDay(entries: readonly PlanEntry[], day: string): PlannedItem[] {
  const onDay = entries
    .filter((entry) => dayKey(entry.start) === day)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title));

  return onDay.map((entry, index) => {
    const previous = index > 0 ? onDay[index - 1] : null;
    const startMs = Date.parse(entry.start);
    const travelMinutes = previous ? roughMinutes(entrySpot(previous), entrySpot(entry)) : null;
    const leaveByMs = travelMinutes === null ? null : startMs - travelMinutes * 60_000;
    return {
      entry,
      startMs,
      endMs: entryEndMs(entry),
      travelMinutes,
      leaveByMs,
      clash: !!previous && leaveByMs !== null && leaveByMs < entryEndMs(previous),
    };
  });
}

/* ------------------------------------------------------------- the ruler */

export interface DayAxis {
  fromMs: number;
  toMs: number;
  minutes: number;
  /** Every hour boundary inside the span, for the ruler down the side. */
  hours: number[];
}

/** An hour of margin, so the first block is not jammed against the top. */
const MARGIN_MINUTES = 30;
const HOUR = 3_600_000;

/**
 * The span of clock time a day's column has to cover.
 *
 * `now` is folded in when it falls on the day being drawn, because the marker
 * for it has to have somewhere to sit: a Saturday whose only entry is at nine
 * in the morning still has to show a line at four in the afternoon, otherwise
 * the mark is either off the end of the ruler or silently absent.
 */
export function dayAxis(items: readonly PlannedItem[], nowMs: number | null): DayAxis | null {
  if (!items.length) return null;
  const starts = items.map((item) => item.leaveByMs ?? item.startMs);
  let fromMs = Math.min(...starts) - MARGIN_MINUTES * 60_000;
  let toMs = Math.max(...items.map((item) => item.endMs)) + MARGIN_MINUTES * 60_000;
  if (nowMs !== null) {
    fromMs = Math.min(fromMs, nowMs - MARGIN_MINUTES * 60_000);
    toMs = Math.max(toMs, nowMs + MARGIN_MINUTES * 60_000);
  }
  // Out to whole hours, so the ruler's labels land on its own edges.
  fromMs = Math.floor(fromMs / HOUR) * HOUR;
  toMs = Math.ceil(toMs / HOUR) * HOUR;

  const hours: number[] = [];
  for (let at = fromMs; at <= toMs; at += HOUR) hours.push(at);
  return { fromMs, toMs, minutes: (toMs - fromMs) / 60_000, hours };
}
