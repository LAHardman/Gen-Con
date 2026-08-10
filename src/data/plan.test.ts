/**
 * A plan, and the three things about it that are easy to get quietly wrong.
 *
 * WHICH FOUR DAYS. Gen Con runs Thursday to Sunday with a Trade Day on the
 * Wednesday, and the dates move every year. Written down as dates this breaks
 * annually and looks fine while it does — a Wednesday column appearing, or
 * Sunday vanishing, with everything else working.
 *
 * WHICH DAY IT IS. "Thursday" means Thursday in Indianapolis. Somebody planning
 * from California at ten on Wednesday evening is already in Thursday where they
 * are standing, and highlighting Thursday for them would be wrong by a day.
 *
 * WHETHER YOU CAN GET THERE. The walk between two entries is the point of the
 * page. Nothing in the app would look broken if it were measured from the wrong
 * end, or between the wrong pair, or dropped for the first entry of the day —
 * it would just be a plausible number that is not the answer.
 */

import { describe, expect, it } from 'vitest';
import {
  conventionDays,
  dayAxis,
  dayName,
  entrySpot,
  entryWhere,
  isConventionDay,
  planDay,
  planEntry,
  weekdayOf,
  type PlanEntry,
} from './plan';
import { dayAt, offsetMinutesOf, type ConEvent } from './events';
import { roughMinutes } from './nearby';

/** Gen Con 2026: Trade Day on the Wednesday, then the four days. */
const WEDNESDAY = '2026-07-29';
const THURSDAY = '2026-07-30';
const FRIDAY = '2026-07-31';
const SATURDAY = '2026-08-01';
const SUNDAY = '2026-08-02';

const entry = (over: Partial<PlanEntry> & { start: string }): PlanEntry => ({
  id: over.start,
  title: 'Something',
  where: 'Somewhere',
  durationMinutes: 60,
  ...over,
});

describe('which four days', () => {
  it('takes Thursday to Sunday and leaves Trade Day out', () => {
    // 191 events on the Wednesday against 8,046 on the Thursday: it is not one
    // of the four days anybody means.
    expect(conventionDays([WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY], [])).toEqual([
      THURSDAY,
      FRIDAY,
      SATURDAY,
      SUNDAY,
    ]);
  });

  it('reads the weekday rather than trusting a date somebody wrote down', () => {
    // The dates move every year. These are the weekdays they land on, and the
    // rule is about the weekdays.
    expect(weekdayOf(WEDNESDAY)).toBe(3);
    expect([THURSDAY, FRIDAY, SATURDAY, SUNDAY].map(weekdayOf)).toEqual([4, 5, 6, 0]);
    // 2027's convention, which no code here knows the dates of.
    expect(conventionDays(['2027-08-04', '2027-08-05', '2027-08-08'], [])).toEqual([
      '2027-08-05',
      '2027-08-08',
    ]);
  });

  it('answers for one day at a time, which is what the add list asks', () => {
    // Trade Day matches the same searches as everything else and has no column
    // to land in. A session that cannot be added should not be offered.
    expect(isConventionDay(WEDNESDAY)).toBe(false);
    expect([THURSDAY, FRIDAY, SATURDAY, SUNDAY].every(isConventionDay)).toBe(true);
  });

  it('knows about a day the plan has and the feed does not', () => {
    // A plan outlives the feed that made it: no schedule fetched, or last
    // year's, and the days still have to come from somewhere.
    expect(conventionDays([], [entry({ start: `${SATURDAY}T10:00:00-04:00` })])).toEqual([SATURDAY]);
  });

  it('names them the way somebody would say them', () => {
    expect([THURSDAY, SUNDAY].map(dayName)).toEqual(['Thursday', 'Sunday']);
  });
});

describe('which day it is', () => {
  it('answers in the convention’s own time, not the viewer’s', () => {
    // 10pm Wednesday in California is 1am Thursday in Indianapolis. The tab to
    // highlight is Thursday's, and reading the viewer's clock would say
    // Wednesday — a day out, for anybody planning from the west coast.
    const indianapolis = offsetMinutesOf('2026-07-30T09:00:00-04:00')!;
    expect(indianapolis).toBe(-240);
    const lateWednesdayInCalifornia = Date.parse('2026-07-30T05:00:00Z');
    expect(dayAt(lateWednesdayInCalifornia, indianapolis)).toBe(THURSDAY);
  });

  it('reads a half-hour offset the right way round', () => {
    // -04:30 is four and a half hours behind, not three and a half.
    expect(offsetMinutesOf('2026-07-30T09:00:00-04:30')).toBe(-270);
    expect(offsetMinutesOf('2026-07-30T09:00:00+05:30')).toBe(330);
    expect(offsetMinutesOf('2026-07-30T09:00:00')).toBeNull();
  });
});

