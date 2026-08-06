/**
 * Where you change floor, on buildings made up for the purpose.
 *
 * Two rules meet in `vertical.ts` and they are easy to get subtly wrong
 * together. A shaft the plans *draw* is a measurement, and two readings of one
 * shaft — one per storey — have to be recognised as the same shaft. Where
 * nothing is drawn, a staircase is *inferred*: it must land on walkable floor
 * at both ends, so it lies somewhere in the overlap of the two storeys'
 * circulation, and that is all that is certain about it.
 *
 * Both rules have failed on the real campus in ways that looked like nothing at
 * all — a whole hotel wing with no way upstairs, twelve of thirteen suite runs
 * unreachable — because the only thing that shows is a route that quietly is
 * not there. The buildings below are small enough to count the answers by hand.
 */

import { describe, expect, it, vi } from 'vitest';

/* The frame `walkable.ts` works in; see the note in `walkable.toy.test.ts`. */
const frame = vi.hoisted(() => {
  const ORIGIN = { lat: 39.7705, lng: -86.1705 };
  const PER_LAT = 111_320;
  const PER_LNG = PER_LAT * Math.cos((39.7645 * Math.PI) / 180);
  const point = ([x, y]: readonly [number, number]) =>
    [ORIGIN.lat - y / PER_LAT, ORIGIN.lng + x / PER_LNG] as [number, number];
  return {
    point,
    ring: (...points: ReadonlyArray<readonly [number, number]>) => points.map(point),
  };
});

vi.mock('./venues', () => ({
  VENUE_LEVELS: {
    // Three storeys, so "only between floors that are adjacent" has something
    // to be wrong about.
    stack: ['ground', 'first', 'second'],
    drawn: ['ground', 'first'],
    apart: ['ground', 'first'],
    partial: ['ground', 'first'],
    sliver: ['ground', 'first'],
  },
}));

vi.mock('./venue-plan', () => {
  const { ring, point } = frame;
  const run = (x0: number, x1: number) => ring([x0, 0], [x1, 0], [x1, 9], [x0, 9]);

  return {
    VENUE_HALLS: {
      /* One corridor over another over two disconnected runs. */
      'stack/ground': [[run(0, 48)]],
      'stack/first': [[run(0, 48)]],
      'stack/second': [[run(0, 12)], [run(36, 48)]],

      /* Two floors that coincide exactly, for the drawn-shaft rules. */
      'drawn/ground': [[run(0, 48)]],
      'drawn/first': [[run(0, 48)]],
      'apart/ground': [[run(0, 48)]],
      'apart/first': [[run(0, 48)]],

      /* A full floor under two runs, only one of which has a shaft drawn. */
      'partial/ground': [[run(0, 48)]],
      'partial/first': [[run(0, 12)], [run(36, 48)]],

      /* The upper floor's second run only clips the corner of the lower one. */
      'sliver/ground': [[run(0, 48)]],
      'sliver/first': [
        [run(0, 30)],
        [ring([46, 7.5], [55, 7.5], [55, 16.5], [46, 16.5])],
      ],
    },
    VENUE_ROOM_SHAPES: {},
    VENUE_VERTICAL: {
      // Two readings of one shaft, 2 m apart — the same shaft seen twice.
      'drawn/ground': [point([10, 4.5])],
      'drawn/first': [point([12, 4.5])],
      // Two marks 35 m apart. Whatever they are, they are not one shaft.
      'apart/ground': [point([5, 4.5])],
      'apart/first': [point([40, 4.5])],
      // A shaft drawn in the western run only.
      'partial/ground': [point([6, 4.5])],
      'partial/first': [point([6, 4.5])],
    },
  };
});

import { verticalsOf } from './vertical';
import { toPoint } from './walkable';

