/**
 * The hotels somebody has booked, kept on the device.
 *
 * Same store, same rules and the same reasons as `usePlan`: no account, no
 * server, `localStorage`, a version on what is written, everything read back
 * defensively, and nothing in here can throw. See that file for the argument.
 *
 * It is a separate key from the plan and from the budget because it is written
 * from a different page. The hotels page should not have to load the budget to
 * mark a room booked, and a corrupt budget should not cost somebody the record
 * of where they are sleeping.
 */

import { useCallback, useEffect, useState } from 'react';
import { usableBooking, type Booking } from '../data/bookings';

const KEY = 'genCon.bookings';
const VERSION = 1;

interface Saved {
  version: number;
  bookings: Booking[];
}

export function readBookings(): Booking[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw) as Partial<Saved>;
    if (saved?.version !== VERSION || !Array.isArray(saved.bookings)) return [];
    return saved.bookings.filter(usableBooking);
  } catch {
    return [];
  }
}

export interface Bookings {
  all: Booking[];
  booked: (placeId: string) => boolean;
  of: (placeId: string) => Booking | null;
  /** Books it, or replaces the booking already there for that place. */
  book: (booking: Booking) => void;
  unbook: (placeId: string) => void;
  /** Books it if it is not, unbooks it if it is — what one button needs. */
  toggle: (booking: Booking) => void;
  change: (placeId: string, patch: Partial<Booking>) => void;
}

export function useBookings(): Bookings {
  const [all, setAll] = useState<Booking[]>(readBookings);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ version: VERSION, bookings: all } satisfies Saved));
    } catch {
      // A private window that has storage and refuses it. The bookings work for
      // this session; they just will not outlive it.
    }
  }, [all]);

  const book = useCallback((booking: Booking) => {
    // Replacing rather than skipping, so re-booking a place after its price
    // changed takes the newer rate — but keeping whoever was already assigned
    // to it, which the hotels page does not know and would otherwise wipe.
    setAll((current) => [
      ...current.filter((held) => held.placeId !== booking.placeId),
      { ...booking, who: booking.who.length > 0 ? booking.who : (current.find((held) => held.placeId === booking.placeId)?.who ?? []) },
    ]);
  }, []);

  const unbook = useCallback((placeId: string) => {
    setAll((current) => current.filter((held) => held.placeId !== placeId));
  }, []);

  const toggle = useCallback(
    (booking: Booking) =>
      setAll((current) =>
        current.some((held) => held.placeId === booking.placeId)
          ? current.filter((held) => held.placeId !== booking.placeId)
          : [...current, booking],
      ),
    [],
  );

  const change = useCallback((placeId: string, patch: Partial<Booking>) => {
    setAll((current) =>
      current.map((held) => (held.placeId === placeId ? { ...held, ...patch } : held)),
    );
  }, []);

  const booked = useCallback((placeId: string) => all.some((held) => held.placeId === placeId), [all]);
  const of = useCallback(
    (placeId: string) => all.find((held) => held.placeId === placeId) ?? null,
    [all],
  );

  return { all, booked, of, book, unbook, toggle, change };
}