describe('the walk between two entries', () => {
  const hallA = entry({
    id: 'a',
    start: `${THURSDAY}T09:00:00-04:00`,
    end: `${THURSDAY}T10:00:00-04:00`,
    roomId: 'hall-a',
    title: 'In the hall',
  });
  const westin = entry({
    id: 'b',
    start: `${THURSDAY}T11:00:00-04:00`,
    end: `${THURSDAY}T12:00:00-04:00`,
    roomId: 'westin-grand-ballroom',
    title: 'In the Westin',
  });

  it('measures from the entry before it, and gives the first one none', () => {
    const [first, second] = planDay([hallA, westin], THURSDAY);
    expect(first.travelMinutes).toBeNull();
    expect(first.leaveByMs).toBeNull();
    expect(second.travelMinutes).toBe(roughMinutes(entrySpot(hallA), entrySpot(westin)));
    expect(second.travelMinutes!).toBeGreaterThan(0);
  });

  it('puts the walk in front of the event, not after it', () => {
    const [, second] = planDay([hallA, westin], THURSDAY);
    expect(second.leaveByMs).toBe(second.startMs - second.travelMinutes! * 60_000);
    expect(second.leaveByMs!).toBeLessThan(second.startMs);
  });

  it('orders the day by time however the entries were added', () => {
    // They are added in the order somebody finds them, which is not the order
    // they happen in — and the walk is between *neighbours in time*.
    const [first, second] = planDay([westin, hallA], THURSDAY);
    expect(first.entry.id).toBe('a');
    expect(second.entry.id).toBe('b');
  });

  it('says so when the walk does not fit in the gap', () => {
    // The thing worth knowing before Saturday: the previous event is still
    // running when you would have to leave for this one.
    const backToBack = { ...westin, start: `${THURSDAY}T10:01:00-04:00`, end: `${THURSDAY}T11:00:00-04:00` };
    const [, tight] = planDay([hallA, backToBack], THURSDAY);
    expect(tight.clash).toBe(true);
    // An hour later and the same walk is comfortable.
    expect(planDay([hallA, westin], THURSDAY)[1].clash).toBe(false);
  });

  it('keeps each day to itself', () => {
    const friday = { ...westin, id: 'c', start: `${FRIDAY}T09:00:00-04:00` };
    expect(planDay([hallA, friday], THURSDAY).map((item) => item.entry.id)).toEqual(['a']);
    // And the Friday entry is the first of its own day, so it has no walk —
    // rather than a walk from Thursday's last event.
    expect(planDay([hallA, friday], FRIDAY)[0].travelMinutes).toBeNull();
  });
});

describe('the ruler down the side', () => {
  const day = [
    entry({ id: 'a', start: `${THURSDAY}T09:00:00-04:00`, end: `${THURSDAY}T10:00:00-04:00`, roomId: 'hall-a' }),
    entry({ id: 'b', start: `${THURSDAY}T14:00:00-04:00`, end: `${THURSDAY}T15:00:00-04:00`, roomId: 'hall-a' }),
  ];

  it('covers everything on the day, on whole hours', () => {
    const axis = dayAxis(planDay(day, THURSDAY), null)!;
    expect(axis.fromMs).toBeLessThanOrEqual(Date.parse(`${THURSDAY}T09:00:00-04:00`));
    expect(axis.toMs).toBeGreaterThanOrEqual(Date.parse(`${THURSDAY}T15:00:00-04:00`));
    expect(axis.fromMs % 3_600_000).toBe(0);
    expect(axis.hours[0]).toBe(axis.fromMs);
    expect(axis.hours[axis.hours.length - 1]).toBe(axis.toMs);
  });

  it('stretches to reach the current time, so the mark has somewhere to sit', () => {
    // A Saturday whose only entry was this morning still has to show a line at
    // four in the afternoon. Without this the mark is off the end of the ruler.
    const evening = Date.parse(`${THURSDAY}T22:00:00-04:00`);
    const axis = dayAxis(planDay(day, THURSDAY), evening)!;
    expect(axis.toMs).toBeGreaterThan(evening);
    expect(dayAxis(planDay(day, THURSDAY), null)!.toMs).toBeLessThan(evening);
  });

  it('has nothing to draw for a day with nothing on it', () => {
    expect(dayAxis([], Date.now())).toBeNull();
  });
});

describe('what an entry remembers', () => {
  const event: ConEvent = {
    id: 'RPG26ND123',
    title: 'A game of something',
    locationText: 'ICC',
    roomText: 'Room 120',
    start: `${THURSDAY}T09:00:00-04:00`,
    end: `${THURSDAY}T13:00:00-04:00`,
  };

  it('copies the event rather than pointing at it', () => {
    // The feed is fetched, is 27,467 events, and may never arrive. A saved plan
    // has to render without it.
    const saved = planEntry(event, { id: 'hall-a' });
    expect(saved).toMatchObject({ id: event.id, title: event.title, start: event.start });
    expect(saved.roomId).toBe('hall-a');
    expect(saved.where).toContain('Hall A');
  });

  it('prefers the room the app has now over the label it saved', () => {
    // A room renamed between one release and the next should read the new name,
    // and the snapshot is only the fallback.
    const stale = { ...planEntry(event, { id: 'hall-a' }), where: 'whatever it was called last year' };
    expect(entryWhere(stale)).toContain('Hall A');
  });

  it('falls back to the snapshot when the room is gone', () => {
    const orphan = { ...planEntry(event, { id: 'hall-a' }), roomId: 'no-such-room' };
    expect(entryWhere(orphan)).toContain('Hall A');
  });

  it('remembers somewhere with no room at all', () => {
    const pin = { id: 'pin', name: 'Some Restaurant', address: '1 Street', lat: 39.77, lng: -86.16 };
    const saved = planEntry({ ...event, locationText: 'Some Restaurant' }, undefined, pin);
    expect(saved.where).toBe('Some Restaurant');
    expect(entrySpot(saved)).toEqual({ roomId: undefined, at: { lat: 39.77, lng: -86.16 } });
  });
});
