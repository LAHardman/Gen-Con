/**
 * The floor you can actually stand on, per storey, as something a route can be
 * searched over.
 *
 * Two sources, already in the repository and both read off real drawings: the
 * convention centre's prefunction halls and concourses, which its plans key by
 * colour as "Prefunction/Hallways", and the hotels' corridors, which
 * `venue-plans.mjs` reads from Gen Con's pictures of them by the same means. A
 * room is not walkable surface here — you enter one from the corridor outside
 * it, and that doorway is the last step of a route rather than a place to route
 * through.
 *
 * The surface is turned into a grid rather than searched as polygons. A hotel
 * corridor is one polygon with a hole per room it runs around, and the honest
 * answer to "can I walk from here to there" over such a shape is a visibility
 * graph, which is a lot of computational geometry to get subtly wrong. A grid
 * of squares is crude in a way that is easy to check and impossible to get
 * subtly wrong: a cell is either on the floor or it isn't. Half a corridor's
 * width is the resolution that matters, and CELL is set well under it.
 */

import { PLAN_DETAIL } from './plan-geometry';
import type { PlanRing } from './plan-geometry';
import { VENUE_HALLS } from './venue-plan';
import type { LatLng } from '../utils/geo';

/** Metres per grid cell. Under half the width of the narrowest real corridor. */
const CELL = 1.5;

/** Metres per degree of latitude. Constant enough at city scale. */
const PER_LAT = 111_320;
/** The campus is small; one longitude scale for all of it is exact to the centimetre. */
const CAMPUS_LAT = 39.7645;
const PER_LNG = PER_LAT * Math.cos((CAMPUS_LAT * Math.PI) / 180);

/** East/south metres from a fixed campus origin, so every floor shares one frame. */
export interface Point {
  x: number;
  y: number;
}

const ORIGIN: LatLng = { lat: 39.7705, lng: -86.1705 };

export function toPoint(at: LatLng): Point {
  return { x: (at.lng - ORIGIN.lng) * PER_LNG, y: (ORIGIN.lat - at.lat) * PER_LAT };
}

export function toLatLng(point: Point): LatLng {
  return { lat: ORIGIN.lat - point.y / PER_LAT, lng: ORIGIN.lng + point.x / PER_LNG };
}

export const between = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** A polygon with holes: outer ring first, then whatever it runs around. */
type Shape = readonly PlanRing[];

/**
 * The shapes you can stand on, on one floor of one building.
 *
 * The convention centre's come from its own plans as single rings; the hotels'
 * arrive already shaped as outer-plus-holes.
 */
function surfaceOf(venueId: string, level: string): Shape[] {
  const halls = VENUE_HALLS[`${venueId}/${level}`];
  if (halls) return halls.map((hall) => hall);

  const detail = PLAN_DETAIL[`${venueId}/${level}`] ?? [];
  return detail.filter((shape) => shape.kind === 'circulation').map((shape) => [shape.ring]);
}

/** Even-odd, which is what makes a hole a hole without tracking ring order. */
function inside(shape: Shape, at: Point): boolean {
  let odd = false;
  for (const ring of shape) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = toPoint({ lat: ring[i][0], lng: ring[i][1] });
      const b = toPoint({ lat: ring[j][0], lng: ring[j][1] });
      if (a.y > at.y !== b.y > at.y && at.x < ((b.x - a.x) * (at.y - a.y)) / (b.y - a.y) + a.x) {
        odd = !odd;
      }
    }
  }
  return odd;
}

export interface Floor {
  venueId: string;
  level: string;
  /** Cell coordinates of the grid's north-west corner, in campus metres. */
  origin: Point;
  width: number;
  height: number;
  /** One byte per cell: 1 where you can stand. */
  open: Uint8Array;
  /** Nothing was drawn for this floor, so no route can cross it. */
  empty: boolean;
}

const at = (floor: Floor, cx: number, cy: number) =>
  cx < 0 || cy < 0 || cx >= floor.width || cy >= floor.height
    ? 0
    : floor.open[cy * floor.width + cx];

const FLOORS = new Map<string, Floor>();

/**
 * The grid for one floor, built once and kept.
 *
 * Rasterising is O(cells × ring edges) and a floor is tens of thousands of
 * cells, so this is a tenth of a second the first time a building is routed in
 * and nothing at all afterwards. Doing it up front for all fourteen buildings
 * would be that cost on every page load, for floors most sessions never touch.
 */
