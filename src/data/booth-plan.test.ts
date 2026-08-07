/**
 * What was read off a map with no text on it.
 *
 * `scripts/read-booth-map.mjs` clusters 2,099 glyph outlines into ten digits
 * and reads 565 booth numbers from them. Nothing about that is verifiable by
 * looking at it: every failure produces numbers, and numbers look like numbers.
 * A digit class mislabelled turns every 6 into an 8 and leaves a file that
 * still parses, still has 565 entries, and is wrong about half the hall. That
 * is not hypothetical — the clustering shifted when the reader started taking
 * in the whole floor, `DIGITS` went out of order under it, and a file came out
 * 26% right and said nothing.
 *
 * So the check is a second source. `exhibitors.ts` comes from Gen Con's
 * exhibitor browser — a different system, pulled on a different day, by a
 * script that has never seen the PDF. Where the two agree on 98.9% of 565
 * numbers, the reading is right; where a digit is mislabelled, the agreement
 * collapses, because a wrong digit almost never lands on another real booth.
 *
 * That is what this file asserts, and it is deliberately asserted as a *rate*
 * rather than as a list. A list would have to be regenerated whenever Gen Con
 * publishes a new map, and regenerating it is exactly the moment the check
 * needs to still work.
 */

import { describe, expect, it } from 'vitest';
import { PLANNED_BOOTHS, PLAN_ENTRANCES, PLAN_FLOOR } from './booth-plan';
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

  it('measures every stand to within a few percent of whole ten-foot booths', () => {
    // The map is drawn on a strict 12 pt = 10 ft module, so every stand on it
    // *is* a whole number of booths. These sizes are not rounded to that, and
    // deliberately: each stand is grown out from its number until it meets a
    // drawn line, and rounding what that measures up to the nearest booth is
    // what put stands inside each other last time.
    //
    // So this is the check the rounding would have destroyed. Coming out
    // within a few percent of whole booths, without ever being told to, is
    // evidence that the growing found the real edges. If it started leaking
    // through a missing wall, sizes would drift off the module and this is
    // where that shows.
    const off: number[] = [];
    for (const stand of PLANNED_BOOTHS) {
      for (const side of [stand.across, stand.along]) {
        expect(side, stand.booth).toBeGreaterThan(0);
        off.push(Math.abs(side - Math.round(side)));
      }
    }
    // 99% of them within a tenth of a booth, and none anywhere near half —
    // half would mean the growing had run past a wall and into the next stand
    // along. The seven furthest out keep the company you would expect a bad
    // measurement to keep: they are among the numbers `exhibitors.ts` does not
    // recognise either, and a misread number lands between two stands.
    const close = off.filter((v) => v < 0.1).length;
    expect(close / off.length).toBeGreaterThan(0.97);
    expect(Math.max(...off)).toBeLessThan(0.5);
    // Most of the hall is single booths, and that is the shape of a real
    // exhibit floor rather than of a parsing accident.
    const single = PLANNED_BOOTHS.filter((s) => Math.round(s.across) === 1 && Math.round(s.along) === 1);
    expect(single.length / PLANNED_BOOTHS.length).toBeGreaterThan(0.3);
  });

  it('gives no two stands the same footprint', () => {
    // What went wrong before. A stand's outline is drawn as four separate
    // strips and only some of them come out of the PDF as one closed path, so
    // "find the rectangle nearest this number" found one rectangle for several
    // numbers: 150 of them carried more than one, 316 stands were written on
    // top of each other, and the map drew them that way.
    const seen = new Set(PLANNED_BOOTHS.map((s) => `${s.rx},${s.ry}`));
    expect(seen.size).toBe(PLANNED_BOOTHS.length);
  });
});

describe('what the page coordinates are', () => {
  it('keeps them on the page', () => {
    // Points on a printed sheet, in the sheet's own units. The floor is the
    // carpet polygon, which runs x 27 to 1138 and y 160 to 777.
    for (const { x, y } of PLANNED_BOOTHS) {
      expect(x).toBeGreaterThan(20);
      expect(x).toBeLessThan(1150);
      expect(y).toBeGreaterThan(150);
      expect(y).toBeLessThan(790);
    }
  });

  it('reads the whole floor, including the part beside the index', () => {
    // The floor is an L: its right-hand third comes down 140 points further
    // than its left, and the exhibitor index fills the notch. A flat `y > 300`
    // cut used to separate the two and took 205 stands off the plan with it,
    // so the stands below that line are the ones worth asserting.
    const low = PLANNED_BOOTHS.filter((s) => s.y < 302);
    expect(low.length).toBeGreaterThan(25);
    // And all of them on the right, which is the only place the floor goes
    // that far down.
    for (const s of low) expect(s.x, s.booth).toBeGreaterThan(820);
  });
});

describe('the outline and the ways in', () => {
  it('draws the floor as one closed shape the right size', () => {
    expect(PLAN_FLOOR.length).toBeGreaterThan(6);
    const xs = PLAN_FLOOR.map((p) => p[0]);
    const ys = PLAN_FLOOR.map((p) => p[1]);
    // At 12 pt to a ten-foot booth, this is 282 m across — and the six halls
    // together measure 282.5 m. That agreement is the whole reason the sheet
    // can be laid down as one piece, so it is worth an assertion of its own.
    const across = ((Math.max(...xs) - Math.min(...xs)) * 3.048) / 12;
    expect(across).toBeGreaterThan(275);
    expect(across).toBeLessThan(290);
    expect(((Math.max(...ys) - Math.min(...ys)) * 3.048) / 12).toBeGreaterThan(140);
  });

  it('keeps every stand inside that outline', () => {
    // The stands were found by one route and the outline by another — glyph
    // clustering against a single filled path — so this is two readings of the
    // same sheet agreeing.
    const inside = (px: number, py: number) => {
      let odd = false;
      for (let i = 0, j = PLAN_FLOOR.length - 1; i < PLAN_FLOOR.length; j = i, i += 1) {
        const [ax, ay] = PLAN_FLOOR[i];
        const [bx, by] = PLAN_FLOOR[j];
        if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) odd = !odd;
      }
      return odd;
    };
    for (const s of PLANNED_BOOTHS) expect(inside(s.x, s.y), s.booth).toBe(true);
  });

  it('finds the ways on to the floor, on the floor\'s own edge', () => {
    // Five, and each pushed from its label on to the wall it names, so each
    // should be on the outline rather than near it.
    expect(PLAN_ENTRANCES).toHaveLength(5);
    for (const e of PLAN_ENTRANCES) {
      const onEdge = PLAN_FLOOR.some((_, i) => {
        const [ax, ay] = PLAN_FLOOR[i];
        const [bx, by] = PLAN_FLOOR[(i + 1) % PLAN_FLOOR.length];
        const dx = bx - ax;
        const dy = by - ay;
        const len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, ((e.x - ax) * dx + (e.y - ay) * dy) / len)) : 0;
        return Math.hypot(ax + dx * t - e.x, ay + dy * t - e.y) < 0.5;
      });
      expect(onEdge, `${e.x},${e.y}`).toBe(true);
    }
  });
});
