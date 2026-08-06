/**
 * The grid and the search over it, on floors made up for the purpose.
 *
 * `route.test.ts` runs over the real campus and asserts what a route must be;
 * it is the test that catches regressions, and it is useless at saying where
 * one is. A break in A\* shows up there as "the JW is unreachable". These
 * floors are drawn here, in this file, and are small enough to reason about: a
 * U-shaped corridor, two rooms touching at a corner, a straight run. When one
 * of these fails it says which rule broke.
 *
 * The floors are supplied by mocking `venue-plan`, because that is the seam the
 * real data comes through — `surfaceOf` reads `VENUE_HALLS[venueId/level]` and
 * has no other input. Coordinates are written in metres east and south of the
 * campus origin and converted at the edge, so the shapes below can be read as
 * the drawings they are.
 */

import { describe, expect, it, vi } from 'vitest';

/*
 * The frame `walkable.ts` works in, repeated here because a `vi.mock` factory
 * is hoisted above the imports and cannot reach them. `keeps the frame it was
 * given` below asserts the two agree, so a drift in either is caught rather
 * than silently moving every floor in this file and leaving every test passing
 * against a different building.
 */
const frame = vi.hoisted(() => {
  const ORIGIN = { lat: 39.7705, lng: -86.1705 };
  const PER_LAT = 111_320;
  const PER_LNG = PER_LAT * Math.cos((39.7645 * Math.PI) / 180);
  const point = ([x, y]: readonly [number, number]) =>
    [ORIGIN.lat - y / PER_LAT, ORIGIN.lng + x / PER_LNG] as [number, number];
  return {
    ORIGIN,
    point,
    ring: (...points: ReadonlyArray<readonly [number, number]>) => points.map(point),
  };
});

vi.mock('./venue-plan', () => {
  const { ring } = frame;

  /**
   * A corridor bent into a U, opening north.
   *
   * Two legs 6 m wide running north-south at x 0–6 and x 42–48, joined along
   * the south end by a bar at y 18–24. The mouth of the U — x 6–42, y 0–18 —
   * is not floor, so getting from one leg to the other means going round.
   */
  const u = ring(
    [0, 0], [6, 0], [6, 18], [42, 18], [42, 0], [48, 0], [48, 24], [0, 24],
  );

  /** A straight run, 60 m by 6 m. Nothing to turn for. */
  const straight = ring([0, 0], [60, 0], [60, 6], [0, 6]);

  /**
   * Two squares meeting at exactly one point, (12, 12). A route may not pass
   * between them: the diagonal step is there, but both of the orthogonal steps
   * that would flank it are into nothing.
   */
  const pinchA = ring([0, 0], [12, 0], [12, 12], [0, 12]);
  const pinchB = ring([12, 12], [24, 12], [24, 24], [12, 24]);

  /** A big room and a speck of noise 30 m off it. */
  const solid = ring([0, 0], [30, 0], [30, 30], [0, 30]);
  const speck = ring([60, 0], [61, 0], [61, 1], [60, 1]);

  /** A corridor along the north wall of a hall, for the doorway tests. */
  const alongside = ring([0, 0], [60, 0], [60, 4], [0, 4]);

  /**
   * A corridor at the east end of a floor, for the doorway tests: a room whose
   * east wall is at x 20 has this 20 m away — further than any plan draws a
   * door, and with room for another room in between.
   */
  const eastCorridor = ring([40, 0], [46, 0], [46, 30], [40, 30]);

  /** Two runs that do not touch, 40 m apart, for the per-piece door rule. */
  const eastRun = ring([0, 0], [30, 0], [30, 6], [0, 6]);
  const westRun = ring([70, 0], [100, 0], [100, 6], [70, 6]);

  return {
    VENUE_HALLS: {
      'toy/u': [[u]],
      'toy/straight': [[straight]],
      'toy/pinch': [[pinchA], [pinchB]],
      'toy/speck': [[solid], [speck]],
      'toy/alongside': [[alongside]],
      'toy/east-corridor': [[eastCorridor]],
      'toy/two-runs': [[eastRun], [westRun]],
      'toy/nothing': [],
    },
    VENUE_ROOM_SHAPES: {},
    VENUE_VERTICAL: {},
  };
});

import {
  between,
  cellCentre,
  cellOf,
  doorsOf,
  floorArea,
  floorOf,
  nearestOpen,
  pathBetween,
  roomEntrance,
  toLatLng,
  toPoint,
} from './walkable';
import type { PlanRing } from './plan-geometry';

