/**
 * The hotels somebody has actually booked.
 *
 * The hotels page prices two hundred places. This is the two or three that got
 * chosen — and it is a separate thing from the prices for the same reason a
 * plan is a separate thing from the feed: **what is saved is a copy**. A
 * booking carries the nightly rate as it read on the day it was marked, not a
 * pointer into `rates.ts`, because that file is rewritten every month by a
 * scheduled run and a budget that silently re-priced itself overnight would be
 * a budget nobody could reconcile against a card statement.
 *
 * MORE THAN ONE, ON PURPOSE. A party of six splits across two hotels; somebody
 * drives in Wednesday and moves nearer the hall for the weekend. Both are
 * ordinary, so nothing here treats a second booking as a replacement for the
 * first — they are a list, and they overlap freely.
 *
 * Nothing here touches storage or React. `useBookings` does that.
 */

/** Whole days between two ISO dates, which for a hotel is the number of nights. */
export function nightsBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  // Never negative. A check-out before the check-in is somebody mid-edit, and
  // a negative number of nights would come out as a credit on the budget.
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export interface Booking {
  /** The place on the hotels page, which is what stops it being booked twice. */
  placeId: string;
  /** Its name as it read when booked, so a booking survives the list changing. */
  name: string;
  /** Cents a night, copied at the moment of booking. See above. */
  nightlyCents: number;
  /** Check-in and check-out, ISO dates. */
  in: string;
  out: string;
  /** Person ids sleeping in it. Empty is the whole party — see `bearersOf`. */
  who: string[];
  /** Where it was booked, when the price came with a link. */
  link?: string | null;
  /** Whether this was Gen Con's own block rate, which is a different promise. */
  block?: boolean;
}

/** What a booking costs: the nightly rate, for as many nights as it runs. */
export function bookingCents(booking: Booking): number {
  return booking.nightlyCents * nightsBetween(booking.in, booking.out);
}

/** Is this really a booking, or whatever else was under that key? */
export function usableBooking(value: unknown): value is Booking {
  const one = value as Partial<Booking> | null;
  return (
    !!one &&
    typeof one.placeId === 'string' &&
    typeof one.name === 'string' &&
    typeof one.nightlyCents === 'number' &&
    Number.isFinite(one.nightlyCents) &&
    typeof one.in === 'string' &&
    typeof one.out === 'string' &&
    Array.isArray(one.who) &&
    one.who.every((id) => typeof id === 'string')
  );
}
