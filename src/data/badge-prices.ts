import { fromPack } from './pack-runtime';
/**
 * What a badge costs, read off Gen Con's own announcements — and what it
 * will probably cost next, when the next announcement has not happened yet.
 *
 * `badges.ts` used to say prices were "published behind a store that cannot
 * be fetched". The store is behind a login; the announcement is not. Gen Con
 * puts every year's rate card in a January press release and repeats it as a
 * plain table on the badge page, and both are public. So the card is here,
 * and so are the four before it.
 *
 * WHY A HISTORY AND NOT JUST THE LATEST. Gen Con publishes next year's prices
 * in January, five or six months after the last convention ends — so for half
 * of every year the newest card on file is the previous convention's, and a
 * copy that can no longer update at all may hold one for ever. A price four
 * years old is nearly useless on its own. The same price with four years of
 * this card's own increases behind it is a usable estimate, and the app shows
 * both: the last confirmed figure with the year it was confirmed for, and
 * beside it what the trend says the next one is.
 *
 * HOW THE TREND IS TAKEN, AND WHY IT IS A MEDIAN. Each kind's growth is the
 * *median* of its annualised change between consecutive cards, not the
 * average and not end-to-end. Gen Con re-prices a badge type outright now and
 * then — Sunday went from $17 to $39 between 2023 and 2025, more than
 * doubling — and both an average and a straight compound rate would carry
 * that one jump forward for ever, projecting a $200 Sunday badge by the
 * 2030s. A median steps over a single structural break and keeps the ordinary
 * year-on-year rise, which is what the estimate is for. This is the same
 * reading `blocks.ts` takes of Gen Con's hotel block, deliberately: the two
 * estimates in this app should mean the same thing.
 *
 * THE HISTORY HAS A HOLE IN IT, AND THAT IS NOT A BUG. 2024's press release
 * is listed on Gen Con's own index and its URL serves an unrelated release
 * about a sponsor; the card is simply not retrievable. So the years are
 * uneven, and every calculation here annualises over the real gap between two
 * cards rather than assuming they are one year apart. A future gap will be
 * handled the same way.
 *
 * THE TRAP IN THE BADGE PAGE, WHICH THE PROBE IS SHAPED AROUND. Gen Con does
 * not delete last cycle's prices when the convention ends — it wraps the
 * table in an HTML comment and leaves it there while the new page is written.
 * Right now, on the live page, that is exactly where the 2026 figures are. A
 * scraper that strips tags without stripping comments would read them happily
 * and call them next year's, which is the one failure worse than having no
 * price at all: a wrong number nobody doubts. So the probe reads the live
 * half and the commented half separately, and prefers the press release,
 * which names its own year in its title and cannot be ambiguous about it.
 *
 * TWO THINGS THAT ARE NOT THE PRICE AND ARE PART OF WHAT YOU PAY. Marion
 * County adds a 10% admissions tax to every badge type, and it is not in the
 * table — the page states it underneath in small print. And a posted badge is
 * $16 on top, once per shipment rather than once per badge, which is why it
 * is a separate constant and not folded into anything.
 */

import type { BadgeKind } from './badges';

/** Where the rate card is repeated, and what the probe re-reads. */
export const SOURCE = 'https://www.gencon.com/gen-con-indy/your_badge';

/**
 * Gen Con's press-release index, which is where a new card appears first and
 * is the only place it is unambiguously dated.
 *
 * The slugs are not a pattern worth guessing — 2022 and 2023 are
 * `gen-con-20XX-badge-registration`, 2025 is
 * `2025-reg-dates-and-badge-prices-chairman` — so the probe reads the index
 * and follows the title instead.
 */
export const PRESS_INDEX = 'https://www.gencon.com/press/pressreleases';

/** One year's published rate card. */
export interface BadgeCard {
  /** The convention year these prices were published for. */
  year: number;
  /** Face price in whole cents, before tax. Null for a kind not sold that year. */
  cents: Record<BadgeKind, number | null>;
  /** Gen Con's own announcement of it. */
  source: string;
}