/** Metres east and south of the campus origin, as the map wants them. */
const at = (x: number, y: number) => toLatLng({ x, y });
const ring = (...points: ReadonlyArray<readonly [number, number]>): PlanRing =>
  points.map(([x, y]) => {
    const point = at(x, y);
    return [point.lat, point.lng] as [number, number];
  });

/** Where a cell is, in the metres this file is written in. */
const metres = (point: { x: number; y: number }) => ({
  x: Math.round(point.x * 10) / 10,
  y: Math.round(point.y * 10) / 10,
});

const floor = (level: string) => floorOf('toy', level);
const cell = (level: string, x: number, y: number) => cellOf(floor(level), toPoint(at(x, y)));

describe('the frame', () => {
  it('keeps the frame it was given', () => {
    // The floors in this file are built by a hoisted factory that cannot
    // import `toPoint`, so it repeats the origin and the two scales. If either
    // drifts, every shape above lands somewhere else and every test below
    // still passes — against a different building. This is the guard.
    const [lat, lng] = frame.point([123, 456]);
    const there = toPoint({ lat, lng });
    expect(there.x).toBeCloseTo(123, 6);
    expect(there.y).toBeCloseTo(456, 6);
    const origin = toPoint(frame.ORIGIN);
    expect(origin.x).toBeCloseTo(0, 9);
    expect(origin.y).toBeCloseTo(0, 9);
  });
});

describe('rasterising a floor', () => {
  it('opens the cells inside the shape and no others', () => {
    const straight = floor('straight');
    expect(straight.empty).toBe(false);
    // 60 x 6 m, and a cell is 1.5 m — so 360 m² of floor, to within the cells
    // the edges cut in half.
    expect(floorArea('toy', 'straight').squareMetres).toBeGreaterThan(300);
    expect(floorArea('toy', 'straight').squareMetres).toBeLessThan(400);
  });

  it('says a floor nothing was drawn for is empty rather than blank', () => {
    // The difference matters: an empty floor is one no plan covers, and a route
    // must fall back to the street rather than search a grid of zeroes.
    expect(floor('nothing').empty).toBe(true);
    expect(pathBetween(floor('nothing'), { cx: 0, cy: 0 }, { cx: 1, cy: 1 })).toBeNull();
  });

  it('rubs out a speck of floor too small to stand on', () => {
    // One square metre of noise 30 m from the real floor. Left in, it is the
    // nearest open cell to anything on that side and swallows whatever snaps
    // to the storey — which is how the whole of Lucas Oil above the event
    // level was lost.
    const speck = floor('speck');
    expect(nearestOpen(speck, toPoint(at(60.5, 0.5)), 5)).toBeNull();
    // While the floor it was beside is untouched.
    expect(nearestOpen(speck, toPoint(at(15, 15)), 5)).not.toBeNull();
  });
});

