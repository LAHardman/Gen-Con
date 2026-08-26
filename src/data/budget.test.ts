/**
 * The budget's arithmetic, judged on the two ways money goes missing.
 *
 * A trip budget is a column of numbers people check against a card statement,
 * so it has exactly two jobs: the total must be the total, and the per-person
 * columns must add up to it. Both fail quietly. A cent lost to rounding on
 * every line is a budget that is wrong by a dollar and looks right; a share
 * pinned to somebody who has left the party is money that stops being anybody's
 * without anything saying so.
 */

import { describe, expect, it } from 'vitest';
import {
  bearersOf,
  budgetFor,
  CATEGORIES,
  centsFrom,
  dollars,
  lineTotal,
  shareOut,
  type Line,
  type Person,
} from './budget';

const ANNA: Person = { id: 'p1', name: 'Anna' };
const BEN: Person = { id: 'p2', name: 'Ben' };
const CHI: Person = { id: 'p3', name: 'Chi' };
const PARTY = [ANNA, BEN, CHI];

const line = (over: Partial<Line> = {}): Line => ({
  id: 'c1',
  category: 'misc',
  label: 'Something',
  cents: 1000,
  times: 1,
  who: [],
  ...over,
});

describe('dividing a cost between people', () => {
  it('adds back up to what it started as, whatever the remainder', () => {
    /*
     * The whole reason this is a function rather than a division. $100 between
     * three is not three lots of $33.33 — that is $99.99, and a budget that
     * loses a cent per line is wrong by a dollar after a hundred of them and
     * gives no sign of it.
     */
    for (const cents of [10_000, 1, 7, 999, 100_001, 33]) {
      for (const among of [1, 2, 3, 4, 7, 11]) {
        const shares = shareOut(cents, among);
        expect(shares).toHaveLength(among);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(cents);
      }
    }
  });

  it('spreads the remainder rather than dumping it on one person', () => {
    // $1.00 between three is 34/33/33, not 34/33/33 in any order that changes
    // between renders — a column that flickers is a column nobody trusts.
    expect(shareOut(100, 3)).toEqual([34, 33, 33]);
    expect(shareOut(100, 3)).toEqual(shareOut(100, 3));
    // And no share is ever more than a cent from any other.
    const shares = shareOut(1_000_001, 7);
    expect(Math.max(...shares) - Math.min(...shares)).toBe(1);
  });

  it('splits a refund the same way it splits a cost', () => {
    // A credit is a cost with a minus in front of it. If it rounded the other
    // way, a cost and its exact refund would not cancel.
    expect(shareOut(-100, 3).reduce((a, b) => a + b, 0)).toBe(-100);
    expect(shareOut(-100, 3)).toEqual([-34, -33, -33]);
  });

  it('gives nothing to nobody rather than dividing by zero', () => {
    expect(shareOut(5000, 0)).toEqual([]);
    expect(shareOut(5000, -1)).toEqual([]);
  });
});

describe('deciding whose a cost is', () => {
  it('shares an unassigned cost across everybody', () => {
    // The common case, and it should not need saying: a hire car is not
    // assigned to anybody, it is shared.
    expect(bearersOf(line({ who: [] }), PARTY)).toEqual(PARTY);
  });

  it('gives an assigned cost to the people named on it', () => {
    expect(bearersOf(line({ who: ['p1', 'p3'] }), PARTY)).toEqual([ANNA, CHI]);
  });

  it('drops somebody who is no longer on the trip', () => {
    // Their share would otherwise sit on the line belonging to nobody.
    expect(bearersOf(line({ who: ['p1', 'gone'] }), PARTY)).toEqual([ANNA]);
  });

  it('falls back to everybody when the only person named has gone', () => {
    /*
     * The cost did not stop existing because the person it was pinned to went
     * home. Somebody is still paying for the room, and a line that quietly
     * cost nothing would be the budget lying about the total.
     */
    expect(bearersOf(line({ who: ['gone'] }), PARTY)).toEqual(PARTY);
  });

  it('has nobody to give it to when nobody is going yet', () => {
    // How the page starts. See the `unassigned` test below for what happens.
    expect(bearersOf(line({ who: [] }), [])).toEqual([]);
  });
});