/** A link's position in the metres this file is written in. */
const where = (at: { lat: number; lng: number }) => {
  const point = toPoint(at);
  return { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
};

const linksOf = (venueId: string, from: string, to: string) =>
  verticalsOf(venueId).filter((link) => link.from === from && link.to === to);

describe('a shaft the plans draw', () => {
  it('reads two marks in the same place as one shaft', () => {
    const links = linksOf('drawn', 'ground', 'first');
    expect(links).toHaveLength(1);
    expect(links[0].certainty).toBe('plan');
  });

  it('puts the shaft halfway between the two readings of it', () => {
    // Neither reading is the shaft; they straddle it. Halfway is the better
    // guess at it than either on its own, and it is where the map draws a mark.
    const [link] = linksOf('drawn', 'ground', 'first');
    expect(where(link.at).x).toBeCloseTo(11, 1);
    expect(where(link.at).y).toBeCloseTo(4.5, 1);
  });

  it('will not call two marks a shaft just because they are on adjacent floors', () => {
    // 35 m apart. A shaft is in the same place on both storeys, so these are
    // two different things — and the answer falls back to the inference, which
    // says where a staircase *must* be rather than pretending to know.
    const links = linksOf('apart', 'ground', 'first');
    expect(links.every((link) => link.certainty === 'region')).toBe(true);
  });
});

describe('a staircase nothing drew', () => {
  it('puts it in the overlap of the two floors', () => {
    const [link] = linksOf('stack', 'ground', 'first');
    expect(link.certainty).toBe('region');
    // The two corridors coincide over their whole length, so anywhere along
    // them is possible and the middle is what it reports.
    expect(where(link.at).y).toBeGreaterThan(0);
    expect(where(link.at).y).toBeLessThan(9);
    expect(where(link.at).x).toBeGreaterThan(0);
    expect(where(link.at).x).toBeLessThan(48);
  });

  it('gives every disconnected run of the upper floor its own way down', () => {
    // One link at the centre of the largest overlap was the first rule, and it
    // left twelve of Lucas Oil's thirteen suite runs with no way off them. A
    // run cut off from the rest of its storey can only be reached from another
    // storey, so each one needs its own.
    const links = linksOf('stack', 'first', 'second');
    expect(links).toHaveLength(2);
    const xs = links.map((link) => where(link.at).x).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(12);
    expect(xs[1]).toBeGreaterThan(36);
  });

  it('ignores an overlap too small to hold a staircase', () => {
    // The upper floor's second run clips the corner of the lower one and no
    // more: a single square of agreement, which is what two tracings of one
    // building produce at an edge rather than a place a stair could land.
    const links = linksOf('sliver', 'ground', 'first');
    expect(links).toHaveLength(1);
    expect(where(links[0].at).x).toBeLessThan(30);
  });

  it('joins only floors that are next to each other', () => {
    // A link from the ground to the second would be a lift shaft this cannot
    // see, and the building's own ordering is the only evidence there is.
    expect(linksOf('stack', 'ground', 'second')).toHaveLength(0);
  });
});

describe('what is drawn and what is inferred, together', () => {
  it('does not guess a second staircase beside one the plans drew', () => {
    // Precedence: where a shaft is drawn, that is the answer, and adding a
    // guess next to it would draw a staircase nobody has evidence for.
    const links = linksOf('drawn', 'ground', 'first');
    expect(links).toHaveLength(1);
    expect(links[0].certainty).toBe('plan');
  });

  it('still guesses for a run of floor the drawings left with no way off', () => {
    // The JW's ground floor is two runs and only one has a stair beside it.
    // Suppressing the inference wherever *any* shaft is drawn is right about
    // precedence and wrong about coverage: it left the whole White River
    // Ballroom unable to get upstairs, which is worse than having no plan of
    // the floor at all, because a floor nobody drew still falls back to the
    // street.
    const links = linksOf('partial', 'ground', 'first');
    expect(links).toHaveLength(2);
    const drawn = links.filter((link) => link.certainty === 'plan');
    const guessed = links.filter((link) => link.certainty === 'region');
    expect(drawn).toHaveLength(1);
    expect(guessed).toHaveLength(1);
    // The drawn one serves the western run; the guess is for the eastern one.
    expect(where(drawn[0].at).x).toBeLessThan(12);
    expect(where(guessed[0].at).x).toBeGreaterThan(36);
  });
});
