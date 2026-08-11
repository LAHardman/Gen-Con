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
import { ROOMS, ROOMS_BY_ID } from './venues';

/**
 * What kind of thing is being looked for.
 *
 * The top of the filter, and the thing that decides what the rest of it even
 * means. A cuisine is not a question you can ask of a seminar, and a ticket
 * price is not one you can ask of a taco truck — so rather than showing nine
 * controls of which four are dead, the panel shows the ones that belong to
 * whatever is being searched for.
 *
 * `all` is the default and the old behaviour: everything, ranked together.
 */
export type SearchKind = 'all' | 'event' | 'food' | 'vendor' | 'place';

export const KIND_LABEL: Record<SearchKind, string> = {
  all: 'Everything',
  event: 'Events',
  food: 'Food',
  vendor: 'Vendors',
  place: 'Places',
};

export const SEARCH_KINDS: SearchKind[] = ['all', 'event', 'food', 'vendor', 'place'];

export interface EventFilter {
  /** What is being looked for. Absent means everything. */
  kind?: SearchKind;
  /** Food only: which kitchen, which dish, and what you can eat. */
  cuisine?: readonly string[];
  dish?: readonly string[];
  dietary?: readonly string[];
  /**
   * Vendors only: what sort of stand, whereabouts, and what it sells.
   *
   * `standKinds` rather than `kinds` because `kind` above is already the top of
   * the filter and two fields a letter apart would be read wrong by somebody
   * eventually. See `vendors.ts`.
   */
  standKinds?: readonly string[];
  areas?: readonly string[];
  tags?: readonly string[];
  /** Places only: which floor, offered from the rooms in the chosen buildings. */
  levels?: readonly string[];
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
  // The kind is not counted. It is the question rather than a narrowing of it,
  // and a "1" on the Filters button for having chosen "Food" would say that
  // something is hidden when nothing is.
  if (filter.cuisine?.length) n += 1;
  if (filter.dish?.length) n += 1;
  if (filter.dietary?.length) n += 1;
  if (filter.standKinds?.length) n += 1;
  if (filter.areas?.length) n += 1;
  if (filter.tags?.length) n += 1;
  if (filter.levels?.length) n += 1;
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
 * Has anything been asked at all, with or without a word typed?
 *
 * The rule the search itself follows, so that the box that shows the results
 * and the search that produces them cannot disagree. Choosing "Food" is a whole
 * question on its own — 43 vendors is a browsable list, and demanding two
 * letters first would make the chip decoration — but it is not a *narrowing*,
 * which is why `activeCount` still ignores it and this does not.
 */
export const isAsking = (filter: EventFilter): boolean =>
  activeCount(filter) > 0 || (filter.kind ?? 'all') !== 'all';

/* ------------------------------------------------------------------ places */

/** Does this room answer the place filters — the building, and the floor? */
export const inChosenPlace = (room: { venueId: string; level: string }, filter: EventFilter) =>
  (!filter.venueIds?.length || filter.venueIds.includes(room.venueId)) &&
  (!filter.levels?.length || filter.levels.includes(room.level));

export interface PlaceCounts {
  total: number;
  venues: Map<string, number>;
  levels: Map<string, number>;
}

/**
 * How many rooms each place chip would leave.
 *
 * 149 rooms against thirty-odd options, so it is counted by re-filtering like
 * the food and vendor tallies — and it means what those mean: the number is
 * what *pressing it* produces, so adding a second building widens.
 */
export function placeCounts(
  filter: EventFilter,
  venueIds: readonly string[],
  levels: readonly string[],
): PlaceCounts {
  const count = (next: EventFilter) => ROOMS.filter((room) => inChosenPlace(room, next)).length;
  const forFacet = (facet: 'venueIds' | 'levels', values: readonly string[]) => {
    const chosen = filter[facet] ?? [];
    const out = new Map<string, number>();
    for (const value of values) {
      const after = chosen.includes(value) ? chosen.filter((one) => one !== value) : [...chosen, value];
      // Narrowing to a building throws away a floor chosen in another one, the
      // same way the room picker does — so the count has to throw it away too,
      // or it promises a number the press will not produce.
      const next = { ...filter, [facet]: after };
      out.set(value, count(facet === 'venueIds' ? { ...next, levels: [] } : next));
    }
    return out;
  };
  return {
    total: count(filter),
    venues: forFacet('venueIds', venueIds),
    levels: forFacet('levels', levels),
  };
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
  return (
    onDay(event, filter) &&
    atTime(event, filter) &&
    runsFor(event, filter) &&
    ofType(event, filter) &&
    forAge(event, filter) &&
    ofSystem(event, filter) &&
    costs(event, filter) &&
    hasTickets(event, filter) &&
    inPlace(filter, roomId)
  );
}

/*
 * The nine dimensions, one predicate each.
 *
 * Separate rather than inlined into `matchesFilter` because `facetCounts` has
 * to ask them *individually* — which of the nine an event fails is the whole of
 * how it counts fifty options in one pass. Two copies of these rules would be
 * two answers to the same question, and the count would disagree with the list
 * it is printed beside.
 */
const onDay = (event: ConEvent, f: EventFilter) =>
  !f.days?.length || f.days.includes(dayKey(event.start));

function atTime(event: ConEvent, f: EventFilter) {
  if (f.startFrom === undefined && f.startTo === undefined) return true;
  const at = minutesOfDay(event.start);
  return (f.startFrom === undefined || at >= f.startFrom) && (f.startTo === undefined || at <= f.startTo);
}

function runsFor(event: ConEvent, f: EventFilter) {
  if (f.minMinutes === undefined && f.maxMinutes === undefined) return true;
  const runs = lengthMinutes(event);
  return (f.minMinutes === undefined || runs >= f.minMinutes) && (f.maxMinutes === undefined || runs <= f.maxMinutes);
}

const ofType = (event: ConEvent, f: EventFilter) =>
  !f.types?.length || f.types.includes(event.type ?? '');

const forAge = (event: ConEvent, f: EventFilter) =>
  !f.ages?.length || f.ages.includes(event.ageRequirement ?? '');

function ofSystem(event: ConEvent, f: EventFilter) {
  const system = f.system?.trim().toLowerCase();
  return !system || (event.gameSystem ?? '').toLowerCase().includes(system);
}

// An event with no cost recorded is not known to be free, and quietly treating
// it as free would put paid events in a "free only" list.
const costs = (event: ConEvent, f: EventFilter) =>
  f.maxCost === undefined || (typeof event.cost === 'number' && event.cost <= f.maxCost);

const hasTickets = (event: ConEvent, f: EventFilter) =>
  !f.ticketsOnly || !!(event.ticketsAvailable && event.ticketsAvailable > 0);

function inPlace(f: EventFilter, roomId: string | undefined) {
  if (!f.roomIds?.length && !f.venueIds?.length) return true;
  if (!roomId) return false;
  if (f.roomIds?.length) return f.roomIds.includes(roomId);
  const room = ROOMS_BY_ID[roomId];
  return !!room && !!f.venueIds?.includes(room.venueId);
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
  /** Days with anything on them, as `dayKey` writes them. */
  days: string[];
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
  const days = new Set<string>();
  const types = new Set<string>();
  const ages = new Set<string>();
  const roomIds = new Set<string>();
  const lengths = new Set<number>();

  for (const event of events) {
    days.add(dayKey(event.start));
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
    days: [...days].sort(),
    types: [...types].sort(),
    ages: [...ages].sort(),
    venueIds: [...new Set(rooms.map((room) => room.venueId))].sort(),
    rooms,
    lengths: [...lengths].sort((a, b) => a - b),
  };
}

/* --------------------------------------------------- what each one would do */

/**
 * The bands the "Starts" filter offers, in minutes past midnight.
 *
 * Here rather than in the component because the counts have to be taken over
 * exactly the bands somebody can press, and two lists that drift apart give a
 * number printed on a button that the button does not produce.
 */
export const START_BANDS: ReadonlyArray<{ label: string; from?: number; to?: number }> = [
  { label: 'Any time' },
  { label: 'Morning', from: 0, to: 11 * 60 + 59 },
  { label: 'Afternoon', from: 12 * 60, to: 16 * 60 + 59 },
  { label: 'Evening', from: 17 * 60, to: 20 * 60 + 59 },
  { label: 'Late', from: 21 * 60, to: 24 * 60 },
];

export interface FacetCounts {
  /** How many results there are now. */
  total: number;
  /** For each value, how many there would be if it were pressed. */
  days: Map<string, number>;
  /** By index into `START_BANDS`. */
  times: number[];
  lengthAtLeast: Map<number, number>;
  lengthAtMost: Map<number, number>;
  types: Map<string, number>;
  ages: Map<string, number>;
  venues: Map<string, number>;
  rooms: Map<string, number>;
  /** Any room, keeping whatever buildings are chosen. */
  anyRoom: number;
  free: number;
  tickets: number;
}

/** The nine independent things a filter can narrow on. */
const DAY = 1, TIME = 2, LENGTH = 4, TYPE = 8, AGE = 16, SYSTEM = 32, COST = 64, TICKETS = 128, PLACE = 256;

/**
 * How many results each filter value would leave, all in one pass.
 *
 * WHY THE NUMBERS ARE WORTH THE WORK. A filter list without them is a list of
 * guesses: you press "Escape Rooms" and get nothing, press it again, try
 * "Saturday" and get nothing, and there is no way to tell which of the nine
 * dimensions emptied the list. With them the dead ends are visible before they
 * are pressed, and narrowing becomes reading rather than trial and error.
 *
 * HOW IT IS ONE PASS RATHER THAN FIFTY. The naive version re-filters the whole
 * catalogue once per option — 27,467 events times some fifty options, which is
 * over a million checks every time a chip is pressed. Instead each event is
 * tested against all nine dimensions once and the failures recorded as a mask.
 * An event can only ever be counted for a facet it does not already fail, so:
 *
 *   - failing nothing, it counts toward every facet's own value;
 *   - failing exactly one, it counts toward that one facet and no other;
 *   - failing two or more, it counts toward nothing.
 *
 * That is the whole trick, and it makes the cost 27,467 × 9 rather than
 * 27,467 × 50.
 *
 * WHAT IS COUNTED IS WHAT PRESSING IT PRODUCES, not "how many have this value".
 * Adding a second day to a day filter widens rather than narrows, and a count
 * that read as a narrowing there would be wrong on exactly the presses somebody
 * makes most. Every one of these fields is single-valued per event, so the
 * arithmetic is exact rather than an estimate.
 */
export function facetCounts(
  entries: ReadonlyArray<{ event: ConEvent; room?: { id: string }; title: string }>,
  matchesQuery: (title: string) => boolean,
  filter: EventFilter,
  choices?: FilterChoices,
): FacetCounts {
  /*
   * Seeded with every value that has a chip, at zero.
   *
   * An option no surviving event carries would otherwise have no entry at all,
   * and a chip showing nothing reads as "no answer" when the answer is a firm
   * zero — which is exactly the dead end these numbers exist to reveal. And it
   * is not always zero: adding a day to a day filter widens, so a day with no
   * survivors still leaves whatever the other days already leave.
   */
  const seeded = <T>(values: readonly T[] | undefined) =>
    new Map<T, number>((values ?? []).map((value) => [value, 0]));

  const dayTally = seeded(choices?.days);
  const timeTally = START_BANDS.map(() => 0);
  const lengthTally = seeded(choices?.lengths);
  const typeTally = seeded(choices?.types);
  const ageTally = seeded(choices?.ages);
  const venueTally = seeded(choices?.venueIds);
  const roomTally = seeded(choices?.rooms.map((room) => room.id));
  let freeTally = 0;
  let costAll = 0;
  let ticketTally = 0;
  let ticketAll = 0;
  let total = 0;

  const bump = (into: Map<string, number>, key: string | undefined) => {
    if (key === undefined) return;
    into.set(key, (into.get(key) ?? 0) + 1);
  };

  for (const { event, room, title } of entries) {
    if (!matchesQuery(title)) continue;

    const roomId = room?.id ?? event.roomId;
    // The predicates themselves rather than nine sub-filters: building nine
    // objects per event is a quarter of a million allocations, and it was two
    // thirds of the time this took.
    let failed = 0;
    if (!onDay(event, filter)) failed |= DAY;
    if (!atTime(event, filter)) failed |= TIME;
    if (!runsFor(event, filter)) failed |= LENGTH;
    if (!ofType(event, filter)) failed |= TYPE;
    if (!forAge(event, filter)) failed |= AGE;
    if (!ofSystem(event, filter)) failed |= SYSTEM;
    if (!costs(event, filter)) failed |= COST;
    if (!hasTickets(event, filter)) failed |= TICKETS;
    if (!inPlace(filter, roomId)) failed |= PLACE;

    if (failed === 0) total += 1;
    // Two or more failures and no single press can rescue it. Purely a
    // shortcut — every tally below already asks for `failed === 0 || failed ===
    // its own bit`, so such an event would be turned away nine times over. It
    // is here because that is most of the catalogue once a filter is on.
    if (failed !== 0 && (failed & (failed - 1)) !== 0) continue;

    if (failed === 0 || failed === DAY) bump(dayTally, dayKey(event.start));
    if (failed === 0 || failed === TIME) {
      const at = minutesOfDay(event.start);
      for (let band = 1; band < START_BANDS.length; band += 1) {
        const { from = 0, to = 24 * 60 } = START_BANDS[band];
        if (at >= from && at <= to) timeTally[band] += 1;
      }
    }
    if (failed === 0 || failed === LENGTH) {
      const runs = lengthMinutes(event);
      lengthTally.set(runs, (lengthTally.get(runs) ?? 0) + 1);
    }
    if (failed === 0 || failed === TYPE) bump(typeTally, event.type);
    if (failed === 0 || failed === AGE) bump(ageTally, event.ageRequirement);
    if (failed === 0 || failed === COST) {
      costAll += 1;
      if (event.cost === 0) freeTally += 1;
    }
    if (failed === 0 || failed === TICKETS) {
      ticketAll += 1;
      if (event.ticketsAvailable && event.ticketsAvailable > 0) ticketTally += 1;
    }
    if ((failed === 0 || failed === PLACE) && roomId) {
      bump(roomTally, roomId);
      const venue = ROOMS_BY_ID[roomId]?.venueId;
      bump(venueTally, venue);
    }
  }

  // "Any time" clears the band, and the bands cover the whole clock.
  timeTally[0] = timeTally.slice(1).reduce((sum, n) => sum + n, 0);

  return {
    total,
    days: pressed(dayTally, filter.days),
    times: timeTally,
    lengthAtLeast: runningTotals(lengthTally, filter.maxMinutes, 'atLeast'),
    lengthAtMost: runningTotals(lengthTally, filter.minMinutes, 'atMost'),
    types: pressed(typeTally, filter.types),
    ages: pressed(ageTally, filter.ages),
    venues: pressed(venueTally, filter.venueIds),
    rooms: roomTally,
    anyRoom: sumWhere(roomTally, (id) => {
      const venue = ROOMS_BY_ID[id]?.venueId;
      return !filter.venueIds?.length || (!!venue && filter.venueIds.includes(venue));
    }),
    free: filter.maxCost === 0 ? costAll : freeTally,
    tickets: filter.ticketsOnly ? ticketAll : ticketTally,
  };
}

/**
 * What each value of a multi-select facet would leave if pressed.
 *
 * Adding to a selection widens and removing narrows, which is the opposite of
 * what a facet count usually means — so it is worked out rather than shown raw.
 * Every one of these fields holds one value per event, so no event is double
 * counted and the sums are exact.
 */
function pressed(tally: Map<string, number>, chosen: readonly string[] | undefined): Map<string, number> {
  const all = [...tally.values()].reduce((sum, n) => sum + n, 0);
  const on = chosen ?? [];
  const now = on.length ? on.reduce((sum, key) => sum + (tally.get(key) ?? 0), 0) : all;

  const out = new Map<string, number>();
  for (const [key, count] of tally) {
    if (!on.includes(key)) out.set(key, on.length ? now + count : count);
    else out.set(key, on.length === 1 ? all : now - count);
  }
  return out;
}

/** "At least X" and "at most X", inside whatever the other end already allows. */
function runningTotals(
  tally: Map<number, number>,
  otherEnd: number | undefined,
  which: 'atLeast' | 'atMost',
): Map<number, number> {
  const out = new Map<number, number>();
  for (const value of tally.keys()) {
    let sum = 0;
    for (const [length, count] of tally) {
      const withinNew = which === 'atLeast' ? length >= value : length <= value;
      const withinOld =
        otherEnd === undefined || (which === 'atLeast' ? length <= otherEnd : length >= otherEnd);
      if (withinNew && withinOld) sum += count;
    }
    out.set(value, sum);
  }
  return out;
}

const sumWhere = (tally: Map<string, number>, keep: (key: string) => boolean) => {
  let sum = 0;
  for (const [key, count] of tally) if (keep(key)) sum += count;
  return sum;
};

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