/**
 * Every card that could be retrieved, oldest first.
 *
 * All four read from Gen Con's own press releases rather than from a summary
 * of them — a search engine confidently reported 2023's figures as 2024's
 * while this was being gathered, which is exactly the kind of second-hand
 * error a file like this exists to not have. 2024 is missing because Gen Con's
 * own URL for it serves a different release.
 *
 * `none` is not a badge — it is the budget's way of saying somebody has not
 * bought one — so it is priced null in every year and is never estimated.
 */
const COMPILED_HISTORY: readonly BadgeCard[] = [
  {
    year: 2022,
    cents: { 'four-day': 12_500, thursday: 6_500, friday: 6_500, saturday: 8_000, sunday: 1_600, 'trade-day': 22_500, none: null },
    source: 'https://www.gencon.com/press/gen-con-2022-badge-registration',
  },
  {
    year: 2023,
    cents: { 'four-day': 13_500, thursday: 7_000, friday: 7_000, saturday: 8_500, sunday: 1_700, 'trade-day': 23_500, none: null },
    source: 'https://www.gencon.com/press/gen-con-2023-badge-registration',
  },
  {
    year: 2025,
    cents: { 'four-day': 15_500, thursday: 7_800, friday: 7_800, saturday: 9_500, sunday: 3_900, 'trade-day': 25_800, none: null },
    source: 'https://www.gencon.com/press/2025-reg-dates-and-badge-prices-chairman',
  },
  {
    year: 2026,
    cents: { 'four-day': 16_400, thursday: 8_300, friday: 8_300, saturday: 11_200, sunday: 4_100, 'trade-day': 30_200, none: null },
    source: 'https://www.gencon.com/press/2026-reg-dates-and-badge-prices',
  },
];

/** The day the history was last checked against Gen Con's announcements. */
const COMPILED_CHECKED = '2026-08-28';

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
 * through a store can still take them from a pack refresh. The *history* is
 * what travels, not the latest card — everything below is derived from it, so
 * a pack that carries one more year gives this file a new price, a new base
 * year and a re-measured trend together, and they cannot disagree.
 */
const PACKED = fromPack('badge-prices', {
  BADGE_HISTORY: COMPILED_HISTORY,
  BADGE_PRICES_CHECKED: COMPILED_CHECKED,
  ADMISSIONS_TAX: COMPILED_TAX,
  SHIPPING_CENTS: COMPILED_SHIPPING_CENTS,
});

/** Every published card on file, oldest first. */
export const BADGE_HISTORY = [...PACKED.BADGE_HISTORY].sort((a, b) => a.year - b.year);
export const BADGE_PRICES_CHECKED = PACKED.BADGE_PRICES_CHECKED;
export const ADMISSIONS_TAX = PACKED.ADMISSIONS_TAX;
export const SHIPPING_CENTS = PACKED.SHIPPING_CENTS;

/** The newest card Gen Con has actually published. */
export const LATEST_CARD: BadgeCard = BADGE_HISTORY[BADGE_HISTORY.length - 1];

/** The convention year the prices on file were published for. */
export const BADGE_PRICE_YEAR = LATEST_CARD.year;
export const BADGE_CENTS = LATEST_CARD.cents;

/** The face price of one badge as last published, or null for `none`. */
export const badgeCents = (kind: BadgeKind): number | null => BADGE_CENTS[kind] ?? null;

/**
 * What the card actually gets charged: the face price plus the county's cut.
 *
 * Rounded to the cent, because that is the unit the store charges in and the
 * budget holds. The tax is not optional and not avoidable, so seeding a
 * budget line with the pre-tax figure would understate every trip by a tenth.
 */
export const withTax = (cents: number): number => Math.round(cents * (1 + ADMISSIONS_TAX));

/* --------------------------------------------------------------- the trend */