export function floorOf(venueId: string, level: string): Floor {
  const key = `${venueId}/${level}`;
  const held = FLOORS.get(key);
  if (held) return held;

  const shapes = surfaceOf(venueId, level);
  if (!shapes.length) {
    const floor: Floor = {
      venueId,
      level,
      origin: { x: 0, y: 0 },
      width: 0,
      height: 0,
      open: new Uint8Array(0),
      empty: true,
    };
    FLOORS.set(key, floor);
    return floor;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    for (const ring of shape) {
      for (const [lat, lng] of ring) {
        const point = toPoint({ lat, lng });
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    }
  }

  // A cell of margin all round, so a cell centre never falls outside the array
  // when something snaps to the edge of the surface.
  const origin = { x: minX - CELL, y: minY - CELL };
  const width = Math.ceil((maxX - minX) / CELL) + 3;
  const height = Math.ceil((maxY - minY) / CELL) + 3;
  const open = new Uint8Array(width * height);

  for (let cy = 0; cy < height; cy += 1) {
    for (let cx = 0; cx < width; cx += 1) {
      const point = { x: origin.x + (cx + 0.5) * CELL, y: origin.y + (cy + 0.5) * CELL };
      for (const shape of shapes) {
        if (inside(shape, point)) {
          open[cy * width + cx] = 1;
          break;
        }
      }
    }
  }

  sweepScraps(open, width, height);

  const floor: Floor = { venueId, level, origin, width, height, open, empty: false };
  FLOORS.set(key, floor);
  return floor;
}

/**
 * Below this a connected run of open cells is trace noise, not floor. Cells,
 * so at 1.5 m a side this is about 18 m² — smaller than a lift car and lobby.
 */
const SCRAP = 8;

/**
 * Rub out the specks the tracing leaves behind.
 *
 * A plan read off a raster produces the odd stray cell: an anti-aliased corner,
 * a pixel of corridor colour inside a wall. They look like floor to everything
 * downstream, and being *isolated* floor they are worse than useless — they are
 * the nearest open cell to whatever is beside them, so anything snapping to the
 * surface snaps to them and is then stranded on an island of one square.
 *
 * That is not hypothetical. Lucas Oil's event level came out as 513 cells and
 * one stray, and the escalator up to the concourse — a real one, read off the
 * plan — snapped to the stray. The whole stadium above the event level became
 * unreachable, from inside it as well as from the rest of the campus, and
 * nothing about the floor looked wrong.
 */
function sweepScraps(open: Uint8Array, width: number, height: number) {
  const seen = new Uint8Array(open.length);
  for (let start = 0; start < open.length; start += 1) {
    if (!open[start] || seen[start]) continue;
    const queue = [start];
    const cells: number[] = [];
    seen[start] = 1;
    while (queue.length) {
      const i = queue.pop()!;
      cells.push(i);
      const cx = i % width;
      const cy = Math.floor(i / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (!open[next] || seen[next]) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    if (cells.length < SCRAP) for (const i of cells) open[i] = 0;
  }
}

export const cellCentre = (floor: Floor, cx: number, cy: number): Point => ({
  x: floor.origin.x + (cx + 0.5) * CELL,
  y: floor.origin.y + (cy + 0.5) * CELL,
});

export const cellOf = (floor: Floor, point: Point) => ({
  cx: Math.floor((point.x - floor.origin.x) / CELL),
  cy: Math.floor((point.y - floor.origin.y) / CELL),
});

/**
 * The nearest cell you could stand in, searched outwards from a point.
 *
 * Everything a route touches arrives as a coordinate rather than a cell — a
 * room's doorway, a staircase, the end of a skywalk — and none of them are
 * guaranteed to land on walkable surface: a doorway is *in the wall*, and the
 * plans the two surfaces come from are traced to a quarter of a metre. So the
 * search is generous, and returns null rather than a wrong answer when there is
 * genuinely nothing within reach.
 */
export function nearestOpen(floor: Floor, point: Point, withinMetres = 25) {
  if (floor.empty) return null;
  const start = cellOf(floor, point);
  const rings = Math.ceil(withinMetres / CELL);

  let best: { cx: number; cy: number; away: number } | null = null;
  for (let r = 0; r <= rings; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        // Only the edge of each ring: the inside was covered by a smaller one.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = start.cx + dx;
        const cy = start.cy + dy;
        if (!at(floor, cx, cy)) continue;
        const away = between(point, cellCentre(floor, cx, cy));
        if (!best || away < best.away) best = { cx, cy, away };
      }
    }
    // A whole ring found something: the next ring out cannot beat it by more
    // than one cell's diagonal, so one more ring settles it.
    if (best && best.away <= (r + 1) * CELL) break;
  }
  return best && best.away <= withinMetres ? best : null;
}

/**
 * A* between two cells on one floor.
 *
 * Eight-connected, with diagonals refused where they would cut a corner: a
 * route that slips between two blocked cells diagonally is a route through a
 * doorframe, and it looks plausible until you are standing at the wall.
 */
export function pathBetween(
  floor: Floor,
  from: { cx: number; cy: number },
  to: { cx: number; cy: number },
): Point[] | null {
  if (floor.empty) return null;
  const size = floor.width * floor.height;
  const index = (c: { cx: number; cy: number }) => c.cy * floor.width + c.cx;
  const start = index(from);
  const goal = index(to);
  if (!floor.open[start] || !floor.open[goal]) return null;
  if (start === goal) return [cellCentre(floor, from.cx, from.cy)];

  const cost = new Float64Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const done = new Uint8Array(size);
  cost[start] = 0;

  const heuristic = (i: number) =>
    Math.hypot((i % floor.width) - to.cx, Math.floor(i / floor.width) - to.cy) * CELL;

  // A binary heap keyed on cost + heuristic. A floor is tens of thousands of
  // cells, which is more than a linear scan of the frontier wants to bear.
  const heap: Array<{ i: number; f: number }> = [{ i: start, f: heuristic(start) }];
  const push = (item: { i: number; f: number }) => {
    heap.push(item);
    let c = heap.length - 1;
    while (c > 0) {
      const parent = (c - 1) >> 1;
      if (heap[parent].f <= heap[c].f) break;
      [heap[parent], heap[c]] = [heap[c], heap[parent]];
      c = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let small = c;
        if (l < heap.length && heap[l].f < heap[small].f) small = l;
        if (r < heap.length && heap[r].f < heap[small].f) small = r;
        if (small === c) break;
        [heap[small], heap[c]] = [heap[c], heap[small]];
        c = small;
      }
    }
    return top;
  };

  while (heap.length) {
    const { i } = pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === goal) break;

    const cx = i % floor.width;
    const cy = Math.floor(i / floor.width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!at(floor, nx, ny)) continue;
        // No slipping through the gap where two walls meet at a corner.
        if (dx && dy && (!at(floor, cx + dx, cy) || !at(floor, cx, cy + dy))) continue;
        const next = ny * floor.width + nx;
        if (done[next]) continue;
        const step = (dx && dy ? Math.SQRT2 : 1) * CELL;
        if (cost[i] + step >= cost[next]) continue;
        cost[next] = cost[i] + step;
        cameFrom[next] = i;
        push({ i: next, f: cost[next] + heuristic(next) });
      }
    }
  }

  if (cameFrom[goal] === -1 && goal !== start) return null;

  const cells: number[] = [];
  for (let i = goal; i !== -1; i = cameFrom[i]) cells.push(i);
  cells.reverse();
  return smooth(
    floor,
    cells.map((i) => ({ cx: i % floor.width, cy: Math.floor(i / floor.width) })),
  );
}

