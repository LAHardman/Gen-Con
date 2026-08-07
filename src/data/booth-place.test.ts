/**
 * Where the stands ended up, and whether it can be believed.
 *
 * `fit-booths.mjs` lays each hall's block of stands into that hall's outline,
 * and the way that goes wrong is not an error — it is a hall laid down the
 * wrong way up, which produces 524 coordinates that are all inside the right
 * building, all inside the right hall, and all in the wrong aisle. Nothing
 * about the file would look odd.
 *
 * So these assert the three things the fit was pinned by, against the written
 * answer rather than against the script that wrote it. Two of them the fit
 * optimised for; the third it never saw, and that is the one worth having.
 */

import { describe, expect, it } from 'vitest';
import { PLACED_BOOTHS } from './booth-place';
import { PLANNED_BOOTHS } from './booth-plan';
import { hallForBooth } from './booths';
import { ROOMS_BY_ID, roomShapes } from './venues';

const within = (ring: ReadonlyArray<readonly [number, number]>, lat: number, lng: number) => {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[i];
    const q = ring[j];
    if (p[0] > lat !== q[0] > lat && lng < ((q[1] - p[1]) * (lat - p[0])) / (q[0] - p[0]) + p[1]) {
      odd = !odd;
    }
  }
  return odd;
};
const inHall = (id: string, lat: number, lng: number) =>
  roomShapes(ROOMS_BY_ID[id]).some((ring) => within(ring as never, lat, lng));

const M_LAT = 111_320;
const M_LNG = 85_657;
const apart = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((a.lat - b.lat) * M_LAT, (a.lng - b.lng) * M_LNG);
const at = (booth: string) => PLACED_BOOTHS.find((b) => b.booth === booth);

const correlation = (xs: number[], ys: number[]) => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let top = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < xs.length; i += 1) {
    top += (xs[i] - mx) * (ys[i] - my);
    left += (xs[i] - mx) ** 2;
    right += (ys[i] - my) ** 2;
  }
  return Math.abs(top / Math.sqrt(left * right));
};

describe('every stand the map printed', () => {
  it('kept all of them, and the hall each number belongs to', () => {
    expect(PLACED_BOOTHS).toHaveLength(PLANNED_BOOTHS.length);
    for (const stand of PLACED_BOOTHS) {
      expect(stand.hall, stand.booth).toBe(hallForBooth(stand.booth));
    }
  });

  it('puts them on the convention centre rather than in the sea', () => {
    // The fit turns page points into coordinates, and a sign error there is a
    // file full of plausible numbers pointing at the Gulf of Guinea.
    for (const { lat, lng, booth } of PLACED_BOOTHS) {
      expect(lat, booth).toBeGreaterThan(39.761);
      expect(lat, booth).toBeLessThan(39.766);
      expect(lng, booth).toBeGreaterThan(-86.168);
      expect(lng, booth).toBeLessThan(-86.161);
    }
  });
});

