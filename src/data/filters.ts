/**
 * Narrowing 27,467 events down to the ones somebody could actually go to.
 *
 * A title search alone answers "is there a thing called that". The question in
 * front of somebody building a schedule is different and much narrower: what is
 * on **Saturday afternoon**, runs **under three hours**, costs **nothing**, and
 * is **in the convention centre** — and of those, which starts soonest. None of
 * that is a title.
 *
 * WHAT CAN BE FILTERED IS WHAT THE FEED HOLDS, and no more. The feed carries
 * the type code, game system, start, end, duration, cost, tickets, age
 * requirement and the room. So those are the filters. There is no "tag" field
 * in Gen Con's data at all; the two fields that behave like tags are the age
 * requirement (five values, a real facet) and the game system (1,845 values,
 * far too many for a list and so matched as text). They are named for what they
 * are rather than dressed up as tags.
 *
 * EVERY FILTER IS A NARROWING, and an empty one narrows nothing. That is what
 * makes them composable without a combinatorial mess of special cases, and it
 * is why `matchesFilter` is a chain of early returns rather than a query
 * builder.
 *
 * THIS IS PURE AND HAS NO IDEA WHAT A COMPONENT IS. It runs over the whole
 * catalogue on every keystroke, so it is also written to be cheap: no
 * allocation per event, no formatting, no dates parsed twice.
 */

import { dayKey, eventEndMs, offsetMinutesOf, type ConEvent } from './events';
import { ROOMS_BY_ID } from './venues';

export interface EventFilter {
  /** Days as `dayKey` writes them. Empty means every day. */
  days?: readonly string[];
  /** Starts no earlier than this many minutes past midnight, local. */
  startFrom?: number;
  /** Starts no later than this. */
  startTo?: number;
  /** Runs at least / at most this many minutes. */
  minMinutes?: number;
  maxMinutes?: number;
  /** Type codes — see `event-kinds.ts`. Empty means every type. */
  types?: readonly string[];
  /** Age requirements, as the feed spells them. Empty means all of them. */
  ages?: readonly string[];
  /** Game system, matched as text because there are 1,845 of them. */
  system?: string;
  /** Costs no more than this many dollars. 0 means free only. */
  maxCost?: number;
  /** Buildings. Empty means anywhere. */
  venueIds?: readonly string[];
  /** Rooms. Empty means any room — including, with `venueIds`, any in those. */
  roomIds?: readonly string[];
  /** Only what still has tickets on sale. */
  ticketsOnly?: boolean;
}

export const NO_FILTER: EventFilter = {};

/** How many dimensions are actually narrowing anything. */
export function activeCount(filter: EventFilter): number {
  let n = 0;
  if (filter.days?.length) n += 1;
  if (filter.startFrom !== undefined || filter.startTo !== undefined) n += 1;
  if (filter.minMinutes !== undefined || filter.maxMinutes !== undefined) n += 1;
  if (filter.types?.length) n += 1;
  if (filter.ages?.length) n += 1;
  if (filter.system?.trim()) n += 1;
  if (filter.maxCost !== undefined) n += 1;
  if (filter.venueIds?.length || filter.roomIds?.length) n += 1;
  if (filter.ticketsOnly) n += 1;
  return n;
}

/**
 * Minutes past midnight, in the timestamp's own offset.
 *
 * The timestamp's own, so "before noon" means before noon in Indianapolis for
 * everybody looking at it. Read off the string rather than through `Date`,
 * because `Date` would answer in the viewer's zone and be wrong by hours for
 * anybody planning from another one.
 */
export function minutesOfDay(iso: string): number {
  const offset = offsetMinutesOf(iso);
  if (offset === null) return 0;
  const at = new Date(Date.parse(iso) + offset * 60_000);
  return at.getUTCHours() * 60 + at.getUTCMinutes();
}

/** How long an event runs, from whichever of the three fields it has. */
export function lengthMinutes(event: ConEvent): number {
  if (typeof event.durationMinutes === 'number') return event.durationMinutes;
  return Math.round((eventEndMs(event) - Date.parse(event.start)) / 60_000);
}

/**
 * Does this event survive the filter?
 *
 * The room is passed in rather than looked up, because the caller already knows
 * it — a search hit carries the room it matched — and looking it up again for
 * every one of 27,467 events on every keystroke is the difference between a
 * filter that feels instant and one that does not.
 */
