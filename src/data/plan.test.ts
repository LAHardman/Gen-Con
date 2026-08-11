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
  dayName,
  entrySpot,
  entryWhere,
  isConventionDay,
  minutesInto,
  planDay,
  planEntry,
  sharedAxis,
  weekdayOf,
  clockMinutes,
  clockValue,
  entryEndMs,
  formatOffset,
  NOON,
  stopEntry,
  suggestedStart,
  type PlanEntry,
} from './plan';
import { dayKey, dayAt, offsetMinutesOf, type ConEvent } from './events';
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

describe('the one ruler all four days share', () => {
  const EAST = -240;
  const day = [
    entry({ id: 'a', start: `${THURSDAY}T09:00:00-04:00`, end: `${THURSDAY}T10:00:00-04:00`, roomId: 'hall-a' }),
    entry({ id: 'b', start: `${THURSDAY}T14:00:00-04:00`, end: `${THURSDAY}T15:00:00-04:00`, roomId: 'hall-a' }),
  ];
  const saturdayEvening = entry({
    id: 'c',
    start: `${SATURDAY}T20:00:00-04:00`,
    end: `${SATURDAY}T23:00:00-04:00`,
    roomId: 'hall-a',
  });

  it('measures in minutes past midnight, so the same hour is the same height', () => {
    // The whole point of one axis. Thursday's ten o'clock and Saturday's ten
    // o'clock have to land in the same place, or the four columns cannot be
    // compared — which is what a four-day view is for.
    const thursdayTen = minutesInto(Date.parse(`${THURSDAY}T10:00:00-04:00`), THURSDAY, EAST);
    const saturdayTen = minutesInto(Date.parse(`${SATURDAY}T10:00:00-04:00`), SATURDAY, EAST);
    expect(thursdayTen).toBe(600);
    expect(saturdayTen).toBe(600);
  });

  it('covers every day at once, on whole hours', () => {
    const axis = sharedAxis([planDay(day, THURSDAY), planDay([saturdayEvening], SATURDAY)], null)!;
    // 9am on the Thursday down to 11pm on the Saturday, in one ruler.
    expect(axis.fromMinutes).toBeLessThanOrEqual(9 * 60);
    expect(axis.toMinutes).toBeGreaterThanOrEqual(23 * 60);
    expect(axis.fromMinutes % 60).toBe(0);
    expect(axis.hours[0]).toBe(axis.fromMinutes);
    expect(axis.hours[axis.hours.length - 1]).toBe(axis.toMinutes);
  });

  it('is not narrowed by the day that happens to be looked at', () => {
    // Thursday alone stops at three; with the Saturday in it the ruler has to
    // reach eleven, or the Saturday's blocks fall off the bottom of it.
    const thursdayOnly = sharedAxis([planDay(day, THURSDAY)], null)!;
    const both = sharedAxis([planDay(day, THURSDAY), planDay([saturdayEvening], SATURDAY)], null)!;
    expect(both.toMinutes).toBeGreaterThan(thursdayOnly.toMinutes);
  });

  it('stretches to reach the current time, so the mark has somewhere to sit', () => {
    // A Saturday whose only entry was this morning still has to show a line at
    // ten at night. Without this the mark is off the end of the ruler.
    const axis = sharedAxis([planDay(day, THURSDAY)], 22 * 60)!;
    expect(axis.toMinutes).toBeGreaterThanOrEqual(22 * 60);
    expect(sharedAxis([planDay(day, THURSDAY)], null)!.toMinutes).toBeLessThan(22 * 60);
  });

  it('lets an event run past midnight rather than wrapping it to the top', () => {
    // A game from eight until two belongs on the day it started, drawn
    // continuing off the bottom — not folded round to two in the morning.
    const late = entry({
      id: 'late',
      start: `${THURSDAY}T20:00:00-04:00`,
      end: `${FRIDAY}T02:00:00-04:00`,
      roomId: 'hall-a',
    });
    const axis = sharedAxis([planDay([late], THURSDAY)], null)!;
    expect(axis.toMinutes).toBeGreaterThan(24 * 60);
    expect(minutesInto(Date.parse(`${FRIDAY}T02:00:00-04:00`), THURSDAY, EAST)).toBe(26 * 60);
  });

  it('has nothing to draw when nothing is planned at all', () => {
    expect(sharedAxis([[], []], null)).toBeNull();
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

/* --------------------------------------------------------------- stops */

describe('somewhere to be that is not a session', () => {
  const truck = { key: 'vendor:14179', title: 'Arepas', where: 'Block Party', roomId: 'block-party-street' };
  const EAST = -240;

  it('writes the times in the convention’s own offset', () => {
    // The one thing that would otherwise be wrong by hours for anybody planning
    // from another zone: "half past one" has to mean half past one *there*.
    const lunch = stopEntry(truck, {
      day: SATURDAY,
      fromMinutes: 13 * 60 + 30,
      toMinutes: 14 * 60,
      offsetMinutes: EAST,
    });
    expect(lunch.start).toBe(`${SATURDAY}T13:30:00-04:00`);
    expect(lunch.end).toBe(`${SATURDAY}T14:00:00-04:00`);
    expect(dayKey(lunch.start)).toBe(SATURDAY);
    expect(offsetMinutesOf(lunch.start)).toBe(EAST);
  });

  it('is walked to exactly like a session, because that is the point', () => {
    // The whole reason a truck is worth putting on a schedule: the walk to it
    // costs what the walk to a seminar in the same place costs.
    const game = entry({ id: 'game', start: `${SATURDAY}T09:00:00-04:00`, roomId: 'hall-a' });
    const lunch = stopEntry(truck, {
      day: SATURDAY,
      fromMinutes: 11 * 60,
      toMinutes: 11 * 60 + 30,
      offsetMinutes: EAST,
    });
    const [, second] = planDay([game, lunch], SATURDAY);
    expect(second.entry.id).toBe(lunch.id);
    expect(second.travelMinutes).toBe(roughMinutes({ roomId: 'hall-a' }, { roomId: 'block-party-street' }));
    expect(second.travelMinutes).toBeGreaterThan(0);
  });

  it('keeps two visits to the same place apart', () => {
    // Breakfast and dinner at the same truck are two commitments on two parts
    // of the day. An id that was only the truck would make the second one
    // silently replace the first.
    const when = { day: SATURDAY, toMinutes: 9 * 60, offsetMinutes: EAST };
    const breakfast = stopEntry(truck, { ...when, fromMinutes: 8 * 60, toMinutes: 8 * 60 + 30 });
    const dinner = stopEntry(truck, { ...when, fromMinutes: 19 * 60, toMinutes: 19 * 60 + 30 });
    expect(breakfast.id).not.toBe(dinner.id);
    // The same place at the same minute twice is still one thing, which is what
    // a double-tap should do.
    expect(stopEntry(truck, { ...when, fromMinutes: 8 * 60, toMinutes: 8 * 60 + 30 }).id).toBe(
      breakfast.id,
    );
  });

  it('reads an end before its start as the next morning', () => {
    // `<input type="time">` gives back a clock, and a clock has no date on it,
    // so eleven to half past midnight arrives as 1380 → 30. Refusing it would
    // refuse the span most likely to be typed at a beer garden.
    const late = stopEntry(truck, {
      day: SATURDAY,
      fromMinutes: 23 * 60,
      toMinutes: 30,
      offsetMinutes: EAST,
    });
    expect(late.end).toBe(`${SUNDAY}T00:30:00-04:00`);
    expect(dayKey(late.start)).toBe(SATURDAY);
    expect(entryEndMs(late) - Date.parse(late.start)).toBe(90 * 60_000);
  });

  it('suggests a start after whatever is already on that day', () => {
    // Somebody adding lunch to a Saturday with a game running until one means
    // lunch after the game, and noon is inside it.
    const game = entry({
      id: 'game',
      start: `${SATURDAY}T09:00:00-04:00`,
      end: `${SATURDAY}T12:50:00-04:00`,
      roomId: 'hall-a',
    });
    // Up to the next quarter hour, so it reads as a time somebody would pick.
    expect(suggestedStart([game], SATURDAY)).toBe(13 * 60);
    // Nothing on the day is nothing to be after.
    expect(suggestedStart([game], SUNDAY)).toBe(NOON);
  });

  it('survives a clock that is not one', () => {
    expect(clockMinutes('13:30')).toBe(13 * 60 + 30);
    expect(clockMinutes('')).toBeNull();
    expect(clockMinutes('25:00')).toBeNull();
    expect(clockValue(13 * 60 + 5)).toBe('13:05');
    // Past midnight wraps, which is what a clock does.
    expect(clockValue(25 * 60)).toBe('01:00');
  });

  it('writes the offset the way the feed writes it', () => {
    expect(formatOffset(-240)).toBe('-04:00');
    expect(formatOffset(0)).toBe('+00:00');
    expect(formatOffset(330)).toBe('+05:30');
  });

  it('reads back as an entry a plan saved before stops existed', () => {
    // `kind` is absent on every entry saved by an older release, and absent has
    // to keep meaning "event" or a saved plan reads as a page of food trucks.
    expect(entry({ start: `${SATURDAY}T09:00:00-04:00` }).kind).toBeUndefined();
    expect(stopEntry(truck, { day: SATURDAY, fromMinutes: 60, toMinutes: 90, offsetMinutes: EAST }).kind).toBe('stop');
  });
});

describe('what a block says about where it is', () => {
  const event: ConEvent = {
    id: 'RPG26ND123',
    title: 'A game of something',
    locationText: 'ICC',
    start: `${THURSDAY}T09:00:00-04:00`,
  };

  it('keeps a stop’s own label, which is more specific than its room', () => {
    // "Food Truck 12 · Block Party" against a room called Block Party inside a
    // venue called Block Party. The room lookup would print the street twice
    // and lose the only part of it anybody navigates by.
    const lunch = {
      ...stopEntry(
        { key: 'vendor:1', title: 'Arepas', where: 'Food Truck 12 · Block Party', roomId: 'block-party-street' },
        { day: SATURDAY, fromMinutes: 13 * 60, toMinutes: 13 * 60 + 30, offsetMinutes: -240 },
      ),
    };
    expect(entryWhere(lunch)).toBe('Food Truck 12 · Block Party');
  });

  it('still prefers the live room for a session, and says the place once', () => {
    const stale = { ...planEntry(event, { id: 'hall-a' }), where: 'whatever it was called last year' };
    expect(entryWhere(stale)).toContain('Hall A');
    const onTheStreet = { ...planEntry(event, { id: 'block-party-street' }), where: 'old' };
    expect(entryWhere(onTheStreet)).toBe('Block Party');
  });
});

describe('two things at the same time', () => {
  const at = (id: string, from: string, to: string, roomId = 'hall-a'): PlanEntry =>
    entry({ id, start: `${SATURDAY}T${from}:00-04:00`, end: `${SATURDAY}T${to}:00-04:00`, roomId });

  it('draws them side by side rather than one behind the other', () => {
    // Twenty minutes at a food truck during a four-hour game is a completely
    // ordinary thing to plan, and the whole point of drawing it is to see that
    // it does not fit. Behind the game it says nothing at all.
    const items = planDay([at('game', '10:00', '14:00'), at('lunch', '13:00', '13:20')], SATURDAY);
    expect(items.map((one) => one.lane)).toEqual([0, 1]);
    expect(items.every((one) => one.lanes === 2)).toBe(true);
  });

  it('gives the whole width back once nothing overlaps', () => {
    const items = planDay([at('morning', '09:00', '10:00'), at('afternoon', '14:00', '15:00')], SATURDAY);
    expect(items.every((one) => one.lanes === 1 && one.lane === 0)).toBe(true);
  });

  it('narrows only the run that clashes, not the rest of the day', () => {
    // One clash in the morning must not squeeze an afternoon that is fine.
    const items = planDay(
      [at('a', '09:00', '11:00'), at('b', '10:00', '10:30'), at('c', '15:00', '16:00')],
      SATURDAY,
    );
    expect(items.map((one) => one.lanes)).toEqual([2, 2, 1]);
  });

  it('reuses a lane once the thing in it has finished', () => {
    const items = planDay(
      [at('a', '09:00', '12:00'), at('b', '09:30', '10:00'), at('c', '10:30', '11:00')],
      SATURDAY,
    );
    // b and c never overlap each other, so c goes back into lane 1.
    expect(items.map((one) => one.lane)).toEqual([0, 1, 1]);
  });

  it('counts the height a block is actually drawn at, not the minutes it holds', () => {
    // A five-minute stop is drawn at the readable minimum, so it covers more of
    // the column than it owns — and two blocks that only overlap once they are
    // drawn are still two blocks on top of each other.
    const items = planDay([at('quick', '09:00', '09:05'), at('next', '09:10', '10:00')], SATURDAY);
    expect(items.map((one) => one.lane)).toEqual([0, 1]);
  });
});
