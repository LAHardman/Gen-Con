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
  matchesFilter,
  minutesOfDay,
  NO_FILTER,
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