/**
 * The middle value, averaging the two middle ones for an even count.
 *
 * Local rather than imported because it is three lines and this is the only
 * file that needs it; the alternative is a utility module whose only caller
 * is here.
 */
function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * How fast one badge kind's price has actually moved, per year.
 *
 * The median of the annualised change between each consecutive pair of cards
 * — annualised over the real gap, because the years on file are uneven. Null
 * where fewer than two cards price this kind, since one point is not a trend
 * and pretending otherwise would produce a flat projection that looks like a
 * confident forecast of no change.
 */
export function growthOf(kind: BadgeKind): number | null {
  const priced = BADGE_HISTORY.filter((card) => typeof card.cents[kind] === 'number');
  const steps: number[] = [];
  for (let at = 1; at < priced.length; at += 1) {
    const before = priced[at - 1];
    const after = priced[at];
    const years = after.year - before.year;
    if (years <= 0) continue;
    steps.push((after.cents[kind]! / before.cents[kind]!) ** (1 / years) - 1);
  }
  return median(steps);
}

/**
 * The card-wide trend, for a kind with too little history of its own.
 *
 * A badge type Gen Con introduces next year has one price and no growth, and
 * the honest thing to carry it forward at is what the rest of the card is
 * doing rather than nothing at all.
 */
export const CARD_GROWTH: number | null = median(
  (Object.keys(BADGE_CENTS) as BadgeKind[]).map(growthOf).filter((g): g is number => g !== null),
);

/** A price for a year, and whether it is a fact or arithmetic on one. */
export interface BadgeEstimate {
  kind: BadgeKind;
  /** Face price for `year`, in whole cents, before tax. */
  cents: number;
  /** False only for a year Gen Con has actually published. */
  projected: boolean;
  /** Years past the last published card; zero when this is that card. */
  yearsOn: number;
  /** The annual rate it was carried forward at, null when it is not projected. */
  growth: number | null;
  /** What it was carried forward from, which the page prints beside it. */
  from: { year: number; cents: number };
}

/**
 * What a badge costs in a given year: the published price, or an estimate.
 *
 * A year Gen Con has published is returned as published — never re-derived,
 * because a fact beats a fit. Anything later is the last card carried forward
 * at this kind's own measured rate. Anything *earlier* than the last card is
 * also returned as-is rather than projected backwards: nobody is buying a
 * 2024 badge, and back-casting would put a number on screen that contradicts
 * a published one.
 *
 * Rounded to the nearest dollar, because cents on a projection claim a
 * precision nothing here supports and Gen Con quotes whole dollars anyway.
 */
export function badgeEstimate(kind: BadgeKind, year: number): BadgeEstimate | null {
  const latest = badgeCents(kind);
  if (latest === null) return null;

  const published = BADGE_HISTORY.find((card) => card.year === year);
  if (published && typeof published.cents[kind] === 'number') {
    return {
      kind,
      cents: published.cents[kind]!,
      projected: false,
      yearsOn: 0,
      growth: null,
      from: { year: published.year, cents: published.cents[kind]! },
    };
  }

  const from = { year: BADGE_PRICE_YEAR, cents: latest };
  const yearsOn = year - BADGE_PRICE_YEAR;
  if (yearsOn <= 0) {
    return { kind, cents: latest, projected: false, yearsOn: 0, growth: null, from };
  }

  const growth = growthOf(kind) ?? CARD_GROWTH;
  if (growth === null) return { kind, cents: latest, projected: false, yearsOn: 0, growth: null, from };

  return {
    kind,
    cents: Math.round((latest * (1 + growth) ** yearsOn) / 100) * 100,
    projected: true,
    yearsOn,
    growth,
    from,
  };
}

/** The estimate with the county's tax on it, which is what anybody pays. */
export const badgeEstimateWithTax = (kind: BadgeKind, year: number): BadgeEstimate | null => {
  const estimate = badgeEstimate(kind, year);
  return estimate && { ...estimate, cents: withTax(estimate.cents) };
};