export function matchesFilter(
  event: ConEvent,
  filter: EventFilter,
  roomId: string | undefined = event.roomId,
): boolean {
  if (filter.days?.length && !filter.days.includes(dayKey(event.start))) return false;

  if (filter.startFrom !== undefined || filter.startTo !== undefined) {
    const at = minutesOfDay(event.start);
    if (filter.startFrom !== undefined && at < filter.startFrom) return false;
    if (filter.startTo !== undefined && at > filter.startTo) return false;
  }

  if (filter.minMinutes !== undefined || filter.maxMinutes !== undefined) {
    const runs = lengthMinutes(event);
    if (filter.minMinutes !== undefined && runs < filter.minMinutes) return false;
    if (filter.maxMinutes !== undefined && runs > filter.maxMinutes) return false;
  }

  if (filter.types?.length && !filter.types.includes(event.type ?? '')) return false;
  if (filter.ages?.length && !filter.ages.includes(event.ageRequirement ?? '')) return false;

  const system = filter.system?.trim().toLowerCase();
  if (system && !(event.gameSystem ?? '').toLowerCase().includes(system)) return false;

  if (filter.maxCost !== undefined) {
    // An event with no cost recorded is not known to be free, and quietly
    // treating it as free would put paid events in a "free only" list.
    if (typeof event.cost !== 'number' || event.cost > filter.maxCost) return false;
  }

  if (filter.ticketsOnly && !(event.ticketsAvailable && event.ticketsAvailable > 0)) return false;

  if (filter.roomIds?.length || filter.venueIds?.length) {
    if (!roomId) return false;
    if (filter.roomIds?.length) return filter.roomIds.includes(roomId);
    const room = ROOMS_BY_ID[roomId];
    return !!room && !!filter.venueIds?.includes(room.venueId);
  }

  return true;
}

/* ------------------------------------------------------------------ order */

export type SortKey = 'start' | 'end' | 'length' | 'cost';

export const SORT_LABEL: Record<SortKey, string> = {
  start: 'Starts soonest',
  end: 'Ends soonest',
  length: 'Shortest first',
  cost: 'Cheapest first',
};

/**
 * What to order by, and what to fall back on.
 *
 * Every sort ends in start time and then title, because the alternative is an
 * order that reshuffles between renders for the hundreds of events that share a
 * cost or a length. A list that will not sit still cannot be chosen from.
 */
export function compareBy(key: SortKey): (a: ConEvent, b: ConEvent) => number {
  const then = (a: ConEvent, b: ConEvent) =>
    Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title);

  switch (key) {
    case 'start':
      return then;
    case 'end':
      return (a, b) => eventEndMs(a) - eventEndMs(b) || then(a, b);
    case 'length':
      return (a, b) => lengthMinutes(a) - lengthMinutes(b) || then(a, b);
    case 'cost':
      // Unpriced last rather than first: "cheapest" should not be headed by
      // events whose price is simply unknown.
      return (a, b) =>
        (a.cost ?? Infinity) - (b.cost ?? Infinity) || then(a, b);
  }
}

/* --------------------------------------------------- what there is to pick */

export interface FilterChoices {
  types: string[];
  ages: string[];
  venueIds: string[];
  /** Rooms in the chosen buildings, or every room, as `[id, name]`. */
  rooms: Array<{ id: string; name: string; venueId: string }>;
  lengths: number[];
}

/**
 * The values actually present, so the pickers offer nothing that finds nothing.
 *
 * Built from the feed rather than written down: a type or an age band that this
 * year's catalogue does not use should not be offered, and one it adds should
 * appear without anybody editing a list.
 */
export function filterChoices(events: readonly ConEvent[]): FilterChoices {
  const types = new Set<string>();
  const ages = new Set<string>();
  const roomIds = new Set<string>();
  const lengths = new Set<number>();

  for (const event of events) {
    if (event.type) types.add(event.type);
    if (event.ageRequirement) ages.add(event.ageRequirement);
    if (event.roomId) roomIds.add(event.roomId);
    const runs = lengthMinutes(event);
    if (runs > 0) lengths.add(runs);
  }

  const rooms = [...roomIds]
    .map((id) => ROOMS_BY_ID[id])
    .filter(Boolean)
    .map((room) => ({ id: room.id, name: room.shortName ?? room.name, venueId: room.venueId }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    types: [...types].sort(),
    ages: [...ages].sort(),
    venueIds: [...new Set(rooms.map((room) => room.venueId))].sort(),
    rooms,
    lengths: [...lengths].sort((a, b) => a - b),
  };
}

/** "2 h 30", the way a schedule prints a length. */
export function formatLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest}` : `${hours} h`;
}

/** "$4", "Free", or nothing at all when the feed never said. */
export function formatCost(cost: number | undefined): string {
  if (typeof cost !== 'number') return '';
  return cost === 0 ? 'Free' : `$${Number.isInteger(cost) ? cost : cost.toFixed(2)}`;
}
