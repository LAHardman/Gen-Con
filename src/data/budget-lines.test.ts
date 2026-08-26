/**
 * The lines the budget does not store: hotels booked, sessions planned.
 *
 * These exist to keep two numbers from drifting apart, so what is tested is
 * mostly what they *refuse* to do — price something nobody has priced, keep a
 * cost for a hotel that has been un-booked, or list forty free seminars as
 * forty lines of $0.00.
 */

import { describe, expect, it } from 'vitest';
import type { Booking } from './bookings';
import { allLines, bookedTotal, bookingLineId, linesFromBookings, linesFromPlan, planLineId } from './budget-lines';
import { budgetFor, type Line, type Person } from './budget';
import type { PlanEntry } from './plan';

const ANNA: Person = { id: 'p1', name: 'Anna' };
const BEN: Person = { id: 'p2', name: 'Ben' };

const booking = (over: Partial<Booking> = {}): Booking => ({
  placeId: 'w1',
  name: 'JW Marriott Indianapolis',
  nightlyCents: 28_700,
  in: '2027-08-04',
  out: '2027-08-08',
  who: [],
  ...over,
});

const entry = (over: Partial<PlanEntry> = {}): PlanEntry => ({
  id: 'RPG27ND1',
  title: 'Curse of Strahd',
  start: '2027-08-06T14:00:00-04:00',
  where: 'ICC : Rm 120',
  ...over,
});

describe('a booked hotel, as a cost', () => {
  it('prices it by the night, and says how many', () => {
    // Kept apart so the reader can check it: "$287 × 4 nights" is arithmetic
    // they can do, "$1,148" is a number they have to take on trust.
    const [line] = linesFromBookings([booking({ nightlyCents: 28_700 })]);
    expect(line.cents).toBe(28_700);
    expect(line.times).toBe(4);
    expect(line.category).toBe('hotel');
    expect(line.label).toBe('JW Marriott Indianapolis');
    expect(line.note).toMatch(/4 nights, 2027-08-04 to 2027-08-08/);
  });

  it('says when a rate is Gen Con’s own, which is a different promise', () => {
    const [line] = linesFromBookings([booking({ block: true })]);
    expect(line.note).toMatch(/Gen Con block rate/);
  });

  it('leaves out a booking with no nights in it rather than showing $0.00', () => {
    /*
     * Somebody mid-edit, with the check-out not yet moved. A $0.00 line between
     * two real ones reads as a hotel that is free, which no hotel is.
     */
    expect(linesFromBookings([booking({ out: '2027-08-04' })])).toEqual([]);
  });

  it('carries more than one hotel, because a party splits across them', () => {
    const lines = linesFromBookings([
      booking(),
      booking({ placeId: 'w2', name: 'The Westin', nightlyCents: 27_600, who: ['p2'] }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.map((one) => one.id)).toEqual([bookingLineId('w1'), bookingLineId('w2')]);
    expect(lines[1].who).toEqual(['p2']);
  });

  it('keeps its own answer to whose room it is', () => {
    // Who sleeps in a room is part of the booking, not something said about it
    // afterwards — so it comes off the booking rather than the assignment map.
    expect(linesFromBookings([booking({ who: ['p1'] })])[0].who).toEqual(['p1']);
  });
});

describe('a planned session, as a cost', () => {
  it('prices a ticket the feed priced, in cents', () => {
    // The feed says 4 (dollars). Everything downstream counts in cents, and the
    // conversion belongs in one place rather than seven.
    const [line] = linesFromPlan([entry({ cost: 4 })], {});
    expect(line.cents).toBe(400);
    expect(line.times).toBe(1);
    expect(line.category).toBe('event');
    expect(line.id).toBe(planLineId('RPG27ND1'));
  });

  it('leaves out an event nobody priced, rather than calling it free', () => {
    /*
     * The distinction the whole function turns on. No `cost` is "nobody said" —
     * an event added before the plan carried prices, or one the feed never
     * priced. A $0.00 line would read as "this is free", which is a different
     * claim and one this app cannot make.
     */
    expect(linesFromPlan([entry()], {})).toEqual([]);
    expect(linesFromPlan([entry({ cost: undefined })], {})).toEqual([]);
  });

  it('leaves out the free half of the convention', () => {
    // Most of a Gen Con schedule costs nothing. Forty $0.00 lines would bury
    // the eight that cost something.
    expect(linesFromPlan([entry({ cost: 0 })], {})).toEqual([]);
  });

  it('takes whose it is from the assignment, keyed by the event’s own id', () => {
    // Not by the line's id: the line is rebuilt every render and the assignment
    // has to outlive it.
    const [line] = linesFromPlan([entry({ cost: 6 })], { RPG27ND1: ['p2'] });
    expect(line.who).toEqual(['p2']);
  });

  it('is everybody’s when nobody has been named', () => {
    expect(linesFromPlan([entry({ cost: 6 })], {})[0].who).toEqual([]);
  });
});

describe('derived lines together with typed ones', () => {
  const typed: Line[] = [
    { id: 'c1', category: 'badge', label: '4-day badge', cents: 13_000, times: 2, who: [] },
  ];

  it('adds up to one budget', () => {
    const lines = allLines(typed, [booking()], [entry({ cost: 4 })], {});
    const budget = budgetFor(lines, [ANNA, BEN]);
    // 2 × $130 badges + 4 × $287 hotel + one $4 ticket.
    expect(budget.total).toBe(26_000 + 114_800 + 400);
    expect(budget.byCategory.badge).toBe(26_000);
    expect(budget.byCategory.hotel).toBe(114_800);
    expect(budget.byCategory.event).toBe(400);
  });

  it('stops costing anything the moment the hotel is un-booked', () => {
    /*
     * The whole reason these are derived rather than saved. If they were
     * stored, un-booking would leave the cost behind for somebody to find a
     * fortnight later.
     */
    const budget = budgetFor(allLines(typed, [], [entry({ cost: 4 })], {}), [ANNA]);
    expect(budget.byCategory.hotel).toBe(0);
  });

  it('stops costing anything the moment the event leaves the schedule', () => {
    const budget = budgetFor(allLines(typed, [booking()], [], {}), [ANNA]);
    expect(budget.byCategory.event).toBe(0);
  });

  it('marks a derived line so the page will not offer to edit it', () => {
    // Editing one would be undone by the next render, which reads it back from
    // the booking. The way to change it is to change the booking.
    const lines = allLines(typed, [booking()], [entry({ cost: 4 })], {});
    expect(lines.find((one) => one.id === bookingLineId('w1'))!.from).toBe('booking');
    expect(lines.find((one) => one.id === planLineId('RPG27ND1'))!.from).toBe('plan');
    expect(lines.find((one) => one.id === 'c1')!.from).toBeUndefined();
  });
});

describe('what the hotels come to', () => {
  it('adds up every booking', () => {
    expect(bookedTotal([booking(), booking({ placeId: 'w2', nightlyCents: 10_000 })])).toBe(
      114_800 + 40_000,
    );
  });

  it('is nothing when nothing is booked', () => {
    expect(bookedTotal([])).toBe(0);
  });
});
