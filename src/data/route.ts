/**
 * A way to walk there, rather than a bearing to it.
 *
 * The campus is a graph of very few things — the floors you can walk on, the
 * stairs between them, the skywalks between buildings — and a great many
 * squares within each floor. So this is two searches, not one: A* over the
 * squares of a single floor (that is `walkable.ts`), and Dijkstra over a
 * handful of *portals* — a staircase, the end of a skywalk, the two ends of the
 * route itself — whose edges are the answers the first search gives.
 *
 * Doing it in one would mean one grid for the whole campus with the floors
 * stacked in it, which is both much bigger and wrong: two floors of a building
 * occupy the same squares, and a route across the concourse would happily walk
 * through the floor above it.
 *
 * What this cannot do is claim more than its sources support, and there are two
 * places it stops:
 *
 *   Outdoors, there is no pavement network in this repository. OpenStreetMap
 *   has the streets, but not as anything walkable — no crossings, no kerbs. So
 *   a leg between buildings that no skywalk joins is drawn as a straight line
 *   between their doors, charged a detour factor, and called what it is.
 *
 *   Between floors, most staircases are drawn and three buildings' are not
 *   (see `vertical.ts`). A leg over a drawn one names it; a leg over an
 *   inferred one says which stretch of corridor it must be off, because
 *   saying "take the stairs" of a guess would be inventing a staircase.
 */

import { CONNECTIONS, reachesOf, type Connection } from './connections';
import { FLOOR_CHANGE_METRES, allVerticals, type Vertical } from './vertical';
import { VENUES, VENUES_BY_ID, VENUE_LEVELS, venueOutline } from './venues';
import {
  between,
  cellOf,
  floorOf,
  cellCentre,
  doorsOf,
  nearestOpen,
  pathBetween,
  toLatLng,
  toPoint,
  type Point,
} from './walkable';
import { distanceMetres, walkingMinutes, type LatLng } from '../utils/geo';

/** One end of a route, once it knows which floor it is standing on. */
export interface Anchor {
  at: LatLng;
  /** Absent for a point outdoors, or one in a building with no floor drawn. */
  venueId?: string;
  level?: string;
}

export type LegKind = 'walk' | 'stairs' | 'skywalk' | 'tunnel' | 'outdoor';

export interface Leg {
  kind: LegKind;
  venueId?: string;
  level?: string;
  points: LatLng[];
  metres: number;
  /** One line, as you would say it. */
  text: string;
}

export interface Walk {
  legs: Leg[];
  metres: number;
  minutes: number;
  /** True where every leg is a measured surface — no outdoor guesswork. */
  indoors: boolean;
  /** The route changes floor somewhere, and no source says exactly where. */
  viaStairs: boolean;
}

/* ------------------------------------------------------------------ nodes */

interface Node {
  id: string;
  at: Point;
  venueId?: string;
  level?: string;
  /** Its square on that floor, where it has one. */
  cell?: { cx: number; cy: number };
}

const venueName = (venueId?: string) =>
  (venueId && (VENUES_BY_ID[venueId]?.shortName ?? VENUES_BY_ID[venueId]?.name)) ?? 'outside';

function anchorNode(id: string, anchor: Anchor): Node {
  const at = toPoint(anchor.at);
  if (!anchor.venueId || !anchor.level) return { id, at };
  const floor = floorOf(anchor.venueId, anchor.level);
  const open = floor.empty ? null : nearestOpen(floor, at, 30);
  if (!open) return { id, at };
  return {
    id,
    at,
    venueId: anchor.venueId,
    level: anchor.level,
    cell: { cx: open.cx, cy: open.cy },
  };
}

