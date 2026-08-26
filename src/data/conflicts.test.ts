/**
 * The two things a schedule can say that cannot both be true.
 *
 * Gen Con 2027 runs Wednesday 4 August (Trade Day) to Sunday 8 August, from the
 * first-Saturday-of-August rule `key-dates` already proves. Every timestamp
 * here carries Eastern's summer offset, exactly as the feed's do — which is the
 * point of half of these tests: a clash reported in the reader's time zone is a
 * clash they cannot find on their own schedule.
 */

import { describe, expect, it } from 'vitest';
import { conflictsIn, goersOf } from './conflicts';
import { daysCovered, type Badge } from './badges';
import type { Person } from './budget';
import type { PlanEntry } from './plan';

const YEAR = 2027;
const ANNA: Person = { id: 'p1', name: 'Anna' };
const BEN: Person = { id: 'p2', name: 'Ben' };
const PARTY = [ANNA, BEN];

const THURSDAY = '2027-08-05';
const SATURDAY = '2027-08-07';
const SUNDAY = '2027-08-08';

const at = (day: string, clock: string, over: Partial<PlanEntry> = {}): PlanEntry => ({
  id: `${day}-${clock}`,
  title: 'A game',
  start: `${day}T${clock}:00-04:00`,
  durationMinutes: 120,
  where: 'ICC : Rm 120',
  ...over,
});

const badge = (personId: string, kind: Badge['kind']): Badge => ({ personId, kind });

describe('which days a badge buys', () => {
  it('gives a 4-day badge Thursday to Sunday', () => {
    expect(daysCovered('four-day', YEAR)).toEqual([
      '2027-08-05',
      '2027-08-06',
      '2027-08-07',
      '2027-08-08',
    ]);
  });

  it('gives a single-day badge exactly its day', () => {
    expect(daysCovered('saturday', YEAR)).toEqual([SATURDAY]);
    expect(daysCovered('sunday', YEAR)).toEqual([SUNDAY]);
  });

  it('gives Trade Day the Wednesday, and nothing else', () => {
    /*
     * The one people get wrong. Trade Day is a different badge sold to a
     * different audience — holding one does not get you into the Friday.
     */
    expect(daysCovered('trade-day', YEAR)).toEqual(['2027-08-04']);
  });

  it('gives no badge no days at all', () => {
    expect(daysCovered('none', YEAR)).toEqual([]);
  });
});

describe('who is down for an event', () => {
  it('is everybody when nobody is named', () => {
    // The same rule the money uses, and it has to be: one person with nothing
    // assigned is the ordinary case, and it is the one that must be checked.
    expect(goersOf(at(SATURDAY, '14'), PARTY, {})).toEqual(PARTY);
  });

  it('is the people named when somebody is', () => {
    const one = at(SATURDAY, '14');
    expect(goersOf(one, PARTY, { [one.id]: ['p2'] })).toEqual([BEN]);
  });

  it('falls back to everybody when the named person has left the party', () => {
    const one = at(SATURDAY, '14');
    expect(goersOf(one, PARTY, { [one.id]: ['gone'] })).toEqual(PARTY);
  });
});

describe('being in two places at once', () => {
  it('catches two events over the same hour', () => {
    const found = conflictsIn(
      [at(SATURDAY, '14', { title: 'Strahd' }), at(SATURDAY, '15', { title: 'Blood on the Clocktower' })],
      [ANNA],
      {},
      [badge('p1', 'four-day')],
      YEAR,
    );
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('clash');
    expect(found[0].person).toBe(ANNA);
    expect(found[0].says).toMatch(/Anna is down for two things at 2:00 pm on Saturday/);
    expect(found[0].says).toMatch(/Strahd and Blood on the Clocktower/);
  });

  it('says the time the schedule says, not the reader’s', () => {
    /*
     * Sliced from the timestamp rather than parsed, for the same reason
     * `dayKey` slices. This suite runs in UTC, so a parsed 2pm Eastern would
     * print as 6:00 pm and send somebody looking for a clash that is not there.
     */
    const found = conflictsIn(
      [at(SATURDAY, '09'), at(SATURDAY, '09', { id: 'other' })],
      [ANNA],
      {},
      [badge('p1', 'four-day')],
      YEAR,
    );
    expect(found[0].says).toMatch(/at 9:00 am/);
  });

  it('leaves two back-to-back events alone', () => {
    // A game ending at 4 and another starting at 4 is a tight afternoon. Report
    // those and every real clash is lost among them.
    const found = conflictsIn(
      [at(SATURDAY, '14'), at(SATURDAY, '16', { id: 'next' })],
      [ANNA],
      {},
      [badge('p1', 'four-day')],
      YEAR,
    );
    expect(found).toEqual([]);
  });

  it('reports all three of three overlapping events, not just the first', () => {
    const found = conflictsIn(
      [
        at(SATURDAY, '14', { id: 'a', title: 'A' }),
        at(SATURDAY, '15', { id: 'b', title: 'B' }),
        at(SATURDAY, '15', { id: 'c', title: 'C' }),
      ],
      [ANNA],
      {},
      [badge('p1', 'four-day')],
      YEAR,
    );
    expect(found.filter((one) => one.kind === 'clash')).toHaveLength(3);
  });

  it('does not clash two people against each other', () => {
    /*
     * The whole reason this is per-person. A party of two at two different
     * games at two o'clock is a party splitting up, which is what parties do.
     */
    const anna = at(SATURDAY, '14', { id: 'a' });
    const ben = at(SATURDAY, '14', { id: 'b' });
    const found = conflictsIn(
      [anna, ben],
      PARTY,
      { [anna.id]: ['p1'], [ben.id]: ['p2'] },
      [badge('p1', 'four-day'), badge('p2', 'four-day')],
      YEAR,
    );
    expect(found).toEqual([]);
  });

  it('clashes an unassigned event against an assigned one', () => {
    // Unassigned means everybody, so Ben is at both.
    const shared = at(SATURDAY, '14', { id: 'shared' });
    const bens = at(SATURDAY, '15', { id: 'bens' });
    const found = conflictsIn(
      [shared, bens],
      PARTY,
      { [bens.id]: ['p2'] },
      [badge('p1', 'four-day'), badge('p2', 'four-day')],
      YEAR,
    );
    expect(found.map((one) => one.person.name)).toEqual(['Ben']);
  });
});

