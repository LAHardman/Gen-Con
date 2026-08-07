/**
 * What was read off a map with no text on it.
 *
 * `scripts/read-booth-map.mjs` clusters 1,935 glyph outlines into ten digits
 * and reads 524 booth numbers from them. Nothing about that is verifiable by
 * looking at it: every failure produces numbers, and numbers look like numbers.
 * A digit class mislabelled turns every 6 into an 8 and leaves a file that
 * still parses, still has 524 entries, and is wrong about half the hall.
 *
 * So the check is a second source. `exhibitors.ts` comes from Gen Con's
 * exhibitor browser — a different system, pulled on a different day, by a
 * script that has never seen the PDF. Where the two agree on 99.4% of 524
 * numbers, the reading is right; where a digit is mislabelled, the agreement
 * collapses, because a wrong digit almost never lands on another real booth.
 *
 * That is what this file asserts, and it is deliberately asserted as a *rate*
 * rather than as a list. A list would have to be regenerated whenever Gen Con
 * publishes a new map, and regenerating it is exactly the moment the check
 * needs to still work.
 */

import { describe, expect, it } from 'vitest';
import { PLANNED_BOOTHS } from './booth-plan';
import { EXHIBITORS } from './exhibitors';
import { hallForBooth } from './booths';

const LET = new Set(
  EXHIBITORS.filter((e) => e.area === 'Exhibit Hall' && e.booth).map((e) => e.booth!),
);

describe('the reading, against a source that has not seen the map', () => {
  it('agrees with the stand list about almost every number it read', () => {
    // The whole of why this data can be believed. 521 of 524 at the time of
    // writing; the floor is set below that with room for a year's churn, but
    // not so far below that a mislabelled digit could slip under it — get one
    // digit wrong and this falls to about 70%, because "1229" with its 2s
    // turned into 3s is "1339", and 1339 is not a booth.
    const agreed = PLANNED_BOOTHS.filter((b) => LET.has(b.booth));
    const rate = agreed.length / PLANNED_BOOTHS.length;
    expect(rate).toBeGreaterThan(0.95);
    expect(PLANNED_BOOTHS.length).toBeGreaterThan(500);
  });

  it('reads a booth number once, not twice', () => {
    // Two entries for one booth means a number was read in two places, which
    // means one of them is somewhere else's number misread into this one.
    const seen = new Set(PLANNED_BOOTHS.map((b) => b.booth));
    expect(seen.size).toBe(PLANNED_BOOTHS.length);
  });

  it('reads only numbers that could be booth numbers', () => {
    // Three or four digits, no leading zero, inside the grid's range. A glyph
    // wrongly kept — a letter the same height as a digit — shows up here.
    for (const { booth } of PLANNED_BOOTHS) {
      expect(booth, booth).toMatch(/^[1-9][0-9]{2,3}$/);
      expect(Number(booth), booth).toBeLessThan(3200);
    }
  });

  it('places every booth it read in one of the six halls', () => {
    // `booths.ts` divides the grid by number, and it was written before any of
    // this existed. A number read wrongly enough to fall outside the grid —
    // 5-something, say — would have no hall.
    const halls = new Map<string, number>();
    for (const { booth } of PLANNED_BOOTHS) {
      const hall = hallForBooth(booth);
      expect(hall, booth).not.toBeNull();
      halls.set(hall!, (halls.get(hall!) ?? 0) + 1);
    }
    expect([...halls.keys()].sort()).toEqual([
      'hall-f', 'hall-g', 'hall-h', 'hall-i', 'hall-j', 'hall-k',
    ]);
    // And spread across them rather than piled into one, which is what a
    // mis-split of the digit runs would produce.
    for (const [hall, n] of halls) expect(n, hall).toBeGreaterThan(20);
  });

  it('gives every stand a size in whole ten-foot booths', () => {
    // The map is drawn on a strict 12 pt = 10 ft module, so a stand that came
    // out as a fraction of one means a rectangle was matched to the wrong
    // number, or a number to no rectangle at all.
    for (const stand of PLANNED_BOOTHS) {
      expect(Number.isInteger(stand.across), stand.booth).toBe(true);
      expect(Number.isInteger(stand.along), stand.booth).toBe(true);
      expect(stand.across, stand.booth).toBeGreaterThan(0);
      expect(stand.along, stand.booth).toBeGreaterThan(0);
    }
    // Most of the hall is single booths, and that is the shape of a real
    // exhibit floor rather than of a parsing accident.
    const single = PLANNED_BOOTHS.filter((s) => s.across === 1 && s.along === 1);
    expect(single.length / PLANNED_BOOTHS.length).toBeGreaterThan(0.4);
  });
});

describe('what the page coordinates are not', () => {
  it('keeps them on the page, where they belong', () => {
    // These are points on a printed sheet and the file says so. If somebody
    // ever mistakes them for a position on the ground, this is the assertion
    // that reads as absurd: no coordinate on this campus is 900.
    for (const { x, y } of PLANNED_BOOTHS) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1200);
      expect(y).toBeGreaterThan(300);
      expect(y).toBeLessThan(800);
    }
  });
});
