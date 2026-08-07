/**
 * Where the stands ended up, and whether it can be believed.
 *
 * `fit-booths.mjs` lays the whole printed sheet down as one rigid piece, and
 * the way that goes wrong is not an error — it is a floor laid down the wrong
 * way up, which produces 565 coordinates that are all inside the right
 * building, all inside the exhibit halls, and all in the wrong aisle. Nothing
 * about the file would look odd.
 *
 * So these assert the things the fit was pinned by, against the written answer
 * rather than against the script that wrote it. Two of them the fit optimised
 * for; the third it never saw, and that is the one worth having.
 *
 * This file used to describe six separate placements chained together at the
 * hall walls, and carried a named anomaly — one wall coming out at 34 m where
 * the others were 7 to 11. That anomaly was an artefact of the six-block model
 * and went when the model did.
 */

import { describe, expect, it } from 'vitest';
import { PLACED_BOOTHS } from './booth-place';
import { PLANNED_BOOTHS } from './booth-plan';
import { EXHIBITORS } from './exhibitors';
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

const HALLS = ['hall-f', 'hall-g', 'hall-h', 'hall-i', 'hall-j', 'hall-k'];

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
  it('kept all of them, in one of the halls', () => {
    expect(PLACED_BOOTHS).toHaveLength(PLANNED_BOOTHS.length);
    for (const stand of PLACED_BOOTHS) {
      expect(HALLS, stand.booth).toContain(stand.hall);
    }
  });

  it('says which hall from where the stand is, not from its number', () => {
    // `hall` is the outline the stand actually falls in. That is not always
    // what `booths.ts` would say from the number, and it is not meant to be:
    // the numbering runs straight through the walls, and during the convention
    // the walls are not there at all. So this asserts the geometry agrees with
    // itself rather than agreeing with the numbering.
    for (const stand of PLACED_BOOTHS) {
      expect(inHall(stand.hall, stand.lat, stand.lng), stand.booth).toBe(true);
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

describe('the things that pinned the fit', () => {
  it('lands every stand inside the exhibit halls', () => {
    // The first check, and on its own it is worth nothing: it is satisfied
    // perfectly by shrinking the sheet until it fits anywhere. It means
    // something only because the scale is fixed at the printed module and is
    // never fitted — at that scale the drawing is 282.2 m across and the halls
    // are 282.5 m, so there is about a stand's width of slack in the whole
    // floor and containment is a real constraint rather than a free one.
    const held = PLACED_BOOTHS.filter((s) => inHall(s.hall, s.lat, s.lng));
    expect(held.length).toBe(PLACED_BOOTHS.length);
  });

  it('runs the aisles the way the J/K wall says they run', () => {
    // The check the fit did not optimise for, which is why it is the one that
    // means anything. A booth number in the 100s to 500s is an aisle and then
    // a position along it, and the wall between Halls J and K cuts *across*
    // those aisles rather than between them. So position along an aisle must
    // run north-south and the aisle number east-west.
    //
    // The silhouette alone leaves two ways up 0.13 apart. On this they are
    // 0.98 against 0.31, and the difference is the whole floor laid down end
    // for end — every stand still in the building, and at the wrong end of it.
    //
    // Over the stands the exhibitor list recognises, and only those. Three of
    // the 565 numbers are known misreads — 246, 264 and 281, four-digit
    // numbers in the 2000s that came out three digits — and they sit 180 m
    // from the aisle they claim. Three points out of 129 pull this from 0.98
    // to 0.34 by themselves. They are excluded because they are known to be
    // reading failures before this runs, not because they are inconvenient.
    const listed = new Set(EXHIBITORS.map((e) => e.booth).filter(Boolean));
    const stretch = PLACED_BOOTHS.filter((s) => Number(s.booth) < 600 && listed.has(s.booth));
    expect(stretch.length).toBeGreaterThan(100);
    const along = stretch.map((s) => Number(s.booth) % 100);
    const aisle = stretch.map((s) => Math.floor(Number(s.booth) / 100));
    expect(correlation(stretch.map((s) => s.lat), along)).toBeGreaterThan(0.95);
    expect(correlation(stretch.map((s) => s.lng), aisle)).toBeGreaterThan(0.9);
    // And not the other way about, which would be the same numbers transposed.
    expect(correlation(stretch.map((s) => s.lng), along)).toBeLessThan(0.4);
  });

  it('leaves stands that face each other across an air wall next to each other', () => {
    // The numbering runs straight through the walls — that is the whole of
    // `booths.ts` — so these pairs are neighbours on the floor and have to be
    // neighbours here. Under one rigid transform this is no longer what holds
    // the floor together, as it was when six blocks were placed separately,
    // but it is still the thing that would break first if the sheet were laid
    // down at the wrong scale or the wrong way round.
    //
    // Facing pairs, which is adjoining aisles at the same position along them
    // — 2663 opposite 2763. Not consecutive numbers: 1401 and 1363 follow each
    // other in the numbering and are 63 stands apart on the floor.
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
    for (const gap of gaps) expect(gap).toBeLessThan(15);
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
  it('never puts two stands on the same floor', () => {
    // What the last map got wrong, and the reason for placing the sheet in one
    // piece rather than six. The stands do not overlap on the page, so under a
    // single rigid transform they cannot overlap on the ground — but a mistake
    // in the quarter-turn, or in which side of a stand is which, would show up
    // here and nowhere else, so it is checked rather than assumed.
    const cells = new Map<string, typeof PLACED_BOOTHS[number][]>();
    const CELL = 0.0002;
    const clashes: string[] = [];
    for (const s of PLACED_BOOTHS) {
      const gx = Math.floor(s.lng / CELL);
      const gy = Math.floor(s.lat / CELL);
      for (let ax = gx - 1; ax <= gx + 1; ax += 1) {
        for (let ay = gy - 1; ay <= gy + 1; ay += 1) {
          for (const other of cells.get(`${ax},${ay}`) ?? []) {
            const overLat = Math.abs(s.lat - other.lat) * M_LAT - (s.deep + other.deep) / 2;
            const overLng = Math.abs(s.lng - other.lng) * M_LNG - (s.wide + other.wide) / 2;
            // A tenth of a metre of slack: two stands back to back share their
            // edge, and the sizes are measured rather than declared.
            if (overLat < -0.1 && overLng < -0.1) clashes.push(`${s.booth}/${other.booth}`);
          }
        }
      }
      const key = `${gx},${gy}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push(s);
    }
    expect(clashes).toEqual([]);
  });

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

  it('gives every stand its own footprint, near enough whole ten-foot booths', () => {
    // The outline the map draws. `wide` and `deep` are the stand's sides on
    // the ground rather than on the page, so they are already swapped for the
    // quarter-turn the sheet was laid down with — nothing drawing these has to
    // know which way that was.
    //
    // Near enough, not exactly: the sizes are measured off the drawing by
    // growing each stand out from its number, and rounding that measurement up
    // to a whole booth is what used to put stands inside each other. 99% land
    // within a tenth of a booth of whole without ever being told to.
    const BOOTH = 3.048;
    const off: number[] = [];
    for (const stand of PLACED_BOOTHS) {
      for (const side of [stand.wide, stand.deep]) {
        expect(side, stand.booth).toBeGreaterThan(0);
        off.push(Math.abs(side / BOOTH - Math.round(side / BOOTH)));
      }
    }
    expect(off.filter((v) => v < 0.1).length / off.length).toBeGreaterThan(0.97);
    expect(Math.max(...off)).toBeLessThan(0.5);
    // Most of the hall is single booths, and the largest island is real: some
    // stands on this floor are nine booths long, which is ninety feet of
    // frontage.
    const single = PLACED_BOOTHS.filter((s) => s.wide < 4 && s.deep < 4);
    expect(single.length / PLACED_BOOTHS.length).toBeGreaterThan(0.3);
    expect(Math.max(...PLACED_BOOTHS.map((s) => Math.max(s.wide, s.deep)))).toBeGreaterThan(20);
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