describe('the budget as a whole', () => {
  it('totals the lines, times how many of each there are', () => {
    // "$180 × 4 nights" is a number somebody can check. $720 is one they have
    // to trust, so the two are kept apart until the last moment.
    const budget = budgetFor(
      [line({ id: 'a', cents: 18_000, times: 4, category: 'hotel' }), line({ id: 'b', cents: 13_000, category: 'badge' })],
      PARTY,
    );
    expect(lineTotal({ cents: 18_000, times: 4 })).toBe(72_000);
    expect(budget.total).toBe(85_000);
    expect(budget.byCategory.hotel).toBe(72_000);
    expect(budget.byCategory.badge).toBe(13_000);
    expect(budget.byCategory.food).toBe(0);
  });

  it('gives every column and the total the same money, to the cent', () => {
    /*
     * The invariant the whole page rests on. Deliberately awkward numbers: a
     * three-way split that does not divide, a two-way one that does not either,
     * and one pinned to a single person.
     */
    const budget = budgetFor(
      [
        line({ id: 'a', cents: 10_001, category: 'travel' }),
        line({ id: 'b', cents: 3_333, times: 3, who: ['p1', 'p2'], category: 'food' }),
        line({ id: 'c', cents: 4_999, who: ['p3'], category: 'merch' }),
      ],
      PARTY,
    );
    const columns = budget.people.reduce((sum, one) => sum + one.total, 0);
    expect(columns + budget.unassigned).toBe(budget.total);
    expect(budget.unassigned).toBe(0);
    // And each column's own headings add up to that column.
    for (const person of budget.people) {
      const headings = CATEGORIES.reduce((sum, one) => sum + person.byCategory[one], 0);
      expect(headings).toBe(person.total);
    }
  });

  it('puts a cost nobody is carrying somewhere visible, not nowhere', () => {
    /*
     * With no party there is nobody to bill, and the honest answer is not to
     * shrink the total to zero — the flight still costs what it costs. It goes
     * to `unassigned`, so the page can say who it is waiting on.
     */
    const budget = budgetFor([line({ cents: 42_000, category: 'travel' })], []);
    expect(budget.total).toBe(42_000);
    expect(budget.unassigned).toBe(42_000);
    expect(budget.people).toEqual([]);
  });

  it('bills only the people a line names', () => {
    const budget = budgetFor([line({ cents: 30_000, who: ['p2'], category: 'badge' })], PARTY);
    const of = (id: string) => budget.people.find((one) => one.person.id === id)!;
    expect(of('p2').total).toBe(30_000);
    expect(of('p1').total).toBe(0);
    expect(of('p3').total).toBe(0);
  });

  it('keeps a column for somebody who owes nothing yet', () => {
    // Otherwise adding a person to the party does nothing visible until they
    // are on a line, which reads as the button not having worked.
    const budget = budgetFor([], PARTY);
    expect(budget.people.map((one) => one.person.name)).toEqual(['Anna', 'Ben', 'Chi']);
    expect(budget.people.every((one) => one.total === 0)).toBe(true);
  });

  it('orders the lines by heading rather than by when they were typed', () => {
    const budget = budgetFor(
      [
        line({ id: 'a', category: 'misc' }),
        line({ id: 'b', category: 'badge' }),
        line({ id: 'c', category: 'hotel' }),
      ],
      PARTY,
    );
    expect(budget.lines.map((one) => one.category)).toEqual(['badge', 'hotel', 'misc']);
  });
});

describe('money in and out of a text box', () => {
  it('prints to the cent, so a column lines up as a column', () => {
    expect(dollars(124_000)).toBe('$1,240.00');
    expect(dollars(8_750)).toBe('$87.50');
    expect(dollars(0)).toBe('$0.00');
    expect(dollars(-4_250)).toBe('-$42.50');
  });

  it('reads what people actually type', () => {
    expect(centsFrom('1240.50')).toBe(124_050);
    expect(centsFrom('$1,240.50')).toBe(124_050);
    expect(centsFrom(' 1240 ')).toBe(124_000);
    expect(centsFrom('1240.5')).toBe(124_050);
    expect(centsFrom('0')).toBe(0);
  });

  it('says nothing rather than zero for a box with nothing usable in it', () => {
    /*
     * "" and "$0" are different answers. Reading an empty box as zero would
     * wipe whatever was in it the moment somebody selected all and started
     * retyping, which is how everyone edits a number.
     */
    expect(centsFrom('')).toBeNull();
    expect(centsFrom('   ')).toBeNull();
    expect(centsFrom('-')).toBeNull();
    expect(centsFrom('.')).toBeNull();
    expect(centsFrom('about forty')).toBeNull();
    expect(centsFrom('12.34.56')).toBeNull();
  });

  it('rounds to the cent rather than carrying a fraction of one', () => {
    // A third of a dollar typed in full is 33 cents, not 33.333333 of them.
    expect(centsFrom('0.333')).toBe(33);
    expect(centsFrom('0.335')).toBe(34);
  });
});
