import { fromPack } from './pack-runtime';
/**
 * What a badge costs, read off Gen Con's own page.
 *
 * `badges.ts` used to say prices were not obtainable — "published behind a
 * store that cannot be fetched" — and that was half right. The store is
 * behind a login, but the rate card is not: `/gen-con-indy/your_badge` sets
 * it out as a plain HTML table, badge type against price, and has for every
 * cycle. So the numbers are here, and `season:badge-prices` re-reads that
 * table rather than waiting for somebody to notice it moved.
 *
 * THE TRAP IN THAT PAGE, WHICH THIS FILE IS SHAPED AROUND. Gen Con does not
 * delete last cycle's prices when the convention ends — it wraps the table
 * in an HTML comment and leaves it there while the new page is written.
 * Right now, on the live page, that is exactly where these six figures are.
 * A scraper that strips tags without stripping comments would read them
 * happily and call them next year's, which is the one failure worse than
 * having no price at all: a wrong number nobody doubts. So the probe reads
 * the live half and the commented half separately, and only the live half
 * can ever raise `YEAR`.
 *
 * WHICH MEANS THESE GO STALE HONESTLY RATHER THAN SILENTLY. `YEAR` is the
 * convention these prices were published for, and the app prints it. When
 * Gen Con has not yet published the next one — which is most of the year,
 * and is the state the page is in today — a copy that can no longer update
 * still shows last year's figures, labelled as last year's. That is worth
 * more than an empty column: badge prices move by a few dollars a cycle, so
 * an old price is a good estimate and a blank is no estimate at all.
 *
 * TWO THINGS THAT ARE NOT THE PRICE AND ARE PART OF WHAT YOU PAY. Marion
 * County adds a 10% admissions tax to every badge type, and it is not in
 * the table — the page states it underneath in small print. And a posted
 * badge is $16 on top, once per shipment rather than once per badge, which
 * is why it is a separate constant and not folded into anything.
 */

import type { BadgeKind } from './badges';

/** Where the table is, and what the probe re-reads. */
export const SOURCE = 'https://www.gencon.com/gen-con-indy/your_badge';

/**
 * The convention year these prices were published for.
 *
 * Below the year being planned means Gen Con has not published the next
 * card yet — ordinary for most of the year, and the app says so rather
 * than implying the old figures are current.
 */
const COMPILED_YEAR = 2026;

/** The day the table was last read off the page. */
const COMPILED_CHECKED = '2026-08-28';

/**
 * Face price in whole cents, before the county's tax.
 *
 * `none` has no price because it is not a badge — it is the budget's way of
 * saying somebody has not bought one, and pricing it would put a line in
 * the total for a thing nobody owns.
 */
const COMPILED_CENTS: Record<BadgeKind, number | null> = {
  'four-day': 16_400,
  thursday: 8_300,
  friday: 8_300,
  saturday: 11_200,
  sunday: 4_100,
  'trade-day': 30_200,
  none: null,
};

/**
 * Marion County's admissions tax, which applies to every badge type and is
 * stated on the page as a footnote rather than as part of the table.
 */
const COMPILED_TAX = 0.1;

/**
 * USPS Priority Mail for a packet, the default delivery. Once per shipment,
 * not once per badge — buying four badges on one account posts one packet.
 * Will Call is free, which is why there is no constant for it.
 */
const COMPILED_SHIPPING_CENTS = 1_600;

/**
 * The pack's copy where one is held, else what was compiled in.
 *
 * Prices are the clearest case the pack exists for: they change once a year,
 * on a page anybody can read, and a phone that can no longer be updated
 * through a store can still take them from a pack refresh.
 */
const PACKED = fromPack('badge-prices', {
  BADGE_CENTS: COMPILED_CENTS,
  BADGE_PRICE_YEAR: COMPILED_YEAR,
  BADGE_PRICES_CHECKED: COMPILED_CHECKED,
  ADMISSIONS_TAX: COMPILED_TAX,
  SHIPPING_CENTS: COMPILED_SHIPPING_CENTS,
});

export const BADGE_CENTS = PACKED.BADGE_CENTS;
export const BADGE_PRICE_YEAR = PACKED.BADGE_PRICE_YEAR;
export const BADGE_PRICES_CHECKED = PACKED.BADGE_PRICES_CHECKED;
export const ADMISSIONS_TAX = PACKED.ADMISSIONS_TAX;
export const SHIPPING_CENTS = PACKED.SHIPPING_CENTS;

/** The face price of one badge, or null for `none` and anything unpriced. */
export const badgeCents = (kind: BadgeKind): number | null => BADGE_CENTS[kind] ?? null;

/**
 * What the card actually gets charged: the face price plus the county's cut.
 *
 * Rounded to the cent, because that is the unit the store charges in and the
 * budget holds. The tax is not optional and not avoidable, so seeding a
 * budget line with the pre-tax figure would understate every trip by a tenth.
 */
export const withTax = (cents: number): number => Math.round(cents * (1 + ADMISSIONS_TAX));

/** The taxed price of a badge kind, ready to seed a line with. */
export const badgeCentsWithTax = (kind: BadgeKind): number | null => {
  const face = badgeCents(kind);
  return face === null ? null : withTax(face);
};

/**
 * Whether these prices are from an earlier convention than the one being
 * planned — the state the app labels rather than hides.
 */
export const pricesArePrevious = (planning: number): boolean => BADGE_PRICE_YEAR < planning;
