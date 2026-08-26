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

import { dayKey, eventEndMs, offsetMinutesOf, type ConEvent } from './events';
import { roughMinutes, type Spot } from './nearby';
import { ROOMS_BY_ID, VENUES_BY_ID } from './venues';
import type { Pin } from './offsite';

/**
 * What a plan entry is.
 *
 * A **session** has its times from the feed and nobody chooses them. A **stop**
 * is a food truck, a stand or a room that somebody has decided to spend twenty
 * minutes at, and its times exist only because they typed them. Everything
 * downstream — the walk to it, the block on the day, the clash with the thing
 * before — treats the two identically, which is the point: getting from a
 * seminar to a taco truck costs exactly what getting from a seminar to another
 * seminar costs.
 *
 * Absent means `event`, so a plan saved before stops existed still reads.
 */
export type EntryKind = 'event' | 'stop';

export interface PlanEntry {
  /** The event's own id, which is also what stops it being added twice. */
  id: string;
  /** What sort of thing this is. Absent is an event, for plans saved before. */
  kind?: EntryKind;
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
  /**
   * What a ticket costs, in whole dollars, as the feed priced it.
   *
   * A copy, like everything else here, and for the sharper version of the same
   * reason: the budget adds these up, and a number that re-read itself from a
   * feed fetched an hour ago would change a total somebody had already
   * reconciled against their card. Most events have none — the exhibit hall,
   * the anime room, half the seminars are free — and **absent is not zero**.
   * Absent is "nobody said", which the budget leaves out rather than pricing
   * at nothing.
   */
  cost?: number;
  /**
   * The event's own description, kept once it has been fetched.
   *
   * Saved rather than re-fetched because a plan is what you read *at* the
   * convention, and the exhibit hall is the worst signal on the campus. The
   * feed cannot carry these — a paragraph each across 27,467 events is several
   * megabytes — but a dozen of them for the events somebody actually chose is a
   * few kilobytes, and it is the difference between a schedule that works
   * underground and one that does not.
   */
  description?: string;
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
    cost: event.cost,
  };
}

/* ------------------------------------------------------------------ stops */

/**
 * Somewhere to be, that is not a session.
 *
 * A food truck, a stand, a hall. It has a place and a name and no times at all
 * — the times are the whole of what somebody adds when they add one.
 */
export interface Stop {
  /**
   * Stable across renders and reloads, and unique to the *thing*: `vendor:14179`
   * for an exhibitor, `place:hall-a` for a room. Not the entry's id — see below.
   */
  key: string;
  title: string;
  /** What to print for the place, as it read when this was added. */
  where: string;
  roomId?: string;
  at?: { lat: number; lng: number };
}

/** Half an hour, which is a queue and a taco. */
export const STOP_MINUTES = 30;

/** When to suggest a stop starts, with nothing else to go on. */
export const NOON = 12 * 60;

/**
 * A stop as a plan holds it.
 *
 * THE ID CARRIES THE TIME, and that is deliberate: breakfast and dinner at the
 * same truck are two different commitments on two different parts of the day,
 * and an id that was only the truck would make the second one overwrite the
 * first. Adding the same place at the same minute twice still collapses, which
 * is the behaviour a double-tap should have.
 *
 * AN END BEFORE ITS START IS THE NEXT MORNING. `<input type="time">` gives back
 * a clock and a clock has no date on it, so 11pm to half past midnight arrives
 * as 1380 → 30. Rolling it forward is what somebody typing it means; refusing it
 * would be refusing the one span most likely to be typed at a beer garden.
 */
export function stopEntry(
  stop: Stop,
  when: { day: string; fromMinutes: number; toMinutes: number; offsetMinutes: number },
): PlanEntry {
  const { day, fromMinutes, offsetMinutes } = when;
  const toMinutes = when.toMinutes > fromMinutes ? when.toMinutes : when.toMinutes + 1440;
  return {
    id: `${stop.key}@${day}T${String(Math.floor(fromMinutes / 60)).padStart(2, '0')}:${String(fromMinutes % 60).padStart(2, '0')}`,
    kind: 'stop',
    title: stop.title,
    start: isoAt(day, fromMinutes, offsetMinutes),
    end: isoAt(day, toMinutes, offsetMinutes),
    roomId: stop.roomId,
    at: stop.at,
    where: stop.where,
  };
}

/** A clock time on a day, written the way the feed writes its timestamps. */
export function isoAt(day: string, minutes: number, offsetMinutes: number): string {
  const atMs = dayStartMs(day, offsetMinutes) + minutes * 60_000;
  const local = new Date(atMs + offsetMinutes * 60_000).toISOString().slice(0, 19);
  return `${local}${formatOffset(offsetMinutes)}`;
}