/** Whether a straight line between two cells stays on walkable surface. */
function clear(floor: Floor, a: { cx: number; cy: number }, b: { cx: number; cy: number }) {
  const steps = Math.ceil(Math.hypot(b.cx - a.cx, b.cy - a.cy) * 2);
  for (let s = 0; s <= steps; s += 1) {
    const t = steps ? s / steps : 0;
    const cx = Math.round(a.cx + (b.cx - a.cx) * t);
    const cy = Math.round(a.cy + (b.cy - a.cy) * t);
    if (!at(floor, cx, cy)) return false;
  }
  return true;
}

/**
 * Pulls the string taut.
 *
 * A grid path turns in 45° steps and reads as a staircase down a corridor that
 * is actually straight. Dropping every corner the line of sight can see past
 * leaves the turns that are really there.
 */
function smooth(floor: Floor, cells: Array<{ cx: number; cy: number }>): Point[] {
  const kept = [cells[0]];
  let anchor = 0;
  for (let i = 2; i < cells.length; i += 1) {
    if (clear(floor, cells[anchor], cells[i])) continue;
    kept.push(cells[i - 1]);
    anchor = i - 1;
  }
  kept.push(cells[cells.length - 1]);
  return kept.map((cell) => cellCentre(floor, cell.cx, cell.cy));
}

