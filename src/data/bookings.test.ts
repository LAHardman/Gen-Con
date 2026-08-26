/**
 * Booked hotels, judged on the two things a booking must not do: cost a
 * different amount tomorrow than it did today, and quietly go negative.
 */

import { describe, expect, it } from 'vitest';
import { bookingCents, nightsBetween, usableBooking, type Booking } from './bookings';

const booking = (over: Partial<Booking> = {}): Booking => ({
  placeId: 'w1',
  name: 'JW Marriott Indianapolis',
  nightlyCents: 28_700,
  in: '2027-08-04',
  out: '2027-08-08',
  who: [],
  ...over,
});

describe('counting nights', () => {
  it('counts the nights, not the days', () => {
    // Wednesday in, Sunday out, is four nights. Getting this wrong by one is
    // getting a $287 hotel wrong by $287.
    expect(nightsBetween('2027-08-04', '2027-08-08')).toBe(4);
    expect(nightsBetween('2027-08-04', '2027-08-05')).toBe(1);
  });

  it('counts none for arriving and leaving the same day', () => {
    expect(nightsBetween('2027-08-04', '2027-08-04')).toBe(0);
  });

  it('refuses to go negative when the dates are the wrong way round', () => {
    /*
     * Somebody mid-edit, having typed the check-out first. A negative night
     * count would come out of `bookingCents` as a credit, and a budget that
     * pays you to stay somewhere is a budget with a bug in it.
     */
    expect(nightsBetween('2027-08-08', '2027-08-04')).toBe(0);
  });

  it('counts none rather than NaN for a date that is not one', () => {
    expect(nightsBetween('', '2027-08-08')).toBe(0);
    expect(nightsBetween('2027-08-04', 'soon')).toBe(0);
  });

  it('counts across a month end, which is where Gen Con actually falls', () => {
    // 2026 ran 29 July to 2 August. A naive day-of-month subtraction gives -27.
    expect(nightsBetween('2026-07-29', '2026-08-02')).toBe(4);
  });

  it('counts across a daylight-saving change without losing an hour', () => {
    /*
     * A property worth locking rather than a guard against the current code:
     * a date-only ISO string is parsed as UTC by the language itself, so both
     * this implementation and the obvious one without the explicit `Z` are
     * already safe here. What this pins is the *answer*, so a rewrite in terms
     * of local date components — where one of these days is 23 hours long and
     * the rounding drops a night — cannot land quietly.
     */
    expect(nightsBetween('2027-03-13', '2027-03-15')).toBe(2);
    expect(nightsBetween('2027-11-06', '2027-11-08')).toBe(2);
  });
});

describe('what a booking costs', () => {
  it('is the nightly rate for as many nights as it runs', () => {
    expect(bookingCents(booking())).toBe(114_800);
  });

  it('is nothing when it is nothing, rather than a night of it', () => {
    expect(bookingCents(booking({ in: '2027-08-04', out: '2027-08-04' }))).toBe(0);
  });
});

describe('reading back what was saved', () => {
  it('takes a booking', () => {
    expect(usableBooking(booking())).toBe(true);
  });

  it('refuses whatever else was under the key', () => {
    for (const value of [null, undefined, 42, 'a booking', {}, []]) {
      expect(usableBooking(value)).toBe(false);
    }
  });

  it('refuses a booking with a price that is not a number', () => {
    // The one field the budget adds up. A NaN here is a NaN total, and a total
    // that reads "$NaN" is a page somebody closes.
    expect(usableBooking({ ...booking(), nightlyCents: NaN })).toBe(false);
    expect(usableBooking({ ...booking(), nightlyCents: '287' })).toBe(false);
    expect(usableBooking({ ...booking(), nightlyCents: Infinity })).toBe(false);
  });

  it('refuses a booking whose people are not people', () => {
    expect(usableBooking({ ...booking(), who: 'everyone' })).toBe(false);
    expect(usableBooking({ ...booking(), who: [1, 2] })).toBe(false);
  });
});