/** `-04:00`, as the feed spells it. */
export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const total = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Minutes past midnight, as `<input type="time">` writes them. */
export function clockValue(minutes: number): string {
  const inDay = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(inDay / 60)).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}`;
}

/** And back again. Null for anything that is not a clock. */
export function clockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 1440 ? minutes : null;
}

/**
 * When to suggest a stop starts: after whatever is already on that day.
 *
 * Because that is the question being answered. Somebody adding a food truck to a
 * Saturday with a game ending at one o'clock means lunch after the game, and
 * offering them noon — inside the game — makes them do the arithmetic the page
 * is already doing. With nothing on the day there is nothing to be after, and
 * noon is as good a guess as exists.
 */
export function suggestedStart(entries: readonly PlanEntry[], day: string): number {
  let latest: number | null = null;
  for (const entry of entries) {
    if (dayKey(entry.start) !== day) continue;
    const offset = offsetMinutesOf(entry.start) ?? 0;
    const ends = (entryEndMs(entry) - dayStartMs(day, offset)) / 60_000;
    latest = latest === null ? ends : Math.max(latest, ends);
  }
  if (latest === null) return NOON;
  // Up to the next quarter hour, and never past the end of the day — a stop
  // suggested at ten past midnight would land on the wrong column.
  return Math.min(23 * 60 + 30, Math.ceil(latest / 15) * 15);
}

/**
 * Where an entry is now, preferring the live room over the saved label.
 *
 * Except for a stop, where it is the other way round and deliberately so. An
 * event's saved label is a snapshot of a room that may since have been renamed,
 * so the room wins. A stop's label is *more specific than its room*: "Food
 * Truck 12 · Block Party" against a room called Block Party, and throwing away
 * the truck number to print the street twice would lose the only part of it
 * anybody navigates by.
 */
export function entryWhere(entry: PlanEntry): string {
  if (entry.kind === 'stop') return entry.where;
  const room = entry.roomId ? ROOMS_BY_ID[entry.roomId] : undefined;
  if (!room) return entry.where;
  const venue = VENUES_BY_ID[room.venueId];
  // Deduplicated: the Block Party is a room called Block Party inside a venue
  // called Block Party, and printing both reads as a stutter rather than detail.
  return [room.shortName ?? room.name, venue?.shortName ?? venue?.name]
    .filter(Boolean)
    .filter((part, at, all) => all.indexOf(part) === at)
    .join(' · ');
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

/**
 * The convention's own offset, from whatever in front of us knows it.
 *
 * The plan first, so a plan that outlives its feed still reads its own days
 * right; then the feed, so an empty plan can still be given a first stop at a
 * time that means what it says. Null when nothing has said, and null is a real
 * answer — with no feed and no entries, nobody has told this app when the
 * convention is, and inventing an offset would put somebody's stop on a
 * different afternoon from the one they typed.
 */
export function conventionOffset(
  entries: readonly PlanEntry[],
  feedSample?: string | null,
): number | null {
  for (const entry of entries) {
    const offset = offsetMinutesOf(entry.start);
    if (offset !== null) return offset;
  }
  return feedSample ? offsetMinutesOf(feedSample) : null;
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
  /** Which of the side-by-side lanes to draw this in — see `inLanes`. */
  lane: number;
  /** How many lanes the overlapping run it belongs to needs. */
  lanes: number;
}

/**
 * The shortest a block is drawn, in minutes.
 *
 * Here rather than in the component because the overlap arithmetic has to use
 * the same number: a twenty-minute stop drawn at a twenty-four-minute minimum
 * covers four minutes it does not own, and two blocks that only overlap once
 * they are drawn are still two blocks on top of each other.
 */
export const SHORTEST_BLOCK = 24;

/**
 * Side by side rather than one on top of the other.
 *
 * Two things at once used to be two blocks at the same place on the column,
 * and the shorter one simply disappeared behind the longer. That was survivable
 * while everything came from the feed — sessions somebody signed up for rarely
 * overlap — and it stopped being survivable the moment somebody could type
 * their own times, because "twenty minutes at a food truck during a four-hour
 * game" is a completely ordinary thing to plan and the whole point of drawing
 * it is to see that it does not fit.
 *
 * Lanes are assigned greedily to the leftmost free one, and the width is shared
 * across the *run* of overlapping entries rather than across the day, so one
 * clash in the morning does not narrow the afternoon.
 */
function inLanes(items: PlannedItem[]): PlannedItem[] {
  const out: PlannedItem[] = [];
  const drawnEnd = (item: PlannedItem) =>
    Math.max(item.endMs, item.startMs + SHORTEST_BLOCK * 60_000);

  let run: PlannedItem[] = [];
  let laneEnd: number[] = [];
  let runEnd = -Infinity;

  const flush = () => {
    const lanes = run.reduce((most, item) => Math.max(most, item.lane + 1), 1);
    for (const item of run) out.push({ ...item, lanes });
    run = [];
    laneEnd = [];
    runEnd = -Infinity;
  };

  // Already in start order, which is what makes one pass enough.
  for (const item of items) {
    if (item.startMs >= runEnd) flush();
    let lane = laneEnd.findIndex((end) => end <= item.startMs);
    if (lane === -1) lane = laneEnd.length;
    laneEnd[lane] = drawnEnd(item);
    runEnd = Math.max(runEnd, drawnEnd(item));
    run.push({ ...item, lane });
  }
  flush();
  return out;
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

  const items = onDay.map((entry, index) => {
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
      lane: 0,
      lanes: 1,
    };
  });
  return inLanes(items);
}

/* ------------------------------------------------------------- the ruler */

/** Midnight at the start of a day, in the convention's own offset. */
export function dayStartMs(day: string, offsetMinutes: number): number {
  return Date.parse(`${day}T00:00:00Z`) - offsetMinutes * 60_000;
}

export interface DayAxis {
  /** Minutes past midnight where the ruler begins, and where it ends. */
  fromMinutes: number;
  toMinutes: number;
  /** How tall the ruler is, in minutes. */
  minutes: number;
  /** Every hour boundary inside the span, as minutes past midnight. */
  hours: number[];
}

/** Half an hour of margin, so the first block is not jammed against the top. */
const MARGIN_MINUTES = 30;
const DAY_MINUTES = 24 * 60;

/**
 * ONE ruler for all four days, in minutes past midnight rather than in
 * milliseconds.
 *
 * Four rulers is what this used to be, and it made the four columns
 * incomparable: Thursday's ten o'clock and Saturday's ten o'clock sat at
 * different heights, so the one thing a four-day view is *for* — seeing that
 * every morning is committed and every evening is not — could not be seen. In
 * minutes past midnight, the same clock time is the same height in every
 * column, which is the whole point.
 *
 * Past midnight is allowed to exceed 1,440. A game that runs from eight in the
 * evening until two in the morning belongs on the day it started, drawn
 * continuing off the bottom of it, rather than wrapped round to the top.
 *
 * `now` is folded in when today is one of the days, because the marker for it
 * has to have somewhere to sit: a Saturday whose only entry was this morning
 * still has to show a line at four in the afternoon.
 */
export function sharedAxis(
  days: readonly PlannedItem[][],
  nowMinutes: number | null,
): DayAxis | null {
  let from = Infinity;
  let to = -Infinity;

  for (const items of days) {
    for (const item of items) {
      const dayStart = dayStartMs(dayKey(item.entry.start), offsetOf(item.entry.start));
      const begins = ((item.leaveByMs ?? item.startMs) - dayStart) / 60_000;
      const ends = (item.endMs - dayStart) / 60_000;
      from = Math.min(from, begins - MARGIN_MINUTES);
      to = Math.max(to, ends + MARGIN_MINUTES);
    }
  }

  /*
   * The mark for now stretches a ruler; it does not conjure one.
   *
   * A Saturday whose only entry was this morning still has to reach ten at
   * night, or the mark sits off the end. But an empty plan has nothing to rule,
   * and a ruler drawn round the current time alone would be four empty columns
   * and a line saying "now" — which is the page announcing that it knows the
   * time rather than saying anything about anybody's Saturday. Checked before
   * the margins are applied, so `from` is still infinite exactly when nothing
   * is planned.
   */
  if (nowMinutes !== null && Number.isFinite(from)) {
    from = Math.min(from, nowMinutes - MARGIN_MINUTES);
    to = Math.max(to, nowMinutes + MARGIN_MINUTES);
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;

  // Out to whole hours, so the ruler's labels land on its own edges. Clamped at
  // midnight below, because nothing on a day begins before the day does.
  const fromMinutes = Math.max(0, Math.floor(from / 60) * 60);
  const toMinutes = Math.min(DAY_MINUTES * 2, Math.ceil(to / 60) * 60);

  const hours: number[] = [];
  for (let at = fromMinutes; at <= toMinutes; at += 60) hours.push(at);
  return { fromMinutes, toMinutes, minutes: toMinutes - fromMinutes, hours };
}

/** The offset a plan entry's own timestamp carries, or none. */
const offsetOf = (iso: string) => offsetMinutesOf(iso) ?? 0;

/** Where a moment sits on the shared ruler, for an entry on this day. */
export function minutesInto(atMs: number, day: string, offsetMinutes: number): number {
  return (atMs - dayStartMs(day, offsetMinutes)) / 60_000;
}
