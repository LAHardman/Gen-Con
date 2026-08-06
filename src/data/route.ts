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
 *   Outdoors, the pavements are mapped and this walks them (`pavements.ts`),
 *   but nothing maps the ground between a building's door and the nearest
 *   footway — its forecourt, its plaza, its car park. That step is a straight
 *   line, and is drawn and named as one.
 *
 *   Between floors, most staircases are drawn and three buildings' are not
 *   (see `vertical.ts`). A leg over a drawn one names it; a leg over an
 *   inferred one says which stretch of corridor it must be off, because
 *   saying "take the stairs" of a guess would be inventing a staircase.
 */

import {
  CONNECTIONS,
  LANDINGS_BY_ID,
  landingsOf,
  reachesOf,
  type Connection,
} from './connections';
import { PAVEMENT_EDGES, PAVEMENT_NODES } from './pavements';
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

export type LegKind = 'walk' | 'stairs' | 'skywalk' | 'tunnel' | 'pavement' | 'outdoor';

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
  /**
   * True where the whole route is under cover — which is exactly the route the
   * covered search would have been allowed to find, because this is read off
   * the same `outdoors` flag that search filters on rather than worked out
   * again from the legs. The panel says "kept under cover" on the strength of
   * it, and the two answering differently is how that sentence would come to
   * be printed over a walk down Maryland St.
   *
   * A pavement is a surveyed surface and an accurate leg, but it is a surveyed
   * surface out in the rain, so it counts against this.
   */
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
  /** Where a span comes down on a building nobody is going to. */
  landingId?: string;
  /** A way out of a building, a junction of the pavement network, or a landing. */
  role?: 'door' | 'pavement' | 'landing';
}

const venueName = (venueId?: string) =>
  (venueId && (VENUES_BY_ID[venueId]?.shortName ?? VENUES_BY_ID[venueId]?.name)) ?? 'outside';

/** What to call the far end of a leg — a venue, or the landing it crosses. */
const placeName = (node: Node) =>
  node.landingId ? LANDINGS_BY_ID[node.landingId].name : venueName(node.venueId);

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

/**
 * A span is two nodes, one at each end — each on the floor it lands on, or on
 * the landing it comes down on where the thing it reaches has no floors.
 */
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
  for (const [landingId, end] of landingsOf(connection)) {
    nodes.push({
      id: `s${index}_l${landingId}`,
      at: toPoint({ lat: end[0], lng: end[1] }),
      landingId,
      role: 'landing',
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
  /** Out in the weather: a pavement, or the line from a door to one. */
  outdoors?: true;
}

/**
 * Past this, a straight line to the nearest pavement is not worth drawing:
 * whoever asked is not on the campus, and the panel says so already.
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
 * How far a door may reach to find a pavement. Metres.
 *
 * Nothing maps the ground between a building and the footway outside it, and
 * across the campus that gap runs from 9 m at the Embassy Suites to 126 m at
 * the Crowne Plaza, whose drawn floor is a corridor well inside a block. The
 * gap has to be crossable or no route could ever reach the network at all; how
 * far is the only question, and past about this the line stops being a
 * forecourt and starts being a journey nobody measured.
 *
 * Every building has a door within this of a pavement, the Crowne Plaza by its
 * second one.
 */
const TO_THE_PAVEMENT = 90;

/**
 * Ways off a door onto the network: the nearest pavement in each quarter of the
 * compass, rather than simply the nearest.
 *
 * A building has doors on more than one side, and the single nearest footway
 * node is on whichever side happens to win. Joining only that one sends
 * everything leaving the Westin round the same corner, adding a block to half
 * its routes. Four quadrants is enough to get out on the right side without
 * joining a door to fifty nodes it will never use.
 */
const QUADRANTS = 4;

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
          role: 'door',
        });
      });
      break;
    }
  }
  DOORS = doors;
  return doors;
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
  /** Floors, stairs, skywalks, the tunnel, pavements — what somebody surveyed. */
  measured: Span[];
  /** Every pavement junction, for an end of the route to join the network at. */
  pavement: Node[];
}

let CAMPUS: Campus | null = null;

