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
  BADGE_PRICE_YEAR,
  BADGE_PRICES_CHECKED,
  SHIPPING_CENTS,
  badgeCents,
  badgeCentsWithTax,
  pricesArePrevious,
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
    expect(badgeCentsWithTax('none')).toBeNull();
    expect(badgeCentsWithTax('four-day')).toBe(withTax(badgeCents('four-day') as number));
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
  it('knows when it is showing a previous convention\'s prices', () => {
    expect(pricesArePrevious(BADGE_PRICE_YEAR + 1)).toBe(true);
    expect(pricesArePrevious(BADGE_PRICE_YEAR)).toBe(false);
  });

  it('still has a price to give when it is years out of date', () => {
    // The point of the whole file: a copy nobody can update should show
    // 2026's figures in 2031, labelled 2026's. A blank is not more honest
    // than an old number with its year attached — it is just less useful.
    expect(pricesArePrevious(BADGE_PRICE_YEAR + 5)).toBe(true);
    expect(badgeCents('four-day')).toBeGreaterThan(0);
  });
});
