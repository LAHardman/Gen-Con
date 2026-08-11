/**
 * Narrowing a catalogue, and the ways a filter lies without looking broken.
 *
 * Every one of these is a wrong list that looks like a right one. A day filter
 * reading the viewer's clock puts Thursday's late events under Wednesday for
 * anybody west of Indiana. A cost filter that treats "no price recorded" as
 * free puts forty-dollar events in a free list. A room filter that falls back to
 * the building silently widens what was asked for. And a sort that only breaks
 * ties inside a relevance ranking is not the sort anybody chose — it is the old
 * order with a new label.
 */

import { describe, expect, it } from 'vitest';
import {
  activeCount,
  compareBy,
  filterChoices,
  formatCost,
  formatLength,
  lengthMinutes,
  facetCounts,
  matchesFilter,
  minutesOfDay,
  NO_FILTER,
  type EventFilter,
} from './filters';
import type { ConEvent } from './events';

const THURSDAY = '2026-07-30';
const SATURDAY = '2026-08-01';

const event = (over: Partial<ConEvent> = {}): ConEvent => ({
  id: 'e',
  title: 'A game',
  locationText: 'ICC',
  start: `${SATURDAY}T14:00:00-04:00`,
  end: `${SATURDAY}T16:00:00-04:00`,
  durationMinutes: 120,
  type: 'BGM',
  cost: 4,
  ticketsAvailable: 3,
  ageRequirement: 'Everyone (6+)',
  roomId: 'hall-a',
  ...over,
});

describe('an empty filter', () => {
  it('narrows nothing, which is what makes them composable', () => {
    expect(matchesFilter(event(), NO_FILTER)).toBe(true);
    expect(activeCount(NO_FILTER)).toBe(0);
    expect(activeCount({ days: [], types: [], system: '  ' })).toBe(0);
  });

  it('counts only the dimensions actually doing something', () => {
    expect(activeCount({ days: [SATURDAY] })).toBe(1);
    // Both ends of one range are one dimension, not two.
    expect(activeCount({ startFrom: 0, startTo: 720 })).toBe(1);
    expect(activeCount({ days: [SATURDAY], maxCost: 0, types: ['BGM'] })).toBe(3);
  });
});