/** A staircase is two nodes — one on each floor — joined by the climb. */
function verticalNodes(link: Vertical, index: number): [Node, Node] | null {
  const at = toPoint(link.at);
  const make = (level: string, suffix: string): Node | null => {
    const floor = floorOf(link.venueId, level);
    const open = floor.empty ? null : nearestOpen(floor, at, 12);
    if (!open) return null;
    return {
      id: `v${index}${suffix}`,
      at,
      venueId: link.venueId,
      level,
      cell: { cx: open.cx, cy: open.cy },
    };
  };
  const lower = make(link.from, 'a');
  const upper = make(link.to, 'b');
  return lower && upper ? [lower, upper] : null;
}

/** A span is two nodes, one at each end, each on the floor it lands on. */
function spanNodes(connection: Connection, index: number): Node[] {
  const reaches = reachesOf(connection);
  const ends = [connection.line[0], connection.line[connection.line.length - 1]];
  const nodes: Node[] = [];
  let n = 0;
  for (const [venueId, level] of reaches) {
    const floor = floorOf(venueId, level);
    if (floor.empty) continue;
    // Whichever end of the span is nearer this building is the end that lands
    // in it; a bridge is short but it is not symmetric about the street.
    const at = toPoint(
      distanceMetres({ lat: ends[0][0], lng: ends[0][1] }, VENUES_BY_ID[venueId].anchor.nw) <
      distanceMetres({ lat: ends[1][0], lng: ends[1][1] }, VENUES_BY_ID[venueId].anchor.nw)
        ? { lat: ends[0][0], lng: ends[0][1] }
        : { lat: ends[1][0], lng: ends[1][1] },
    );
    const open = nearestOpen(floor, at, 60);
    if (!open) continue;
    nodes.push({
      id: `s${index}_${n++}`,
      at,
      venueId,
      level,
      cell: { cx: open.cx, cy: open.cy },
    });
  }
  return nodes;
}

/* ----------------------------------------------------------------- search */

interface Edge {
  to: string;
  metres: number;
  kind: LegKind;
  /** Filled in for a walk, so the winning route keeps the line it found. */
  points?: LatLng[];
  /** For a floor change: whether the plans drew it or the floors implied it. */
  certainty?: 'plan' | 'region';
}

/**
 * How much further apart two points must be, outdoors, before a straight line
 * between them is worth offering at all. Beyond the campus this is a bearing
 * and the panel already says so.
 */
const OUTDOOR_LIMIT = 4_000;

/**
 * What a straight line outdoors really costs to walk.
 *
 * Downtown Indianapolis is a grid, and you cannot walk a diagonal across a
 * block: for origin-destination pairs at random angles the walk over a grid
 * averages 4/π — about 1.27 — times the straight line between them, before any
 * of the waiting at crossings. So an outdoor leg is charged, and reported, at
 * a little over that.
 *
 * Leaving it at 1.0 does not merely under-report; it changes the answer. An
 * uncorrected straight line between two doors beats the real indoor route
 * almost every time, so the router would send you out into an Indianapolis
 * August rather than over the skywalk that exists precisely to avoid it.
 */
const OUTDOOR_DETOUR = 1.3;

/**
 * The ways out of each building: which floor you leave from, and where on it.
 *
 * The lowest floor that has any circulation drawn, because that is the one
 * nearest the street — not `defaultLevel`, which is the floor a building holds
 * *events* on and is often upstairs. Where the ground floor was never drawn the
 * door lands on whatever floor was, which is wrong about the storey and right
 * about the building; the leg it produces is a straight line either way.
 *
 * One door per connected piece of that floor rather than one per floor — see
 * `doorsOf`. A building whose corridors are drawn in several disconnected
 * pieces would otherwise strand everything outside the piece the door landed
 * in, which is how the JW Marriott became unreachable from everywhere.
 *
 * Built once. It depends on nothing but the floor data, and rebuilding it per
 * route meant scanning every open cell of every building on every search.
 */
let DOORS: Node[] | null = null;