/**
 * How far a doorway may be from the circulation it opens onto. Metres.
 *
 * Not the width of a door — the width of what the plan did not colour. A
 * hotel's drawn corridor can start well inside the block, so the gap between a
 * room's outline and the nearest walkable pixel is a drawing artefact rather
 * than a distance anybody walks. This was 12 m, which left seven rooms on drawn
 * floors falling back to their centres for want of two or three metres.
 *
 * It can be this generous because `crosses` below does the discriminating: the
 * danger in reaching further was never the distance, it was landing on a
 * corridor that happens to be near but is on the far side of somebody else's
 * room. That is now tested for directly rather than guarded against with a
 * number.
 */
const REACH = 25;

/**
 * Where you go into a room from the corridor outside it.
 *
 * A room's centre is where its label goes, not where its door is, and for a
 * hall the size of Exhibit Hall A the two are eighty metres apart — so a route
 * measured centre to centre is wrong by the length of the room at both ends,
 * and drawn through its wall.
 *
 * The door is not in any of the data. What is in the data is the room's outline
 * and the corridor beside it, and a room is entered from the corridor: so the
 * point on its boundary closest to walkable surface is the doorway, to within
 * the width of the door. Rooms opening off two corridors get the nearer one,
 * which is also the one you would use.
 *
 * `blocked` is what keeps that honest over a longer reach. Union Station's
 * B&O room has a corridor 20 m away and two other railroad rooms in between,
 * and the nearest walkable pixel is on the wrong side of both of them: a door
 * there is a door through a wall into somebody else's meeting. Given a way to
 * ask, this steps along the line from each candidate to its corridor and
 * throws away any that does not get there — which is what "you can walk out of
 * this door" actually means, and is a better rule than any radius.
 */
export function roomEntrance(
  rings: readonly PlanRing[],
  venueId: string,
  level: string,
  blocked?: (at: LatLng) => boolean,
): { door: LatLng; cell: { cx: number; cy: number } } | null {
  const floor = floorOf(venueId, level);
  if (floor.empty || !rings.length) return null;

  let best: { door: Point; cell: { cx: number; cy: number }; away: number } | null = null;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const a = toPoint({ lat: ring[i][0], lng: ring[i][1] });
      const b = toPoint({ lat: ring[(i + 1) % ring.length][0], lng: ring[(i + 1) % ring.length][1] });
      // Along the wall as well as at its corners: a door is usually mid-wall,
      // and a long wall with a corridor beside it would otherwise be judged by
      // its ends alone.
      const steps = Math.max(1, Math.ceil(between(a, b) / CELL));
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        const on = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const open = nearestOpen(floor, on, REACH);
        if (!open) continue;
        if (best && open.away >= best.away) continue;
        if (blocked && throughSomethingElse(on, cellCentre(floor, open.cx, open.cy), blocked) > THROUGH) {
          continue;
        }
        best = { door: on, cell: { cx: open.cx, cy: open.cy }, away: open.away };
      }
    }
  }
  return best ? { door: toLatLng(best.door), cell: best.cell } : null;
}

/**
 * How much of a doorway is somebody else's room. Metres.
 *
 * Not zero, and that is the whole subtlety. Most room outlines here are
 * schematic rectangles that abut, so the line from a door to the corridor two
 * metres away clips the neighbour it shares a wall with — which is a drawing
 * artefact, not a route through a meeting. Union Station lost two rooms'
 * doorways to exactly that before this had a tolerance.
 *
 * Past a couple of metres it is no longer a shared edge: Union Station's B&O
 * room has circulation 20 m off its wall with two whole railroad rooms in
 * between, and that is the case worth refusing.
 */
const THROUGH = 3;

/**
 * How far the way from a doorway to its corridor runs inside something else.
 *
 * Sampled rather than solved: the caller's test is "is this point inside
 * another room", and a room is a polygon, so stepping along at the grid's own
 * resolution measures any crossing wider than one cell. Anything narrower than
 * a cell is not a room anybody could be walking through.
 */
function throughSomethingElse(from: Point, to: Point, blocked: (at: LatLng) => boolean) {
  const span = between(from, to);
  const steps = Math.max(1, Math.ceil(span / CELL));
  let inside = 0;
  for (let s = 1; s < steps; s += 1) {
    const t = s / steps;
    if (blocked(toLatLng({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }))) {
      inside += span / steps;
    }
  }
  return inside;
}