describe('when it is on', () => {
  it('reads the day in the convention’s own time', () => {
    // 11pm Saturday in Indianapolis is 3am Sunday in UTC and Sunday evening in
    // Sydney. It is a Saturday event, and it has to stay one.
    const late = event({ start: `${SATURDAY}T23:00:00-04:00` });
    expect(matchesFilter(late, { days: [SATURDAY] })).toBe(true);
    expect(matchesFilter(late, { days: ['2026-08-02'] })).toBe(false);
  });

  it('reads the clock time in the convention’s own time too', () => {
    expect(minutesOfDay(`${SATURDAY}T14:30:00-04:00`)).toBe(14 * 60 + 30);
    expect(matchesFilter(event(), { startFrom: 12 * 60, startTo: 17 * 60 })).toBe(true);
    expect(matchesFilter(event(), { startFrom: 0, startTo: 11 * 60 + 59 })).toBe(false);
  });

  it('filters on how long it runs', () => {
    expect(matchesFilter(event(), { maxMinutes: 60 })).toBe(false);
    expect(matchesFilter(event(), { minMinutes: 60, maxMinutes: 180 })).toBe(true);
    // Falls back to the two timestamps where the duration was never written.
    expect(lengthMinutes(event({ durationMinutes: undefined }))).toBe(120);
  });

  it('filters on type and age', () => {
    expect(matchesFilter(event(), { types: ['RPG'] })).toBe(false);
    expect(matchesFilter(event(), { types: ['RPG', 'BGM'] })).toBe(true);
    expect(matchesFilter(event(), { ages: ['21+'] })).toBe(false);
    expect(matchesFilter(event(), { ages: ['Everyone (6+)'] })).toBe(true);
  });

  it('matches a game system as text, because there are 1,845 of them', () => {
    const catan = event({ gameSystem: 'Catan: Seafarers' });
    expect(matchesFilter(catan, { system: 'catan' })).toBe(true);
    expect(matchesFilter(catan, { system: 'CATAN' })).toBe(true);
    expect(matchesFilter(catan, { system: 'gloomhaven' })).toBe(false);
  });

  it('does not call an unpriced event free', () => {
    // The one that would put forty-dollar events in a "free only" list. A
    // missing price is not a price of zero.
    expect(matchesFilter(event({ cost: 0 }), { maxCost: 0 })).toBe(true);
    expect(matchesFilter(event({ cost: 4 }), { maxCost: 0 })).toBe(false);
    expect(matchesFilter(event({ cost: undefined }), { maxCost: 0 })).toBe(false);
    expect(matchesFilter(event({ cost: undefined }), { maxCost: 100 })).toBe(false);
  });

  it('filters on tickets still being on sale', () => {
    expect(matchesFilter(event({ ticketsAvailable: 0 }), { ticketsOnly: true })).toBe(false);
    expect(matchesFilter(event({ ticketsAvailable: undefined }), { ticketsOnly: true })).toBe(false);
    expect(matchesFilter(event(), { ticketsOnly: true })).toBe(true);
  });

  it('filters by building, and by room inside it', () => {
    expect(matchesFilter(event(), { venueIds: ['icc'] })).toBe(true);
    expect(matchesFilter(event(), { venueIds: ['westin'] })).toBe(false);
    expect(matchesFilter(event(), { roomIds: ['hall-a'] })).toBe(true);
    expect(matchesFilter(event(), { roomIds: ['hall-b'] })).toBe(false);
  });

  it('does not widen a room back out to its building', () => {
    // Asking for Hall A and being given the whole convention centre is the
    // failure that looks like a working filter.
    expect(matchesFilter(event(), { venueIds: ['icc'], roomIds: ['hall-b'] })).toBe(false);
  });

  it('drops an event with nowhere at all when a place was asked for', () => {
    const nowhere = event({ roomId: undefined });
    expect(matchesFilter(nowhere, { venueIds: ['icc'] }, undefined)).toBe(false);
    expect(matchesFilter(nowhere, NO_FILTER, undefined)).toBe(true);
  });

  it('takes every condition at once', () => {
    const filter = {
      days: [SATURDAY],
      startFrom: 12 * 60,
      maxMinutes: 180,
      types: ['BGM'],
      maxCost: 10,
      venueIds: ['icc'],
    };
    expect(matchesFilter(event(), filter)).toBe(true);
    expect(matchesFilter(event({ type: 'RPG' }), filter)).toBe(false);
    expect(matchesFilter(event({ start: `${THURSDAY}T14:00:00-04:00` }), filter)).toBe(false);
  });
});

describe('the order', () => {
  const early = event({ id: 'early', start: `${SATURDAY}T09:00:00-04:00`, end: `${SATURDAY}T18:00:00-04:00`, durationMinutes: 540, cost: 20 });
  const late = event({ id: 'late', start: `${SATURDAY}T17:00:00-04:00`, end: `${SATURDAY}T18:00:00-04:00`, durationMinutes: 60, cost: 0 });
  const order = (key: Parameters<typeof compareBy>[0]) =>
    [early, late].sort(compareBy(key)).map((one) => one.id);

  it('sorts by each of the four things', () => {
    expect(order('start')).toEqual(['early', 'late']);
    expect(order('length')).toEqual(['late', 'early']);
    expect(order('cost')).toEqual(['late', 'early']);
    // Both end at six, so this falls through to the start time.
    expect(order('end')).toEqual(['early', 'late']);
  });

  it('puts an unpriced event last rather than first', () => {
    // "Cheapest" headed by events whose price is simply unknown is not an
    // answer to the question.
    const unknown = event({ id: 'unknown', cost: undefined });
    expect([unknown, late].sort(compareBy('cost')).map((one) => one.id)).toEqual(['late', 'unknown']);
  });

  it('settles ties the same way every time', () => {
    // Hundreds of events share a cost or a length. A list that reshuffles
    // between renders cannot be chosen from.
    const a = event({ id: 'a', title: 'Aardvark', cost: 5 });
    const b = event({ id: 'b', title: 'Zebra', cost: 5 });
    expect([b, a].sort(compareBy('cost')).map((one) => one.id)).toEqual(['a', 'b']);
    expect([a, b].sort(compareBy('cost')).map((one) => one.id)).toEqual(['a', 'b']);
  });
});

