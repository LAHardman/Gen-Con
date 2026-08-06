/**
 * The pavements, pulled from OpenStreetMap.
 *
 * A route between two buildings no skywalk joins used to be a straight line
 * between their doors, drawn dashed and called what it was — a bearing with a
 * detour factor on it, going through whatever stood in the way. Downtown
 * Indianapolis has its footways mapped, so it need not be: this pulls them and
 * `route.ts` walks them.
 *
 *     node scripts/fetch-pavements.mjs
 *
 * Regenerates src/data/pavements.ts. Overpass is a shared free service, so this
 * is run by hand when the data is worth refreshing rather than by the build.
 *
 * WHAT IS TAKEN. `highway=footway`, `path`, `pedestrian`, `steps` and
 * `living_street` over the campus and a little beyond it. That is the sidewalk
 * on each side of the street, the crossings between them, and the plazas.
 *
 * WHAT IS NOT, and this matters more than the taking:
 *
 *   Anything on a `bridge` or in a `tunnel`, anything `covered`, and anything
 *   with a `layer` or `level` that is not the ground. In this bounding box
 *   those tags are almost exactly the skywalk system and the tunnel to the
 *   stadium — twenty-two bridges and nine tunnels — and this repository
 *   already has those, in `connections.ts`, with the floor each one lands on.
 *   Taking them here as well would draw a second copy of every skywalk that
 *   knew nothing about which storey it enters, and let a route cross one
 *   without ever going upstairs.
 *
 *   Anything tagged `access=no` or `private`, which is somebody's forecourt.
 *
 * WHAT IS KEPT OF THE SHAPE. A footway is stored as an edge between two
 * junctions, carrying the bend of the path between them so the map can draw
 * it. Runs of way with nothing joining them are welded into one edge first,
 * which is what takes 662 ways down to a few hundred. Only the largest
 * connected piece is written: the rest are stubs into car parks that no route
 * can reach anyway, and they would only be bytes.
 *
 * Source: OpenStreetMap, © OpenStreetMap contributors, ODbL. Same licence and
 * same credit as `footprints.ts`, which the map already shows.
 */

import { writeFileSync } from 'node:fs';
import { onTheGround } from './lib/pavements.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/data/pavements.ts');

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const AGENT = 'gen-con-trip/0.1 (+https://github.com/LAHardman/Gen-Con)';

/**
 * The campus, and 150 m of margin on every side.
 *
 * The venues span 39.7587–39.7692 by -86.1694 to -86.1583, about 1.2 km by
 * 0.9 km. The margin is there because the shortest way between two buildings
 * near an edge can leave the box and come back — round the far side of a block
 * the bounding box clips through — and a network that stopped at the venues
 * would route you along a pavement that ends in mid-air.
 */
const BOX = [39.7574, -86.1712, 39.7706, -86.1566];

/** Two points nearer than this are the same junction. Metres. */
const WELD = 0.5;

/** How far a drawn bend may be straightened. Metres — the footprints use 2 m too. */
const SIMPLIFY = 2;

/** Below this many edges, a connected piece is a stub rather than a network. */
const MIN_PIECE = 8;

const LAT_M = 111_320;
/** At 39.77° north. */
const LNG_M = 85_570;

const between = (a, b) => Math.hypot((a.lat - b.lat) * LAT_M, (a.lng - b.lng) * LNG_M);

async function overpass(query) {
  // Overpass is free and busy, and its dispatcher fails outright often enough
  // that one attempt is not a fetch. The error arrives as an HTML page with 200
  // on it, so the check is on the body rather than on the status.
  let wait = 4_000;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      // Overpass answers 406 to Node's default user-agent. It asks that
      // scripts identify themselves, which is fair for a service given away.
      headers: { 'User-Agent': AGENT },
      body: new URLSearchParams({ data: query }),
    });
    const text = await response.text();
    if (text.trimStart().startsWith('{')) return JSON.parse(text);
    const why = text.match(/Error<\/strong>: ([^<]*)/)?.[1] ?? `HTTP ${response.status}`;
    console.warn(`  attempt ${attempt} failed: ${why.trim()}`);
    if (attempt === 5) throw new Error(`Overpass would not answer: ${why.trim()}`);
    await new Promise((done) => setTimeout(done, wait));
    wait *= 2;
  }
  throw new Error('unreachable');
}