function campusGraph(): Campus {
  if (CAMPUS) return CAMPUS;

  const nodes = new Map<string, Node>();
  const measured: Span[] = [];

  const doors = doorNodes();
  for (const door of doors) nodes.set(door.id, door);

  /* The pavements, as OpenStreetMap has them. */
  const pavement: Node[] = PAVEMENT_NODES.map(([lat, lng], i) => ({
    id: `pave:${i}`,
    at: toPoint({ lat, lng }),
    role: 'pavement',
  }));
  for (const node of pavement) nodes.set(node.id, node);
  for (const edge of PAVEMENT_EDGES) {
    measured.push([
      pavement[edge.a].id,
      pavement[edge.b].id,
      {
        metres: edge.metres,
        kind: 'pavement',
        outdoors: true,
        points: [
          toLatLng(pavement[edge.a].at),
          ...(edge.bend ?? []).map(([lat, lng]) => ({ lat, lng })),
          toLatLng(pavement[edge.b].at),
        ],
      },
    ]);
  }

  // And the way onto them from each building.
  for (const door of doors) {
    for (const [id, edge] of ontoPavement(door, pavement)) measured.push([door.id, id, edge]);
  }

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

  /*
   * Across a landing: the spans that come down on the same building are two
   * halves of one covered walk, so join them.
   *
   * Nothing has drawn the inside, so the line across it is a straight one and
   * costs what a straight one costs — no detour factor, because unlike a
   * forecourt this is a floor, and a floor does not make you walk round a
   * block. It is charged and named as the guess it is.
   */
  const byLanding = new Map<string, Node[]>();
  for (const node of nodes.values()) {
    if (!node.landingId) continue;
    if (!byLanding.has(node.landingId)) byLanding.set(node.landingId, []);
    byLanding.get(node.landingId)!.push(node);
  }
  for (const group of byLanding.values()) {
    for (let a = 0; a < group.length; a += 1) {
      for (let b = a + 1; b < group.length; b += 1) {
        measured.push([
          group[a].id,
          group[b].id,
          {
            metres: Math.max(between(group[a].at, group[b].at), 5),
            kind: 'walk',
            points: [toLatLng(group[a].at), toLatLng(group[b].at)],
          },
        ]);
      }
    }
  }

  // Same floor: the walk between them, found over the squares of that floor.
  const list = [...nodes.values()];
  for (let a = 0; a < list.length; a += 1) {
    for (let b = a + 1; b < list.length; b += 1) {
      const edge = walkEdge(list[a], list[b]);
      if (edge) measured.push([list[a].id, list[b].id, edge]);
    }
  }

  CAMPUS = { nodes, measured, pavement };
  return CAMPUS;
}

/**
 * The straight lines from a point to the pavement network, one per quadrant.
 *
 * Charged the same detour as any other unmapped line, because that is what it
 * is: nobody has drawn the path across the forecourt, so its real length is not
 * known and the line may well cross a flower bed.
 */