describe('the three things that pinned the fit', () => {
  it('lands almost every stand inside the hall its number claims', () => {
    // The first check, and on its own it is worth nothing: it is satisfied
    // perfectly by shrinking each block until it fits anywhere. It only means
    // something because the scale is fixed at the printed module and never
    // fitted. The stands that fall outside are at a hall's edge, where the
    // traced outline and the block's perimeter aisle disagree by a metre.
    const held = PLACED_BOOTHS.filter((s) => inHall(s.hall, s.lat, s.lng));
    expect(held.length / PLACED_BOOTHS.length).toBeGreaterThan(0.9);
  });

  it('leaves stands that face each other across an air wall next to each other', () => {
    // The second. The grid's numbering runs straight through the walls — that
    // is the whole of `booths.ts` — so these pairs are neighbours on the floor
    // and have to be neighbours here. This is what ties six separately-placed
    // blocks into one floor; without it each hall is plausible alone and they
    // are 87 to 119 m out from each other.
    // Facing pairs, which is adjoining aisles at the same position along them
    // — 2663 opposite 2763. Not consecutive numbers: 1401 and 1363 follow each
    // other in the numbering and are 63 stands apart on the floor, and pairing
    // those was the first version of this and was wrong.
    const facing: Array<[string, string]> = [
      ['2727', '2627'],
      ['2329', '2229'],
      ['1429', '1329'],
      ['629', '529'],
      ['339', '331'],
    ];
    const gaps: number[] = [];
    for (const [a, b] of facing) {
      const one = at(a);
      const two = at(b);
      if (!one || !two) continue;
      gaps.push(apart(one, two));
    }
    expect(gaps.length).toBeGreaterThan(3);
    // The median, not the total. Four of the five walls come out at 7 to 11 m;
    // the one between Halls G and H comes out at 34 and will not move, and the
    // generated file names it. A total would hide which of the two situations
    // this is.
    const median = [...gaps].sort((x, y) => x - y)[Math.floor(gaps.length / 2)];
    expect(median).toBeLessThan(15);
    expect(Math.max(...gaps)).toBeLessThan(40);
  });

  it('runs the aisles the way the J/K wall says they run', () => {
    // The third, and the only one the fit did not optimise for — which is why
    // it is the one that means anything. A booth number in the 100s to 500s is
    // an aisle and then a position along it, and the wall between Halls J and
    // K cuts *across* those aisles rather than between them. So position along
    // an aisle must run north-south and the aisle number east-west.
    //
    // The seams alone left two arrangements 3 m apart in cost. On this they
    // are 0.98 against 0.31, and the difference is Hall K laid down mirrored —
    // every stand still in Hall K, still in the right building, and at the
    // wrong end of it.
    const stretch = PLACED_BOOTHS.filter((s) => Number(s.booth) < 600);
    expect(stretch.length).toBeGreaterThan(100);
    const along = stretch.map((s) => Number(s.booth) % 100);
    const aisle = stretch.map((s) => Math.floor(Number(s.booth) / 100));
    expect(correlation(stretch.map((s) => s.lat), along)).toBeGreaterThan(0.95);
    expect(correlation(stretch.map((s) => s.lng), aisle)).toBeGreaterThan(0.9);
    // And not the other way about, which would be the same numbers transposed.
    expect(correlation(stretch.map((s) => s.lng), along)).toBeLessThan(0.4);
  });

  it('puts Hall J north of Hall K, which is where you were told it is', () => {
    const mean = (id: string) => {
      const rows = PLACED_BOOTHS.filter((s) => s.hall === id);
      return rows.reduce((sum, s) => sum + s.lat, 0) / rows.length;
    };
    expect(mean('hall-j')).toBeGreaterThan(mean('hall-k'));
  });
});

describe('the shape of a real exhibit floor', () => {
  it('keeps a stand\'s neighbours next to it', () => {
    // Within an aisle the numbering steps by two, odd down one side and even
    // down the other, so 1229 and 1231 are adjacent stands. If the block were
    // scrambled rather than placed, these would be anywhere.
    for (const [a, b] of [['1229', '1233'], ['929', '935'], ['729', '737']]) {
      const one = at(a);
      const two = at(b);
      if (!one || !two) continue;
      expect(apart(one, two), `${a} to ${b}`).toBeLessThan(30);
    }
  });

  it('spreads a hall over the whole of the hall, not over a corner of it', () => {
    // A block placed at the right angle but far too small would pass every
    // test above and draw the exhibit hall as a smudge in one corner.
    for (const id of ['hall-f', 'hall-h', 'hall-i']) {
      const rows = PLACED_BOOTHS.filter((s) => s.hall === id);
      const lats = rows.map((s) => s.lat);
      const lngs = rows.map((s) => s.lng);
      const tall = (Math.max(...lats) - Math.min(...lats)) * M_LAT;
      const wide = (Math.max(...lngs) - Math.min(...lngs)) * M_LNG;
      expect(Math.max(tall, wide), id).toBeGreaterThan(40);
    }
  });
});