describe('what the pickers may offer', () => {
  it('is built from the feed rather than written down', () => {
    // A type this year's catalogue does not use should not be offered, and one
    // it adds should appear without anybody editing a list.
    const choices = filterChoices([
      event({ type: 'RPG', ageRequirement: '21+', roomId: 'hall-a', durationMinutes: 60 }),
      event({ type: 'BGM', ageRequirement: '21+', roomId: 'westin-grand-ballroom', durationMinutes: 240 }),
    ]);
    expect(choices.types).toEqual(['BGM', 'RPG']);
    expect(choices.ages).toEqual(['21+']);
    expect(choices.lengths).toEqual([60, 240]);
    expect(choices.venueIds).toEqual(['icc', 'westin']);
    expect(choices.rooms.map((room) => room.id).sort()).toEqual(['hall-a', 'westin-grand-ballroom']);
  });

  it('offers nothing for a catalogue that has not arrived', () => {
    const choices = filterChoices([]);
    expect(choices.types).toEqual([]);
    expect(choices.rooms).toEqual([]);
  });
});

describe('the number on each option', () => {
  /*
   * A corpus small enough to reason about and varied enough that no two
   * dimensions move together — which is what makes the brute-force comparison
   * below meaningful rather than a tautology.
   */
  const corpus = [
    event({ id: '1', start: `${SATURDAY}T09:00:00-04:00`, durationMinutes: 60, type: 'BGM', cost: 0, roomId: 'hall-a', ticketsAvailable: 2, ageRequirement: 'Everyone (6+)' }),
    event({ id: '2', start: `${SATURDAY}T14:00:00-04:00`, durationMinutes: 240, type: 'RPG', cost: 6, roomId: 'hall-a', ticketsAvailable: 0, ageRequirement: '21+' }),
    event({ id: '3', start: `${SATURDAY}T20:00:00-04:00`, durationMinutes: 120, type: 'BGM', cost: 0, roomId: 'westin-grand-ballroom', ticketsAvailable: 5, ageRequirement: '21+' }),
    event({ id: '4', start: `${THURSDAY}T09:00:00-04:00`, durationMinutes: 60, type: 'TCG', cost: 20, roomId: 'westin-grand-ballroom', ticketsAvailable: 1, ageRequirement: 'Everyone (6+)' }),
    event({ id: '5', start: `${THURSDAY}T14:00:00-04:00`, durationMinutes: 240, type: 'RPG', cost: 0, roomId: 'hall-a', ticketsAvailable: 3, ageRequirement: 'Everyone (6+)' }),
  ];
  const entries = corpus.map((one) => ({ event: one, room: { id: one.roomId! }, title: one.title.toLowerCase() }));
  const choices = filterChoices(corpus);
  const counts = (filter: EventFilter) => facetCounts(entries, () => true, filter, choices);
  /** What the list would actually hold — the thing every count claims to predict. */
  const actually = (filter: EventFilter) =>
    entries.filter(({ event: one, room }) => matchesFilter(one, filter, room.id)).length;

  it('counts what there is now', () => {
    expect(counts({}).total).toBe(5);
    expect(counts({ days: [SATURDAY] }).total).toBe(3);
  });

  it('predicts a value being switched on, from nothing chosen', () => {
    const on = counts({});
    expect(on.days.get(SATURDAY)).toBe(actually({ days: [SATURDAY] }));
    expect(on.types.get('RPG')).toBe(actually({ types: ['RPG'] }));
    expect(on.venues.get('westin')).toBe(actually({ venueIds: ['westin'] }));
    // The two toggles, against a corpus where they are not everything: three
    // of the five are free and four of the five still have tickets.
    expect(on.free).toBe(actually({ maxCost: 0 }));
    expect(on.free).toBe(3);
    expect(on.tickets).toBe(actually({ ticketsOnly: true }));
    expect(on.tickets).toBe(4);
  });

  it('predicts a value being ADDED to a facet that already has one', () => {
    // The one a plain facet count gets wrong. A second type widens rather than
    // narrows, so the number on the chip has to go up, not down.
    const filter: EventFilter = { types: ['BGM'] };
    const on = counts(filter);
    expect(on.total).toBe(2);
    expect(on.types.get('RPG')).toBe(actually({ types: ['BGM', 'RPG'] }));
    expect(on.types.get('RPG')!).toBeGreaterThan(on.total);
  });

  it('predicts a value being switched off', () => {
    const filter: EventFilter = { types: ['BGM', 'RPG'] };
    expect(counts(filter).types.get('RPG')).toBe(actually({ types: ['BGM'] }));
    // The last one off leaves the facet unconstrained, not empty.
    expect(counts({ types: ['BGM'] }).types.get('BGM')).toBe(actually({}));
  });

  it('predicts every option against every other filter that is on', () => {
    // The real assurance: for a compound filter, each count is compared with
    // the list that pressing it actually produces. Nothing here is the count's
    // own arithmetic checked against itself.
    const filter: EventFilter = { days: [SATURDAY], types: ['BGM'], minMinutes: 60 };
    const on = counts(filter);
    expect(on.total).toBe(actually(filter));
    expect(on.days.get(THURSDAY)).toBe(actually({ ...filter, days: [SATURDAY, THURSDAY] }));
    expect(on.types.get('RPG')).toBe(actually({ ...filter, types: ['BGM', 'RPG'] }));
    expect(on.ages.get('21+')).toBe(actually({ ...filter, ages: ['21+'] }));
    expect(on.venues.get('icc')).toBe(actually({ ...filter, venueIds: ['icc'] }));
    expect(on.rooms.get('hall-a')).toBe(actually({ ...filter, roomIds: ['hall-a'] }));
    expect(on.free).toBe(actually({ ...filter, maxCost: 0 }));
    expect(on.tickets).toBe(actually({ ...filter, ticketsOnly: true }));
    expect(on.times[2]).toBe(actually({ ...filter, startFrom: 12 * 60, startTo: 16 * 60 + 59 }));
    expect(on.lengthAtLeast.get(120)).toBe(actually({ ...filter, minMinutes: 120 }));
    expect(on.lengthAtMost.get(120)).toBe(actually({ ...filter, maxMinutes: 120 }));
  });

  it('keeps the other end of a range when predicting one end of it', () => {
    // "At least" and "at most" are one dimension. Offering a minimum that
    // ignores the maximum already set would promise results that are not there.
    const filter: EventFilter = { maxMinutes: 120 };
    expect(counts(filter).lengthAtLeast.get(60)).toBe(actually({ minMinutes: 60, maxMinutes: 120 }));
    expect(counts(filter).lengthAtLeast.get(240)).toBe(actually({ minMinutes: 240, maxMinutes: 120 }));
  });

  it('predicts turning a toggle back off', () => {
    expect(counts({ maxCost: 0 }).free).toBe(actually({}));
    expect(counts({ ticketsOnly: true }).tickets).toBe(actually({}));
  });

  it('counts only what the typed query already found', () => {
    // A count taken over a different set from the list beside it is worse than
    // no count: it is a number that disagrees with what pressing it does.
    const onlyOne = facetCounts(entries, (title) => title === corpus[0].title.toLowerCase(), {}, choices);
    expect(onlyOne.total).toBe(5);
    const none = facetCounts(entries, () => false, {}, choices);
    expect(none.total).toBe(0);
    // Every option still answers — with a zero, which is the useful answer.
    expect([...none.days.values()].every((n) => n === 0)).toBe(true);
  });

  it('answers with a number for an option nothing survives, not with nothing', () => {
    // Thursday's events are all the wrong type here, so none reaches the day
    // tally — and the chip must still say what pressing it leaves, which is
    // what the other days already leave rather than a blank.
    const on = counts({ days: [SATURDAY], types: ['BGM'], minMinutes: 60 });
    expect(on.days.get(THURSDAY)).toBe(actually({ days: [SATURDAY, THURSDAY], types: ['BGM'], minMinutes: 60 }));
    expect(on.days.get(THURSDAY)).toBe(on.total);
  });

  it('offers zero rather than nothing for a value that would empty the list', () => {
    // The dead ends are the whole point: pressing "Thursday" here leaves
    // nothing, and seeing that beforehand is what saves the press.
    const on = counts({ types: ['TCG'], days: [SATURDAY] });
    expect(on.total).toBe(0);
    expect(on.days.get(THURSDAY)).toBe(actually({ types: ['TCG'], days: [SATURDAY, THURSDAY] }));
    expect(on.days.get(THURSDAY)).toBe(1);
  });
});

describe('how the numbers read', () => {
  it('writes a length the way a schedule prints one', () => {
    expect(formatLength(30)).toBe('30 min');
    expect(formatLength(60)).toBe('1 h');
    expect(formatLength(150)).toBe('2 h 30');
  });

  it('says Free rather than $0, and nothing at all where nothing was said', () => {
    expect(formatCost(0)).toBe('Free');
    expect(formatCost(4)).toBe('$4');
    expect(formatCost(2.5)).toBe('$2.50');
    expect(formatCost(undefined)).toBe('');
  });
});
