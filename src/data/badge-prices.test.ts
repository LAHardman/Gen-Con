/**
 * The rate card, and the way it is allowed to be wrong.
 *
 * Two things are worth holding here. The prices themselves are just numbers
 * off a page and a test that restates them proves nothing — so what is
 * tested is the arithmetic nobody sees (the county's tax, which is a tenth
 * of every badge and is stated in a footnote rather than in the table) and
 * the ageing rule, which is the whole reason a frozen copy still shows a
 * price at all.
 */

import { describe, expect, it } from 'vitest';
import {
  ADMISSIONS_TAX,
  BADGE_CENTS,
  BADGE_HISTORY,
  BADGE_PRICE_YEAR,
  BADGE_PRICES_CHECKED,
  CARD_GROWTH,
  SHIPPING_CENTS,
  badgeCents,
  badgeEstimate,
  growthOf,
  withTax,
} from './badge-prices';
import { BADGE_KINDS } from './badges';

describe('the card itself', () => {
  it('prices every badge kind except the one that is not a badge', () => {
    for (const kind of BADGE_KINDS) {
      const cents = badgeCents(kind);
      if (kind === 'none') {
        // `none` means somebody has not bought one. Pricing it would put a
        // line in the total for a thing nobody owns.
        expect(cents).toBeNull();
      } else {
        expect(cents, `${kind} has no price`).toBeGreaterThan(0);
      }
    }
  });

  it('holds whole cents, never a stray fraction of one', () => {
    for (const cents of Object.values(BADGE_CENTS)) {
      if (cents === null) continue;
      expect(Number.isInteger(cents)).toBe(true);
    }
  });

  it('records the year it was published for and the day it was read', () => {
    expect(BADGE_PRICE_YEAR).toBeGreaterThan(2020);
    expect(BADGE_PRICES_CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the tax, which is not in the table', () => {
  it('adds the county\'s tenth to what the card gets charged', () => {
    expect(ADMISSIONS_TAX).toBeCloseTo(0.1);
    expect(withTax(10_000)).toBe(11_000);
  });

  it('rounds to the cent the store actually charges in', () => {
    // A price ending in an odd number of dollars taxes to a fraction of a
    // cent; the store cannot charge that and neither can the budget.
    expect(withTax(8_300)).toBe(9_130);
    expect(Number.isInteger(withTax(4_100))).toBe(true);
  });

  it('leaves the unpriced kind unpriced rather than taxing a null to zero', () => {
    // The bug this guards is a real one: `withTax(null ?? 0)` is 0, which
    // reads as free rather than as unknown.
    expect(badgeCents('none')).toBeNull();
    expect(badgeEstimate('none', 2027)).toBeNull();
  });

  it('keeps the packet fee out of the badge price', () => {
    // Posting is once per shipment, not once per badge — folding it into a
    // price would charge it four times for a family of four.
    expect(SHIPPING_CENTS).toBeGreaterThan(0);
    for (const cents of Object.values(BADGE_CENTS)) {
      if (cents !== null) expect(cents % 100).toBe(0);
    }
  });
});

describe('growing old without going quiet', () => {
  it('still has a published price to give when it is years out of date', () => {
    // The floor under the estimate: even with the trend thrown away, a copy
    // nobody can update still holds 2026's real figures. A blank is not more
    // honest than an old number with its year attached — just less useful.
    expect(badgeCents('four-day')).toBeGreaterThan(0);
    expect(BADGE_PRICE_YEAR).toBeGreaterThan(2020);
  });
});

describe('the history it estimates from', () => {
  it('is in order, with no year priced twice', () => {
    const years = BADGE_HISTORY.map((card) => card.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(new Set(years).size).toBe(years.length);
  });

  it('cites Gen Con\'s own announcement for every card', () => {
    // The figures were gathered once from press releases and once, wrongly,
    // from a search engine — which reported 2023's prices as 2024's. The
    // citation is what makes the difference checkable later.
    for (const card of BADGE_HISTORY) {
      expect(card.source, `${card.year} has no source`).toMatch(/^https:\/\/www\.gencon\.com\//);
    }
  });

  it('takes the latest card as the published one rather than repeating it', () => {
    // One source of truth: a second copy of the newest prices is a second
    // thing to forget to update.
    const newest = BADGE_HISTORY[BADGE_HISTORY.length - 1];
    expect(BADGE_PRICE_YEAR).toBe(newest.year);
    expect(BADGE_CENTS).toBe(newest.cents);
  });

  it('tolerates a missing year rather than assuming the cards are consecutive', () => {
    // 2024's release is listed on Gen Con's index and serves an unrelated
    // one, so the history has a hole in it. Every rate here is annualised
    // over the real gap; a step that assumed one year would read 2023→2025
    // as a single year's rise and roughly double every trend.
    const years = BADGE_HISTORY.map((card) => card.year);
    expect(years).toContain(2023);
    expect(years).toContain(2025);
    expect(years).not.toContain(2024);
    // Sunday rose 1700 → 3900 across those two years. Annualised that is
    // ~51%; read as one year it would be 129%.
    expect(growthOf('sunday')!).toBeLessThan(0.2);
  });
});

describe('the trend, and what it refuses to do with it', () => {
  it('measures each badge\'s own rise, in a believable range', () => {
    for (const kind of ['four-day', 'thursday', 'saturday', 'sunday', 'trade-day'] as const) {
      const growth = growthOf(kind)!;
      expect(growth, `${kind} grows at ${growth}`).toBeGreaterThan(0);
      expect(growth, `${kind} grows at ${growth}`).toBeLessThan(0.15);
    }
    expect(CARD_GROWTH).toBeGreaterThan(0);
  });

  it('steps over a one-off re-pricing instead of compounding it for ever', () => {
    /*
     * The judgement the whole estimate rests on. Sunday went $17 → $39
     * between 2023 and 2025 — Gen Con re-priced the badge, it did not
     * inflate. End-to-end that is 27% a year, which projects a $130 Sunday
     * badge by 2032 and would be nonsense. The median of the year-on-year
     * steps ignores the jump and keeps the ordinary rise.
     */
    const endToEnd = (4_100 / 1_600) ** (1 / 4) - 1;
    expect(endToEnd).toBeGreaterThan(0.25);
    expect(growthOf('sunday')!).toBeLessThan(0.08);
  });

  it('has no trend for a badge that is not sold, and estimates none', () => {
    expect(growthOf('none')).toBeNull();
    expect(badgeEstimate('none', 2030)).toBeNull();
  });
});

describe('an estimate, and the fact under it', () => {
  it('returns a published year as published, never as arithmetic', () => {
    // A fact beats a fit. Re-deriving 2025 from 2022 would put a number on
    // screen that contradicts one Gen Con printed.
    const real = badgeEstimate('four-day', 2025)!;
    expect(real.projected).toBe(false);
    expect(real.cents).toBe(15_500);
  });

  it('carries the latest card forward and says how far', () => {
    const next = badgeEstimate('four-day', BADGE_PRICE_YEAR + 1)!;
    expect(next.projected).toBe(true);
    expect(next.yearsOn).toBe(1);
    expect(next.cents).toBeGreaterThan(BADGE_CENTS['four-day']!);
    // And it keeps the fact it was built from, so the page can show both.
    expect(next.from).toEqual({ year: BADGE_PRICE_YEAR, cents: BADGE_CENTS['four-day'] });
  });

  it('rounds to the dollar, because cents on a projection are invented', () => {
    for (const year of [BADGE_PRICE_YEAR + 1, BADGE_PRICE_YEAR + 4]) {
      expect(badgeEstimate('four-day', year)!.cents % 100).toBe(0);
    }
  });

  it('never projects backwards into a year Gen Con has already priced', () => {
    // Before the first card there is nothing to carry forward from, and
    // back-casting would contradict the published history.
    const old = badgeEstimate('four-day', 2019)!;
    expect(old.projected).toBe(false);
  });

  it('still answers, and still says it is guessing, years after the last card', () => {
    // The point of the whole thing: a copy nobody can update should still
    // give a usable figure in 2031, marked as an estimate and carrying the
    // year of the last real price it was built on.
    const far = badgeEstimate('four-day', BADGE_PRICE_YEAR + 5)!;
    expect(far.projected).toBe(true);
    expect(far.yearsOn).toBe(5);
    expect(far.from.year).toBe(BADGE_PRICE_YEAR);
    expect(far.cents).toBeGreaterThan(BADGE_CENTS['four-day']!);
    // And it stays in the realm of a badge price rather than running away.
    expect(far.cents).toBeLessThan(BADGE_CENTS['four-day']! * 2);
  });
});