/** Metres from a point to a segment, in the campus frame. */
function toSegment(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const along = length
    ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
    : 0;
  return Math.hypot(point.x - (a.x + along * dx), point.y - (a.y + along * dy));
}

/** Ignore a scrap of floor this small when looking for a way out. Cells. */
const MIN_PIECE = 8;

/**
 * How far behind the wall a door may still be, past the nearest cell of its
 * piece. Metres — about the depth of a lobby.
 *
 * Relative to the piece rather than absolute, because how close a plan's
 * circulation comes to the outline varies with how the plan was coloured: the
 * convention centre's concourse runs along its glass, while a hotel's drawn
 * corridor can start thirty metres in. Both have doors.
 */
const LOBBY = 10;

/** Two ways out nearer than this to each other are one way out. Metres. */
const APART = 45;

/**
 * Where a floor's circulation comes closest to the outside wall — its doors.
 *
 * Nothing in this repository marks a door to the street, but a building is left
 * from the corridor that reaches its perimeter: a door is in an outside wall,
 * and the only walkable surface touching one is the corridor beside it. So the
 * open cells nearest the building's outline are where you get out, to within
 * the width of the lobby.
 *
 * **Several per building, spread around it.** The convention centre is 400 m
 * across and had one door, which is not how anybody uses it: every route out of
 * it left by the same corner, and the walk to the street was long enough — 90 m
 * of straight line — to beat the skywalks on distance while being far less use.
 * So doors are taken greedily, nearest the wall first, each at least `APART`
 * from the ones already taken. The convention centre gets a ring of them and a
 * hotel corridor still gets one.
 *
 * **And at least one per connected piece of the floor.** A hotel's circulation
 * is often drawn as several pieces that do not touch — a lobby here, a corridor
 * there, whatever the plan happened to colour — and doors clustered in one of
 * them would leave the others with no way out at all: everything in them could
 * reach no door, and, having a square to stand on, would not count as being on
 * the street either. The JW Marriott went from routable to entirely unreachable
 * exactly that way. A piece you can stand in is a piece you can leave.
 *
 * This is a coarser inference than a room's doorway — that had a room outline
 * metres from a corridor, this has a building's whole perimeter. It is enough
 * to answer "leave about here", and the leg from it to the pavement is a
 * straight line that says so.
 */
export function doorsOf(
  floor: Floor,
  ring: readonly (readonly [number, number])[],
): Array<{ cx: number; cy: number }> {
  if (floor.empty || ring.length < 2) return [];

  const wall = ring.map(([lat, lng]) => toPoint({ lat, lng }));
  const fromWall = (at: Point) => {
    let away = Infinity;
    for (let i = 0, j = wall.length - 1; i < wall.length; j = i, i += 1) {
      away = Math.min(away, toSegment(at, wall[j], wall[i]));
    }
    return away;
  };

  const seen = new Uint8Array(floor.open.length);
  const doors: Array<{ cx: number; cy: number }> = [];
  for (let start = 0; start < floor.open.length; start += 1) {
    if (!floor.open[start] || seen[start]) continue;

    const queue = [start];
    seen[start] = 1;
    const piece: Array<{ cx: number; cy: number; at: Point; away: number }> = [];
    while (queue.length) {
      const i = queue.pop()!;
      const cx = i % floor.width;
      const cy = Math.floor(i / floor.width);
      const at = cellCentre(floor, cx, cy);
      piece.push({ cx, cy, at, away: fromWall(at) });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= floor.width || ny >= floor.height) continue;
        const next = ny * floor.width + nx;
        if (!floor.open[next] || seen[next]) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    if (piece.length < MIN_PIECE) continue;

    // Nearest the wall first, so the first door taken is the best one and the
    // rest fill in round the building.
    piece.sort((a, b) => a.away - b.away);
    const reach = piece[0].away + LOBBY;
    const taken: Point[] = [];
    for (const cell of piece) {
      if (cell.away > reach) break;
      if (taken.some((door) => between(door, cell.at) < APART)) continue;
      taken.push(cell.at);
      doors.push({ cx: cell.cx, cy: cell.cy });
    }
  }
  return doors;
}

/** How much of a floor was drawn, for the tests and for `--inspect`-style checks. */
export function floorArea(venueId: string, level: string) {
  const floor = floorOf(venueId, level);
  let open = 0;
  for (const cell of floor.open) open += cell;
  return { cells: open, squareMetres: open * CELL * CELL };
}