describe('A* over the grid', () => {
  it('goes round a wall rather than through it', () => {
    const u = floor('u');
    const from = cell('u', 3, 3);
    const to = cell('u', 45, 3);
    const path = pathBetween(u, from, to)!;
    expect(path).not.toBeNull();

    let walked = 0;
    for (let i = 1; i < path.length; i += 1) walked += between(path[i - 1], path[i]);
    // Against the straight line rather than a number: the line across the mouth
    // of the U is 42 m, and going down one leg, along the bar and up the other
    // is half as far again even after the corners are cut.
    // The ends land on cell centres, so the span is 42 m to within a cell.
    const straight = between(path[0], path[path.length - 1]);
    expect(Math.abs(straight - 42)).toBeLessThanOrEqual(1.5);
    expect(walked).toBeGreaterThan(straight * 1.5);
  });

  it('never draws a leg through the gap it went round', () => {
    // The distance test above would also pass for a path that wandered. This
    // is the one that says it stayed on the floor: no point of it, and no
    // point along it, is in the mouth of the U.
    const u = floor('u');
    const path = pathBetween(u, cell('u', 3, 3), cell('u', 45, 3))!;
    const inTheGap = (x: number, y: number) => x > 7 && x < 41 && y < 17;
    for (let i = 1; i < path.length; i += 1) {
      const a = metres(path[i - 1]);
      const b = metres(path[i]);
      for (let s = 0; s <= 40; s += 1) {
        const t = s / 40;
        expect(
          inTheGap(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t),
          `leg ${i} at ${t}`,
        ).toBe(false);
      }
    }
  });

  it('will not squeeze through the corner where two rooms touch', () => {
    // The diagonal step from one square to the other exists, and taking it
    // would walk through the point where two walls meet. Both orthogonal steps
    // beside it are into nothing, which is the rule that forbids it.
    const pinch = floor('pinch');
    expect(pathBetween(pinch, cell('pinch', 6, 6), cell('pinch', 18, 18))).toBeNull();
  });

  it('leaves a straight corridor as two points', () => {
    // The grid turns in 45° steps, so an unsmoothed path down a straight
    // corridor is a staircase of forty little legs. The map draws these.
    const straight = floor('straight');
    const path = pathBetween(straight, cell('straight', 2, 3), cell('straight', 58, 3))!;
    expect(path).toHaveLength(2);
  });

  it('has no route to a cell that is not floor', () => {
    const u = floor('u');
    // The middle of the mouth of the U: inside the bounding box, outside the
    // shape.
    expect(pathBetween(u, cell('u', 3, 3), cell('u', 24, 6))).toBeNull();
  });

  it('gives a single point when both ends are the same cell', () => {
    const straight = floor('straight');
    const one = cell('straight', 10, 3);
    expect(pathBetween(straight, one, one)).toHaveLength(1);
  });
});

describe('nearestOpen', () => {
  it('finds the floor from just off it', () => {
    const straight = floor('straight');
    const found = nearestOpen(straight, toPoint(at(30, 8)), 10);
    expect(found).not.toBeNull();
    // 8 m south of a corridor that ends at 6 m, so about 2 m away.
    expect(found!.away).toBeLessThan(4);
  });

  it('gives up past its radius rather than reaching further', () => {
    // The radius is what stops a room in one wing snapping to a corridor in
    // another, so it has to be obeyed rather than treated as a hint.
    const straight = floor('straight');
    expect(nearestOpen(straight, toPoint(at(30, 40)), 10)).toBeNull();
    expect(nearestOpen(straight, toPoint(at(30, 40)), 45)).not.toBeNull();
  });
});

