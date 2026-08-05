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
 *   and called what it is.
 *
 *   Between floors, no source marks a staircase (see `vertical.ts`). A route
 *   that changes floor says where the stairs must be rather than where they
 *   are.
 */

import { CONNECTIONS, reachesOf, type Connection } from './connections';
import { FLOOR_CHANGE_METRES, allVerticals, type Vertical } from './vertical';
import { VENUES_BY_ID } from './venues';
import {
  between,
  cellOf,
  floorOf,
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
}

/**
 * How much further apart two points must be, outdoors, before a straight line
 * between them is worth offering at all. Beyond the campus this is a bearing
 * and the panel already says so.
 */
const OUTDOOR_LIMIT = 4_000;

export function walkBetween(from: Anchor, to: Anchor): Walk | null {
  const start = anchorNode('start', from);
  const end = anchorNode('end', to);

  const nodes = new Map<string, Node>([
    [start.id, start],
    [end.id, end],
  ]);
  const edges = new Map<string, Edge[]>();
  const add = (a: string, b: string, edge: Omit<Edge, 'to'>) => {
    if (!edges.has(a)) edges.set(a, []);
    if (!edges.has(b)) edges.set(b, []);
    edges.get(a)!.push({ ...edge, to: b });
    edges.get(b)!.push({ ...edge, to: a, points: edge.points ? [...edge.points].reverse() : undefined });
  };

  allVerticals().forEach((link, i) => {
    const pair = verticalNodes(link, i);
    if (!pair) return;
    for (const node of pair) nodes.set(node.id, node);
    add(pair[0].id, pair[1].id, {
      metres: FLOOR_CHANGE_METRES,
      kind: 'stairs',
      points: [toLatLng(pair[0].at), toLatLng(pair[1].at)],
    });
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
        add(ends[a].id, ends[b].id, {
          metres: Math.max(metres, 5),
          kind: connection.kind === 'tunnel' ? 'tunnel' : 'skywalk',
          points: line,
        });
      }
    }
  });

  // Same floor: the walk between them, found over the squares of that floor.
  const list = [...nodes.values()];
  for (let a = 0; a < list.length; a += 1) {
    for (let b = a + 1; b < list.length; b += 1) {
      const one = list[a];
      const two = list[b];
      if (!one.cell || !two.cell) continue;
      if (one.venueId !== two.venueId || one.level !== two.level) continue;
      const floor = floorOf(one.venueId!, one.level!);
      const path = pathBetween(floor, one.cell, two.cell);
      if (!path) continue;
      let metres = 0;
      for (let p = 1; p < path.length; p += 1) metres += between(path[p - 1], path[p]);
      // The ends themselves sit off the walkable surface — a doorway is in the
      // wall — so the step from each into its square counts.
      metres += between(one.at, path[0]) + between(two.at, path[path.length - 1]);
      add(one.id, two.id, {
        metres,
        kind: 'walk',
        points: [toLatLng(one.at), ...path.map(toLatLng), toLatLng(two.at)],
      });
    }
  }

  // Outdoors, with no pavements to follow: a straight line from an end that is
  // outside to every way into a building, and between two ends that are both
  // outside. Never between two indoor nodes — that would be a shortcut through
  // a wall dressed up as a route.
  const outside = list.filter((node) => !node.cell);
  for (const node of outside) {
    for (const other of list) {
      if (other.id === node.id) continue;
      const metres = between(node.at, other.at);
      if (metres > OUTDOOR_LIMIT) continue;
      // Only to a way in, or to the other loose end: joining a loose point to
      // the middle of a floor would tunnel through the building's wall.
      const isDoor = other.cell && (other.id.startsWith('s') || other.id === 'end' || other.id === 'start');
      if (!isDoor && other.cell) continue;
      add(node.id, other.id, {
        metres,
        kind: 'outdoor',
        points: [toLatLng(node.at), toLatLng(other.at)],
      });
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
  const points = edge.points ?? [toLatLng(from.at), toLatLng(to.at)];
  const base = { points, metres: edge.metres, kind: edge.kind };
  switch (edge.kind) {
    case 'stairs':
      return {
        ...base,
        venueId: to.venueId,
        level: to.level,
        // Deliberately not "take the stairs": no source in this repository says
        // where they are, only that they are somewhere along here.
        text: `Change to ${to.level} — the stairs and lifts are off this stretch`,
      };
    case 'skywalk':
      return { ...base, venueId: to.venueId, level: to.level, text: `Skywalk to ${venueName(to.venueId)}` };
    case 'tunnel':
      return { ...base, venueId: to.venueId, level: to.level, text: `Tunnel to ${venueName(to.venueId)}` };
    case 'outdoor':
      return { ...base, text: 'Outside, direct — there are no pavements in the map data' };
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