function doorNodes(): Node[] {
  if (DOORS) return DOORS;
  const doors: Node[] = [];
  for (const venue of VENUES) {
    for (const level of VENUE_LEVELS[venue.id] ?? []) {
      const floor = floorOf(venue.id, level);
      if (floor.empty) continue;
      const cells = doorsOf(floor, venueOutline(venue));
      cells.forEach((cell, n) => {
        doors.push({
          id: `door:${venue.id}:${n}`,
          at: cellCentre(floor, cell.cx, cell.cy),
          venueId: venue.id,
          level,
          cell,
        });
      });
      break;
    }
  }
  DOORS = doors;
  return doors;
}

/**
 * A measured route always beats a guessed one.
 *
 * An outdoor leg is a straight line between two doors, and it goes through
 * whatever stands between them — a block, a viaduct, another building. Charging
 * it a detour factor makes the number honest but does not make the line
 * walkable, so it must not *compete* with a route made of surfaces somebody
 * drew: it is a fallback, not an alternative.
 *
 * Hence two searches. The first is over measured edges only — floors, stairs,
 * skywalks, the tunnel — and if it finds anything, that is the answer however
 * much further it goes. Only when there is no such route at all does the second
 * run with the straight lines switched on. Left to one search, the shortcut
 * wins nearly every time: Exhibit Hall B to the Marriott Ballroom came out as
 * 389 m across the street instead of 500 m over the skywalks that exist to keep
 * you out of an Indianapolis August.
 */
export function walkBetween(from: Anchor, to: Anchor): Walk | null {
  return search(from, to, false) ?? search(from, to, true);
}

/** An edge before it knows which end it is being read from. */
type Span = [a: string, b: string, edge: Omit<Edge, 'to'>];

/**
 * The campus without the route in it.
 *
 * Every node but the two ends — a staircase, a skywalk landing, a door — is the
 * same on every search, and so is every edge between them. That is nearly all
 * the work: joining the static nodes on a floor means an A\* per pair of them,
 * and doing it per route made each one about a quarter of a second and the
 * all-pairs test three quarters of a minute. Built once, a route costs only the
 * edges its own two ends need.
 */
interface Campus {
  nodes: Map<string, Node>;
  /** Floors, stairs, skywalks, the tunnel — the surfaces somebody drew. */
  measured: Span[];
  /** Door to door across the street, used only by the second pass. */
  outdoor: Span[];
}

let CAMPUS: Campus | null = null;

function campusGraph(): Campus {
  if (CAMPUS) return CAMPUS;

  const nodes = new Map<string, Node>();
  const measured: Span[] = [];
  const outdoor: Span[] = [];

  const doors = doorNodes();
  for (const door of doors) nodes.set(door.id, door);

  allVerticals().forEach((link, i) => {
    const pair = verticalNodes(link, i);
    if (!pair) return;
    for (const node of pair) nodes.set(node.id, node);
    measured.push([
      pair[0].id,
      pair[1].id,
      {
        metres: FLOOR_CHANGE_METRES,
        kind: 'stairs',
        points: [toLatLng(pair[0].at), toLatLng(pair[1].at)],
        certainty: link.certainty,
      },
    ]);
  });

  CONNECTIONS.forEach((connection, i) => {
    const ends = spanNodes(connection, i);
    for (const node of ends) nodes.set(node.id, node);
    if (ends.length < 2) return;
    const line = connection.line.map(([lat, lng]) => ({ lat, lng }));
    let metres = 0;
    for (let p = 1; p < line.length; p += 1) metres += distanceMetres(line[p - 1], line[p]);
    // Two ends is the normal case; a span touching three buildings joins each
    // pair, which is what a bridge over a junction really does.
    for (let a = 0; a < ends.length; a += 1) {
      for (let b = a + 1; b < ends.length; b += 1) {
        measured.push([
          ends[a].id,
          ends[b].id,
          {
            metres: Math.max(metres, 5),
            kind: connection.kind === 'tunnel' ? 'tunnel' : 'skywalk',
            points: line,
          },
        ]);
      }
    }
  });

  // Same floor: the walk between them, found over the squares of that floor.
  const list = [...nodes.values()];
  for (let a = 0; a < list.length; a += 1) {
    for (let b = a + 1; b < list.length; b += 1) {
      const edge = walkEdge(list[a], list[b]);
      if (edge) measured.push([list[a].id, list[b].id, edge]);
    }
  }

  /*
   * Outdoors, with no pavements to follow.
   *
   * Everything that can stand on a street joins everything else that can: the
   * doors of every building, and any end of the route that is loose — a dropped
   * point, or the device, or a room on a floor nothing drew. The loose ends are
   * joined per search below; door to door is the same every time.
   *
   * What may *not* happen is an outdoor edge to a node in the middle of a
   * floor. That was the previous rule's flaw: it joined a loose point straight
   * to the room it was headed for, which is a line through the building's wall,
   * and it left two rooms in unconnected buildings with no edge between them at
   * all — 18 pairs of buildings with no route rather than a bad one. Going out
   * of a door and in at another is both truer and always available.
   */
  for (let a = 0; a < doors.length; a += 1) {
    for (let b = a + 1; b < doors.length; b += 1) {
      const edge = outdoorEdge(doors[a], doors[b]);
      if (edge) outdoor.push([doors[a].id, doors[b].id, edge]);
    }
  }

  CAMPUS = { nodes, measured, outdoor };
  return CAMPUS;
}

