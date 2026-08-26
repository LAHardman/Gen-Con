/**
 * Where the budget's derived lines come from.
 *
 * Two things on this app already know what they cost, and neither of them is
 * the budget: a hotel somebody marked as booked, and a session on their
 * schedule that the feed prices. Re-typing either into the budget would be
 * asking somebody to keep two copies of the same number in step, so the budget
 * reads them instead — every render, from the live store.
 *
 * That is the whole reason these are computed rather than saved. Un-book the
 * hotel and its line is gone on the next render; drop the session from the
 * schedule and so is its ticket. Nothing is left behind to go stale.
 *
 * WHAT IS SAVED IS ONLY THE ASSIGNMENT — which of them belongs to whom, keyed
 * by the event's own id, because that is the one thing about a derived line
 * that nowhere else knows. A booking keeps its own, since who is sleeping in a
 * room is part of the booking rather than something said about it afterwards.
 */

import { bookingCents, nightsBetween, type Booking } from './bookings';
import type { Line } from './budget';
import type { PlanEntry } from './plan';

/** The id a booking's line has, so an assignment can be pinned to it. */
export const bookingLineId = (placeId: string) => `hotel:${placeId}`;
/** The id a planned session's line has. */
export const planLineId = (eventId: string) => `event:${eventId}`;

/** A booked hotel, as the budget sees it. */
export function linesFromBookings(bookings: readonly Booking[]): Line[] {
  return bookings
    // A booking with no nights costs nothing and would show as a $0.00 line
    // between two real ones. It is somebody mid-edit, not a cost.
    .filter((booking) => nightsBetween(booking.in, booking.out) > 0)
    .map((booking) => {
      const nights = nightsBetween(booking.in, booking.out);
      return {
        id: bookingLineId(booking.placeId),
        category: 'hotel' as const,
        label: booking.name,
        cents: booking.nightlyCents,
        times: nights,
        who: booking.who,
        note: `${nights} night${nights === 1 ? '' : 's'}, ${booking.in} to ${booking.out}${
          booking.block ? ' · Gen Con block rate' : ''
        }`,
        from: 'booking' as const,
      };
    });
}

/**
 * The priced sessions on somebody's schedule.
 *
 * Only the priced ones. Most of a Gen Con schedule is free — the exhibit hall,
 * the anime room, half the seminars — and a budget listing forty $0.00 lines
 * would bury the eight that cost something.
 *
 * A plan entry with no `cost` at all is not the same as one costing nothing:
 * the first is an event added before the plan carried prices, or one the feed
 * never priced. Both are left out, because a line the budget cannot price is
 * worse than no line — it reads as "this is free" when the truth is "nobody
 * knows".
 */
export function linesFromPlan(
  entries: readonly PlanEntry[],
  assigned: Readonly<Record<string, string[]>>,
): Line[] {
  return entries
    .filter((entry) => typeof entry.cost === 'number' && entry.cost > 0)
    .map((entry) => ({
      id: planLineId(entry.id),
      category: 'event' as const,
      label: entry.title,
      // The feed prices a ticket in whole dollars. Cents is what everything
      // downstream counts in, and the conversion belongs here rather than in
      // seven places that each have to remember it.
      cents: Math.round(entry.cost! * 100),
      times: 1,
      who: assigned[entry.id] ?? [],
      note: entry.where,
      from: 'plan' as const,
    }));
}

/**
 * Every line the budget has: typed, booked and planned.
 *
 * Typed lines come first within a heading, because they are the ones somebody
 * put there deliberately; `budgetFor` sorts the whole lot by heading after.
 */
export function allLines(
  typed: readonly Line[],
  bookings: readonly Booking[],
  entries: readonly PlanEntry[],
  assigned: Readonly<Record<string, string[]>>,
): Line[] {
  return [...typed, ...linesFromBookings(bookings), ...linesFromPlan(entries, assigned)];
}

/** What the booked hotels come to, for the one-line summary on the hotels page. */
export function bookedTotal(bookings: readonly Booking[]): number {
  return bookings.reduce((sum, booking) => sum + bookingCents(booking), 0);
}