/** Ramer–Douglas–Peucker over an open polyline. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const [first] = points;
  const last = points[points.length - 1];
  let far = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const away = toSegment(points[i], first, last);
    if (away > far) {
      far = away;
      at = i;
    }
  }
  if (far <= tolerance) return [first, last];
  return [
    ...simplify(points.slice(0, at + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(at), tolerance),
  ];
}

function toSegment(point, a, b) {
  const px = (point.lng - a.lng) * LNG_M;
  const py = (point.lat - a.lat) * LAT_M;
  const bx = (b.lng - a.lng) * LNG_M;
  const by = (b.lat - a.lat) * LAT_M;
  const length = bx * bx + by * by;
  const along = length ? Math.max(0, Math.min(1, (px * bx + py * by) / length)) : 0;
  return Math.hypot(px - bx * along, py - by * along);
}

async function main() {
  const [s, w, n, e] = BOX;
  console.log(`Overpass: pedestrian ways in ${s},${w},${n},${e}`);
  const data = await overpass(
    `[out:json][timeout:180];\n` +
      `way["highway"~"^(footway|path|pedestrian|steps|living_street)$"](${s},${w},${n},${e});\n` +
      `out body geom;`,
  );

  const ways = data.elements.filter((el) => el.type === 'way' && onTheGround(el.tags ?? {}));
  console.log(`  ${data.elements.length} ways, ${ways.length} on the ground`);

  /*
   * Junctions first, then the runs between them.
   *
   * A vertex is a junction when more than two way-ends meet at it, or when it
   * is the loose end of a way. Everything else is a bend, and belongs to the
   * edge rather than to the graph — a hundred-metre pavement mapped in six
   * pieces should be one edge with five kinks in it, not five nodes.
   *
   * OSM ways share node ids where they meet, so the count is exact rather than
   * a proximity test. `WELD` only catches the rare pair mapped twice.
   */
  const uses = new Map();
  for (const way of ways) {
    for (const id of way.nodes) uses.set(id, (uses.get(id) ?? 0) + 1);
  }
  const isJunction = (id, index, way) =>
    index === 0 || index === way.nodes.length - 1 || (uses.get(id) ?? 0) > 1;

  const at = new Map();
  for (const way of ways) {
    way.nodes.forEach((id, i) => at.set(id, { lat: way.geometry[i].lat, lng: way.geometry[i].lon }));
  }

  /** id of the graph node a junction becomes, welding coincident ones together. */
  const nodeOf = new Map();
  const nodes = [];
  const claim = (osmId) => {
    if (nodeOf.has(osmId)) return nodeOf.get(osmId);
    const point = at.get(osmId);
    let found = nodes.findIndex((node) => between(node, point) < WELD);
    if (found < 0) found = nodes.push(point) - 1;
    nodeOf.set(osmId, found);
    return found;
  };

  const edges = [];
  for (const way of ways) {
    let run = null;
    way.nodes.forEach((id, i) => {
      const point = { lat: way.geometry[i].lat, lng: way.geometry[i].lon };
      if (run) run.points.push(point);
      if (!isJunction(id, i, way)) return;
      if (run) {
        edges.push({ a: run.node, b: claim(id), points: run.points, steps: way.tags.highway === 'steps' });
      }
      run = { node: claim(id), points: [point] };
    });
  }
  console.log(`  ${nodes.length} junctions, ${edges.length} runs between them`);

  /* The largest connected piece, and how much is being left behind. */
  const neighbours = new Map();
  for (const edge of edges) {
    if (!neighbours.has(edge.a)) neighbours.set(edge.a, []);
    if (!neighbours.has(edge.b)) neighbours.set(edge.b, []);
    neighbours.get(edge.a).push(edge.b);
    neighbours.get(edge.b).push(edge.a);
  }
  const piece = new Map();
  let pieces = 0;
  for (const start of neighbours.keys()) {
    if (piece.has(start)) continue;
    const mark = pieces++;
    const queue = [start];
    piece.set(start, mark);
    while (queue.length) {
      for (const next of neighbours.get(queue.pop()) ?? []) {
        if (piece.has(next)) continue;
        piece.set(next, mark);
        queue.push(next);
      }
    }
  }
  const sizes = new Array(pieces).fill(0);
  for (const edge of edges) sizes[piece.get(edge.a)] += 1;
  const biggest = sizes.indexOf(Math.max(...sizes));
  const kept = edges.filter((edge) => piece.get(edge.a) === biggest);
  // Worth a second look if one of these is ever large or near the middle: the
  // campus is one piece, and everything dropped so far has been out in the
  // margin where the crossings that would join it are not mapped.
  const notable = sizes
    .map((size, mark) => ({ size, mark }))
    .filter((piece) => piece.mark !== biggest && piece.size >= MIN_PIECE)
    .map((piece) => piece.size);
  console.log(
    `  ${pieces} connected pieces; keeping the largest (${kept.length} of ${edges.length} runs). ` +
      `Dropped: ${notable.length ? `${notable.join(', ')} runs, and ` : ''}` +
      `${pieces - 1 - notable.length} stubs under ${MIN_PIECE}`,
  );

  /* Renumber, since only the largest piece's nodes are written. */
  const renumber = new Map();
  const out = [];
  const index = (old) => {
    if (!renumber.has(old)) renumber.set(old, out.push(nodes[old]) - 1);
    return renumber.get(old);
  };

  const round = (x) => Number(x.toFixed(6));
  const lines = kept.map((edge) => {
    const shape = simplify(edge.points, SIMPLIFY);
    let metres = 0;
    for (let i = 1; i < shape.length; i += 1) metres += between(shape[i - 1], shape[i]);
    return {
      a: index(edge.a),
      b: index(edge.b),
      metres: Number(metres.toFixed(1)),
      steps: edge.steps,
      // Both ends are the graph's nodes already; only the bend between them
      // needs storing.
      bend: shape.slice(1, -1).map((point) => [round(point.lat), round(point.lng)]),
    };
  });

  const total = lines.reduce((sum, line) => sum + line.metres, 0);
  const bends = lines.reduce((sum, line) => sum + line.bend.length, 0);
  console.log(`  ${out.length} nodes, ${lines.length} edges, ${bends} bends, ${Math.round(total)} m of pavement`);

  const source = `/**
 * The pavements, as a graph, from OpenStreetMap.
 *
 * Generated by \`node scripts/fetch-pavements.mjs\` — do not edit by hand. What
 * is in here and what is deliberately left out is documented there; the short
 * version is that this is the ground-level footway network over the campus, and
 * that the skywalks are **not** part of it because \`connections.ts\` has them
 * with the floor each one lands on.
 *
 * ${out.length} junctions and ${lines.length} runs between them, ${Math.round(total)} m of pavement in all.
 *
 * Source: OpenStreetMap, © OpenStreetMap contributors, licensed under the Open
 * Database Licence (ODbL).
 */

/** A junction, as [latitude, longitude]. */
export type PavementNode = readonly [number, number];

export interface PavementEdge {
  /** Indices into \`PAVEMENT_NODES\`. */
  a: number;
  b: number;
  /** Along the path as drawn, not as the crow flies. */
  metres: number;
  /** \`highway=steps\`: walkable, but not by everyone. */
  steps?: true;
  /** The bend between the two ends, if it has one. Neither end is repeated. */
  bend?: ReadonlyArray<PavementNode>;
}

export const PAVEMENT_NODES: ReadonlyArray<PavementNode> = [
${out.map((point) => `  [${round(point.lat)}, ${round(point.lng)}],`).join('\n')}
];

export const PAVEMENT_EDGES: ReadonlyArray<PavementEdge> = [
${lines
  .map((line) => {
    const bend = line.bend.length
      ? `, bend: [${line.bend.map(([lat, lng]) => `[${lat}, ${lng}]`).join(', ')}]`
      : '';
    return `  { a: ${line.a}, b: ${line.b}, metres: ${line.metres}${line.steps ? ', steps: true' : ''}${bend} },`;
  })
  .join('\n')}
];
`;

  writeFileSync(OUT, source);
  console.log(`${OUT}: ${(source.length / 1024) | 0} KB`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