/** The walk between two nodes standing on the same floor, if there is one. */
function walkEdge(one: Node, two: Node): Omit<Edge, 'to'> | null {
  if (!one.cell || !two.cell) return null;
  if (one.venueId !== two.venueId || one.level !== two.level) return null;
  const floor = floorOf(one.venueId!, one.level!);
  const path = pathBetween(floor, one.cell, two.cell);
  if (!path) return null;
  let metres = 0;
  for (let p = 1; p < path.length; p += 1) metres += between(path[p - 1], path[p]);
  // The ends themselves sit off the walkable surface — a doorway is in the
  // wall — so the step from each into its square counts.
  metres += between(one.at, path[0]) + between(two.at, path[path.length - 1]);
  return {
    metres,
    kind: 'walk',
    points: [toLatLng(one.at), ...path.map(toLatLng), toLatLng(two.at)],
  };
}

function outdoorEdge(one: Node, two: Node): Omit<Edge, 'to'> | null {
  // Two doors of the same building are the same door for this purpose.
  if (one.venueId && one.venueId === two.venueId) return null;
  const straight = between(one.at, two.at);
  if (straight > OUTDOOR_LIMIT) return null;
  return {
    metres: straight * OUTDOOR_DETOUR,
    kind: 'outdoor',
    points: [toLatLng(one.at), toLatLng(two.at)],
  };
}