function ontoPavement(from: Node, pavement: Node[]): Array<[string, Omit<Edge, 'to'>]> {
  const best: Array<{ node: Node; away: number } | null> = new Array(QUADRANTS).fill(null);
  let nearest: { node: Node; away: number } | null = null;
  for (const node of pavement) {
    const away = between(from.at, node.at);
    if (!nearest || away < nearest.away) nearest = { node, away };
    if (away > TO_THE_PAVEMENT) continue;
    const quadrant =
      Math.floor(
        ((Math.atan2(node.at.y - from.at.y, node.at.x - from.at.x) + Math.PI) / (2 * Math.PI)) *
          QUADRANTS,
      ) % QUADRANTS;
    if (!best[quadrant] || away < best[quadrant]!.away) best[quadrant] = { node, away };
  }

  // Nothing within reach, so reach further. Lucas Oil's rooms are 270 m from
  // the nearest mapped footway — its plazas are not drawn as anything walkable
  // — and a point that cannot get onto the network at all can only be given a
  // bearing. One long straight line, said to be one, beats that.
  const found = best.filter((entry) => entry !== null);
  const ways = found.length ? found : nearest && nearest.away <= OUTDOOR_LIMIT ? [nearest] : [];

  return ways.map(
    (way) =>
      [
        way!.node.id,
        {
          metres: way!.away * OUTDOOR_DETOUR,
          kind: 'outdoor' as const,
          outdoors: true as const,
          points: [toLatLng(from.at), toLatLng(way!.node.at)],
        },
      ] as [string, Omit<Edge, 'to'>],
  );
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

/**
 * The shortest way, unless staying under cover costs little.
 *
 * Two searches, and the reason is no longer that a straight line would cheat.
 * Every door joins the footway network now and the network is one piece, so the
 * shortest route is a real route and can be trusted on distance. The question
 * the second search answers is a different one: whether it is *worth* it.
 *
 * Gen Con is the first week of August in Indianapolis, and downtown is joined
 * by a mile of skywalk built for exactly that. Measured against the covered
 * route, the shortest one saves 1% between the Marriott and the Westin and 4%
 * between the convention centre and the Marriott — for which nobody would
 * choose to cross Maryland St in thirty degrees. It saves more than half on
 * Exhibit Hall B to the Marriott Ballroom, where the skywalk doglegs through
 * the Westin and back, and there the street is plainly right.
 *
 * So: take the covered route when it is within `WORTH_STAYING_IN`, and the
 * shortest otherwise.
 *
 * Where there is no covered route at all the question does not arise, and the
 * shortest is simply taken. That used to include everything to or from the JW
 * Marriott and the Hyatt, whose bridges land on car parks rather than on
 * venues — see `LANDINGS`.
 */
export function walkBetween(from: Anchor, to: Anchor): Walk | null {
  const shortest = search(from, to, false);
  const covered = search(from, to, true);
  if (!covered) return shortest;
  if (!shortest) return covered;
  return covered.metres <= shortest.metres * WORTH_STAYING_IN ? covered : shortest;
}

/**
 * How much further a route may go to keep out of the weather.
 *
 * A quarter further under cover beats the direct line in August; three times
 * further does not. Between those two the honest answer is that it depends on
 * the weather and on who is walking, and this picks the sheltered one.
 */
const WORTH_STAYING_IN = 1.25;

function search(from: Anchor, to: Anchor, coveredOnly: boolean): Walk | null {
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

  for (const [a, b, edge] of campus.measured) {
    if (coveredOnly && edge.outdoors) continue;
    add(a, b, edge);
  }

  // What the two ends themselves reach: everything on their own floor, and —
  // where an end stands outdoors rather than on a floor somebody drew — the
  // pavements. Without the second, the device could only ever be given a
  // bearing.
  const ours = [start, end];
  for (let i = 0; i < ours.length; i += 1) {
    const anchor = ours[i];
    // The other end is joined once, from the first of the pair to hold it.
    for (const other of [...campus.nodes.values(), ...ours.slice(i + 1)]) {
      const walk = walkEdge(anchor, other);
      if (walk) add(anchor.id, other.id, walk);
    }
    if (!anchor.cell && !coveredOnly) {
      for (const [id, edge] of ontoPavement(anchor, campus.pavement)) add(anchor.id, id, edge);
    }
  }

  /*
   * Dijkstra, over a heap.
   *
   * This used to scan the whole frontier for its minimum, which was the right
   * shape when the graph was forty portals. The pavements bring seven hundred
   * junctions, and a scan per step made that quadratic — about a fifth of a
   * second a route, on the phone that is holding the map.
   */
  const cost = new Map<string, number>([[start.id, 0]]);
  const cameBy = new Map<string, { from: string; edge: Edge }>();
  const done = new Set<string>();
  const queue = new Frontier();
  queue.push(start.id, 0);

  for (;;) {
    const here = queue.pop();
    if (here === null) break;
    if (done.has(here)) continue;
    if (here === end.id) break;
    done.add(here);

    const best = cost.get(here)!;
    for (const edge of edges.get(here) ?? []) {
      const next = best + edge.metres;
      if (next >= (cost.get(edge.to) ?? Infinity)) continue;
      cost.set(edge.to, next);
      cameBy.set(edge.to, { from: here, edge });
      queue.push(edge.to, next);
    }
  }

  if (!cost.has(end.id)) return null;

  const legs: Leg[] = [];
  let exposed = false;
  for (let id = end.id; id !== start.id; ) {
    const step = cameBy.get(id);
    if (!step) return null;
    const node = nodes.get(id)!;
    const previous = nodes.get(step.from)!;
    if (step.edge.outdoors) exposed = true;
    legs.push(describe(step.edge, previous, node));
    id = step.from;
  }
  legs.reverse();

  const metres = legs.reduce((total, leg) => total + leg.metres, 0);
  return {
    legs: merge(legs),
    metres,
    minutes: walkingMinutes(metres),
    indoors: !exposed,
    viaStairs: legs.some((leg) => leg.kind === 'stairs'),
  };
}

/**
 * A binary heap keyed on cost, with no decrease-key.
 *
 * A node is pushed again whenever a cheaper way to it is found, and the stale
 * copies are skipped on the way out by the `done` set. That costs a little
 * memory and saves keeping an index of where each node sits in the heap.
 */
class Frontier {
  private ids: string[] = [];
  private costs: number[] = [];

  push(id: string, cost: number) {
    let i = this.ids.push(id) - 1;
    this.costs.push(cost);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.costs[parent] <= this.costs[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): string | null {
    if (!this.ids.length) return null;
    const top = this.ids[0];
    const id = this.ids.pop()!;
    const cost = this.costs.pop()!;
    if (this.ids.length) {
      this.ids[0] = id;
      this.costs[0] = cost;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let small = i;
        if (left < this.costs.length && this.costs[left] < this.costs[small]) small = left;
        if (right < this.costs.length && this.costs[right] < this.costs[small]) small = right;
        if (small === i) break;
        this.swap(small, i);
        i = small;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.costs[a], this.costs[b]] = [this.costs[b], this.costs[a]];
  }
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
      return { ...base, venueId: to.venueId, level: to.level, text: `Skywalk to ${placeName(to)}` };
    case 'tunnel':
      return { ...base, venueId: to.venueId, level: to.level, text: `Tunnel to ${placeName(to)}` };
    case 'pavement':
      return { ...base, text: 'Along the pavement' };
    // Three different things, and only the first is a step towards a building:
    // the hop off the network into a doorway, the hop from a doorway out to the
    // network, and — where the pavements cannot help at all — the whole
    // straight line from one building to another.
    case 'outdoor':
      return {
        ...base,
        text: to.venueId
          ? `Outside to ${venueName(to.venueId)}`
          : to.role === 'pavement'
            ? 'Out to the street'
            : 'Outside',
      };
    // A walk, which is a floor somebody drew — except across a landing, where
    // it is the straight line over a building nobody drew, and there is no
    // floor to name because there is no plan to have named one.
    default:
      return to.landingId
        ? { ...base, text: `Through ${placeName(to)}` }
        : {
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