describe('a day you cannot get in on', () => {
  it('catches a Sunday game on a Thursday-only badge', () => {
    const found = conflictsIn([at(SUNDAY, '10', { title: 'Ticket to Ride' })], [ANNA], {}, [badge('p1', 'thursday')], YEAR);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('uncovered');
    expect(found[0].says).toBe('Anna has a thursday badge and Ticket to Ride is on the Sunday.');
  });

  it('says so plainly when there is no badge at all', () => {
    // The commonest case in March, and the one worth saying without jargon.
    const found = conflictsIn([at(SATURDAY, '10', { title: 'Strahd' })], [ANNA], {}, [], YEAR);
    expect(found[0].says).toBe('Anna has no badge yet, and Strahd is on the Saturday.');
  });

  it('is happy with a day the badge covers', () => {
    expect(conflictsIn([at(THURSDAY, '10')], [ANNA], {}, [badge('p1', 'thursday')], YEAR)).toEqual([]);
    expect(conflictsIn([at(SUNDAY, '10')], [ANNA], {}, [badge('p1', 'four-day')], YEAR)).toEqual([]);
  });

  it('will not let a Trade Day badge into the Friday', () => {
    const found = conflictsIn([at('2027-08-06', '10')], [ANNA], {}, [badge('p1', 'trade-day')], YEAR);
    expect(found[0].kind).toBe('uncovered');
  });

  it('says nothing about a dinner the week before', () => {
    /*
     * A badge is not a thing you need on the Tuesday. Judging every date in the
     * plan would put a warning on every stop somebody adds outside the four
     * days, which is a page of noise around the four warnings that matter.
     */
    expect(conflictsIn([at('2027-08-03', '19')], [ANNA], {}, [], YEAR)).toEqual([]);
  });

  it('only blames the person whose badge it is', () => {
    const sunday = at(SUNDAY, '10');
    const found = conflictsIn(
      [sunday],
      PARTY,
      {},
      [badge('p1', 'four-day'), badge('p2', 'thursday')],
      YEAR,
    );
    expect(found.map((one) => one.person.name)).toEqual(['Ben']);
  });
});

describe('reading the whole list', () => {
  it('orders it by when it goes wrong, not by whose it is', () => {
    /*
     * Somebody reading this is looking at a Saturday afternoon and wants both
     * problems in it together — not Anna's whole convention followed by Ben's.
     */
    const sunday = at(SUNDAY, '10', { id: 's' });
    const early = at(THURSDAY, '09', { id: 'e1' });
    const alsoEarly = at(THURSDAY, '10', { id: 'e2' });
    const found = conflictsIn(
      [sunday, early, alsoEarly],
      [ANNA],
      {},
      [badge('p1', 'thursday')],
      YEAR,
    );
    expect(found.map((one) => one.kind)).toEqual(['clash', 'uncovered']);
    expect(Date.parse(found[0].entries[0].start)).toBeLessThan(Date.parse(found[1].entries[0].start));
  });

  it('finds nothing wrong with a plan that is fine', () => {
    const found = conflictsIn(
      [at(THURSDAY, '09'), at(THURSDAY, '14', { id: 'b' }), at(SATURDAY, '10', { id: 'c' })],
      PARTY,
      {},
      [badge('p1', 'four-day'), badge('p2', 'four-day')],
      YEAR,
    );
    expect(found).toEqual([]);
  });

  it('finds nothing when nobody is going yet', () => {
    // No party means no per-person anything, and a page full of warnings before
    // somebody has typed a single name would be the first thing they saw.
    expect(conflictsIn([at(SATURDAY, '14')], [], {}, [], YEAR)).toEqual([]);
  });
});
