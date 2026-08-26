/**
 * Which days somebody is allowed in the building.
 *
 * A Gen Con badge is not a ticket to the convention; it is a ticket to some of
 * it. A 4-day badge covers Thursday to Sunday. A single-day badge covers one
 * day. Trade Day is Wednesday and is a different badge entirely, sold to the
 * trade rather than to attendees. So "I have a badge" is not an answer to
 * "can I be at this event", and the schedule is full of events on days people
 * have not bought.
 *
 * That is the whole reason this file exists: the budget knows what everybody is
 * going to, and it is the only place in the app that can put the two together
 * and say *you have a Sunday game and a Thursday-only badge*.
 *
 * THE DAYS ARE DERIVED, NOT WRITTEN DOWN. `conventionDaysOf` already works out
 * Thursday-to-Sunday from the first-Saturday-of-August rule that has held for
 * every Gen Con the API carries. Writing the 2027 dates in here as well would
 * be a second copy to get wrong in 2028.
 *
 * PRICES ARE NOT HERE. Gen Con sets badge prices per year, raises them at the
 * door, and publishes them behind a store that cannot be fetched. Somebody
 * types what they paid; this file only says which days it bought.
 */

import { conventionDaysOf, conventionWednesday } from './key-dates';

export type BadgeKind = 'four-day' | 'thursday' | 'friday' | 'saturday' | 'sunday' | 'trade-day' | 'none';

export const BADGE_NAMES: Record<BadgeKind, string> = {
  'four-day': '4-day badge',
  thursday: 'Thursday only',
  friday: 'Friday only',
  saturday: 'Saturday only',
  sunday: 'Sunday only',
  'trade-day': 'Trade Day (Wednesday)',
  none: 'No badge yet',
};

/** In the order the store lists them, which is the order people think in. */
export const BADGE_KINDS: readonly BadgeKind[] = [
  'four-day',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'trade-day',
  'none',
];

const iso = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The days a badge lets somebody in, as ISO dates.
 *
 * Trade Day is its own day and covers nothing else — a Trade Day badge is not
 * a convention badge and someone holding only that one cannot be at a Friday
 * game. Saying so is the point of this function.
 */
export function daysCovered(kind: BadgeKind, year: number): string[] {
  const [thursday, friday, saturday, sunday] = conventionDaysOf(year);
  switch (kind) {
    case 'four-day':
      return [thursday, friday, saturday, sunday];
    case 'thursday':
      return [thursday];
    case 'friday':
      return [friday];
    case 'saturday':
      return [saturday];
    case 'sunday':
      return [sunday];
    case 'trade-day':
      return [iso(conventionWednesday(year))];
    case 'none':
      return [];
  }
}

/** What a badge is, as the budget holds it: whose it is and what it buys. */
export interface Badge {
  personId: string;
  kind: BadgeKind;
}

/** Is this really a badge, or whatever else was under that key? */
export function usableBadge(value: unknown): value is Badge {
  const one = value as Partial<Badge> | null;
  return !!one && typeof one.personId === 'string' && BADGE_KINDS.includes(one.kind as BadgeKind);
}