function search(from: Anchor, to: Anchor, outdoors: boolean): Walk | null {
  const start = anchorNode('start', from);
  const end = anchorNode('end', to);

  const campus = campusGraph();
  const nodes = new Map(campus.nodes);
  nodes.set(start.id, start);
  nodes.set(end.id, end);

  const edges = new Map<string, Edge[]>();
  const add = (a: string, b: string, edge: Omit<Edge, 'to'>) => {
    if (!edges.has(a)) edges.set(a, []);
    if (!edges.has(b)) edges.set(b, []);
    edges.get(a)!.push({ ...edge, to: b });
    edges.get(b)!.push({ ...edge, to: a, points: edge.points ? [...edge.points].reverse() : undefined });
  };

  for (const [a, b, edge] of campus.measured) add(a, b, edge);
  if (outdoors) for (const [a, b, edge] of campus.outdoor) add(a, b, edge);

  // What the two ends themselves reach: everything on their own floor, and —
  // where an end is loose — every door on the campus.
  const ours = [start, end];
  for (let i = 0; i < ours.length; i += 1) {
    const anchor = ours[i];
    // The other end is joined once, from the first of the pair to hold it.
    const others = [...campus.nodes.values(), ...ours.slice(i + 1)];
    for (const other of others) {
      const walk = walkEdge(anchor, other);
      if (walk) add(anchor.id, other.id, walk);
      if (!outdoors || anchor.cell) continue;
      // A loose end stands on the street, so it reaches the doors — and the
      // other end too, when that one is loose as well.
      if (other.cell && !other.id.startsWith('door:')) continue;
      const street = outdoorEdge(anchor, other);
      if (street) add(anchor.id, other.id, street);
    }
  }

  /* Dijkstra: forty nodes at the outside, so nothing cleverer is called for. */
  const cost = new Map<string, number>([[start.id, 0]]);
  const cameBy = new Map<string, { from: string; edge: Edge }>();
  const done = new Set<string>();

  for (;;) {
    let here: string | null = null;
    let best = Infinity;
    for (const [id, value] of cost) {
      if (done.has(id) || value >= best) continue;
      here = id;
      best = value;
    }
    if (here === null) break;
    if (here === end.id) break;
    done.add(here);

    for (const edge of edges.get(here) ?? []) {
      const next = best + edge.metres;
      if (next >= (cost.get(edge.to) ?? Infinity)) continue;
      cost.set(edge.to, next);
      cameBy.set(edge.to, { from: here, edge });
    }
  }

  if (!cost.has(end.id)) return null;

  const legs: Leg[] = [];
  for (let id = end.id; id !== start.id; ) {
    const step = cameBy.get(id);
    if (!step) return null;
    const node = nodes.get(id)!;
    const previous = nodes.get(step.from)!;
    legs.push(describe(step.edge, previous, node));
    id = step.from;
  }
  legs.reverse();

  const metres = legs.reduce((total, leg) => total + leg.metres, 0);
  return {
    legs: merge(legs),
    metres,
    minutes: walkingMinutes(metres),
    indoors: legs.every((leg) => leg.kind !== 'outdoor'),
    viaStairs: legs.some((leg) => leg.kind === 'stairs'),
  };
}

function describe(edge: Edge, from: Node, to: Node): Leg {
  // Copied, because the campus graph is built once and its lines are handed to
  // every route that uses them. Only the legs of the winning route reach here,
  // so this is a few arrays per search rather than a few hundred — and it means
  // nothing downstream has to remember not to append to what it was given.
  const points = edge.points ? [...edge.points] : [toLatLng(from.at), toLatLng(to.at)];
  const base = { points, metres: edge.metres, kind: edge.kind };
  switch (edge.kind) {
    // Two different claims, and the wording is the difference between them.
    // A drawn stair is on the plan and the route goes to it; an inferred one is
    // somewhere along a stretch the floors prove it must be on, and saying
    // "take the stairs" of that would be inventing a staircase.
    case 'stairs':
      return {
        ...base,
        venueId: to.venueId,
        level: to.level,
        text: edge.certainty === 'plan'
          ? `Up the stairs to ${to.level}`
          : `Change to ${to.level} — the stairs and lifts are off this stretch`,
      };
    case 'skywalk':
      return { ...base, venueId: to.venueId, level: to.level, text: `Skywalk to ${venueName(to.venueId)}` };
    case 'tunnel':
      return { ...base, venueId: to.venueId, level: to.level, text: `Tunnel to ${venueName(to.venueId)}` };
    case 'outdoor':
      return {
        ...base,
        text: to.venueId ? `Outside to ${venueName(to.venueId)}` : 'Outside',
      };
    default:
      return {
        ...base,
        venueId: to.venueId,
        level: to.level,
        text: `Through ${venueName(to.venueId)}, ${to.level}`,
      };
  }
}

/** Two walks in a row on one floor read as one; a route should say each thing once. */
function merge(legs: Leg[]): Leg[] {
  const out: Leg[] = [];
  for (const leg of legs) {
    const last = out[out.length - 1];
    if (last && last.kind === leg.kind && last.venueId === leg.venueId && last.level === leg.level) {
      last.points = [...last.points, ...leg.points.slice(1)];
      last.metres += leg.metres;
      continue;
    }
    out.push({ ...leg, points: [...leg.points] });
  }
  return out;
}

export { cellOf };