describe('roomEntrance', () => {
  it('puts the door on the wall the corridor is on', () => {
    // A hall 20 m deep with a corridor along its north side only. The door
    // must be on the north wall: the centre of the room, and its other three
    // walls, are all further from anything walkable.
    const hall = ring([10, 4], [50, 4], [50, 24], [10, 24]);
    const found = roomEntrance([hall], 'toy', 'alongside')!;
    expect(found).not.toBeNull();
    const door = metres(toPoint(found.door));
    expect(door.y).toBeCloseTo(4, 1);
    expect(door.x).toBeGreaterThan(10);
    expect(door.x).toBeLessThan(50);
  });

  it('finds a door mid-wall, not only at the corners', () => {
    // A long wall judged by its ends alone puts the door in a corner. This
    // room's corners are its furthest points from the corridor.
    const hall = ring([10, 6], [50, 6], [50, 26], [10, 26]);
    const found = roomEntrance([hall], 'toy', 'alongside')!;
    const door = metres(toPoint(found.door));
    expect(door.x).toBeGreaterThan(12);
    expect(door.x).toBeLessThan(48);
  });

  it('has no door for a room nothing walkable comes near', () => {
    const faraway = ring([200, 200], [220, 200], [220, 220], [200, 220]);
    expect(roomEntrance([faraway], 'toy', 'alongside')).toBeNull();
  });

  it('reaches across the gap a plan left uncoloured', () => {
    // The corridor is 30 m east of this room and nothing is drawn in between.
    // That gap is a drawing artefact — a plan whose circulation starts well
    // inside the block — not a distance anybody walks, and refusing to reach
    // it left seven rooms on drawn floors falling back to their centres.
    const room = ring([0, 8], [20, 8], [20, 22], [0, 22]);
    const found = roomEntrance([room], 'toy', 'east-corridor')!;
    expect(found).not.toBeNull();
    // On the east wall, which is the one facing the corridor, 20 m away.
    expect(metres(toPoint(found.door)).x).toBeCloseTo(20, 1);
  });

  it('will not open a door through another room', () => {
    // The failure the reach makes possible, and the reason it can be generous.
    // This room's nearest walkable pixel is due east — through the whole of a
    // room in between. A door there leads into somebody else's meeting, and it
    // would look like a perfectly ordinary route.
    const room = ring([0, 8], [20, 8], [20, 22], [0, 22]);
    const between_ = ring([24, 4], [36, 4], [36, 26], [24, 26]);
    expect(roomEntrance([room], 'toy', 'east-corridor', inside(between_))).toBeNull();
    // ...and without being told, it happily does.
    expect(roomEntrance([room], 'toy', 'east-corridor')).not.toBeNull();
  });

  it('takes the next-best door when the nearest one is blocked', () => {
    // Not simply "give up": a room with two ways out keeps the one that works.
    // Here the room reaches the corridor round the south end of the obstacle.
    const room = ring([0, 8], [20, 8], [20, 22], [0, 22]);
    const between_ = ring([24, 0], [36, 0], [36, 14], [24, 14]);
    const found = roomEntrance([room], 'toy', 'east-corridor', inside(between_))!;
    expect(found).not.toBeNull();
    // The south-east corner, below the obstacle rather than through it.
    expect(metres(toPoint(found.door)).y).toBeGreaterThan(14);
  });

  it('has no door on a floor no plan was read for', () => {
    const hall = ring([10, 4], [50, 4], [50, 24], [10, 24]);
    expect(roomEntrance([hall], 'toy', 'nothing')).toBeNull();
  });

  it('lets a door clip the neighbour it shares a wall with', () => {
    // Most room outlines on this campus are schematic rectangles that abut, so
    // the two-metre line from a door to the corridor clips the room next door.
    // That is a drawing artefact, not a route through a meeting — and treating
    // it as one cost Union Station two of its doorways before the rule had a
    // tolerance.
    //
    // The corridor is y 0–4; this room starts at y 6, with a 2 m sliver of
    // somebody else's rectangle in between. Roughly a metre and a half of the
    // line is inside it, which is one grid cell.
    const room = ring([10, 6], [50, 6], [50, 26], [10, 26]);
    // Wider than the room, so there is no corner to slip round: the only way
    // out is across it.
    const sliver = ring([0, 4], [60, 4], [60, 6], [0, 6]);
    expect(roomEntrance([room], 'toy', 'alongside', inside(sliver))).not.toBeNull();
  });
});

/** "Is this point inside that ring", as `navigation.ts` asks it. */
function inside(shape: PlanRing) {
  return ({ lat, lng }: { lat: number; lng: number }) => {
    let odd = false;
    for (let i = 0, j = shape.length - 1; i < shape.length; j = i, i += 1) {
      const [ai, bi] = shape[i];
      const [aj, bj] = shape[j];
      if (ai > lat !== aj > lat && lng < ((bj - bi) * (lat - ai)) / (aj - ai) + bi) odd = !odd;
    }
    return odd;
  };
}

describe('doorsOf', () => {
  /** A building outline round the straight corridor, 2 m clear of it. */
  const outline = ring([-2, -2], [62, -2], [62, 8], [-2, 8]);

  it('spreads doors around a building rather than clustering them', () => {
    // One door was the first rule, and on a 60 m corridor it meant every route
    // out left by the same end. Any two of these are a real distance apart.
    const doors = doorsOf(floor('straight'), outline);
    expect(doors.length).toBeGreaterThan(1);
    const points = doors.map((door) => cellCentre(floor('straight'), door.cx, door.cy));
    for (let a = 0; a < points.length; a += 1) {
      for (let b = a + 1; b < points.length; b += 1) {
        expect(between(points[a], points[b])).toBeGreaterThan(30);
      }
    }
  });

  it('gives every disconnected run of floor its own way out', () => {
    // The JW's ground floor is drawn as several runs that do not touch. A door
    // in one of them strands everything in the others: they have a square to
    // stand on, so they do not count as being on the street either.
    const wide = ring([-2, -2], [102, -2], [102, 8], [-2, 8]);
    const doors = doorsOf(floor('two-runs'), wide);
    const points = doors.map((door) => cellCentre(floor('two-runs'), door.cx, door.cy));
    expect(points.some((point) => metres(point).x < 30)).toBe(true);
    expect(points.some((point) => metres(point).x > 70)).toBe(true);
  });

  it('has no doors on a floor nothing was drawn for', () => {
    expect(doorsOf(floor('nothing'), outline)).toEqual([]);
  });
});
