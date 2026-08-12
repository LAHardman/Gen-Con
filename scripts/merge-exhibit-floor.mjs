/**
 * The exhibit floor as one room, because that is what it is when you stand in it.
 *
 *     node scripts/merge-exhibit-floor.mjs
 *
 * Writes src/data/exhibit-floor.ts.
 *
 * WHY. Halls F to K are six rooms in the convention centre's floor plan and one
 * room at Gen Con: during the convention the walls between them are not there,
 * the aisles run straight through, and the booth numbering has never respected
 * them. Drawing six outlines with six names over one trade floor draws a
 * building the reader is not in.
 *
 * The halls do not stop existing. They stay searchable, a route still goes to
 * one, and every stand still knows which it stands in — `booth-place.ts` has
 * carried that all along, and it is the useful direction: a booth number is
 * printed on the stand and on every sign, and the hall letter is on none of
 * them. What goes is only the drawing.
 *
 * HOW. The six outlines are rasterised onto a half-metre grid and the boundary
 * of what they cover is walked. Union by tracing rather than by polygon
 * arithmetic because the halls are not rectangles — they are traced outlines of
 * eight to seventeen points with walls that jog — and because the answer is
 * checkable: the traced ring is compared back against the six it came from, and
 * the script refuses to write one that has lost or gained floor.
 */

import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/data/exhibit-floor.ts');

/** Gen Con's trade floor, in the order the aisles run. */
const HALLS = ['hall-f', 'hall-g', 'hall-h', 'hall-i', 'hall-j', 'hall-k'];

/** Half a metre. Finer than any wall jog and coarse enough to walk quickly. */
const CELL = 0.5;
/** How far a simplified point may sit from the line it replaces. */
const SLACK = 0.35;
/** Square metres the traced ring may differ from the six halls before it fails. */
const TOLERANCE = 60;

const METRES_PER_DEGREE_LAT = 111320;

async function load() {
  const file = join(tmpdir(), `exhibit-floor-${process.pid}.mjs`);
  await build({
    entryPoints: [join(ROOT, 'src/data/venues.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: file,
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(file).href);
  await rm(file, { force: true });
  return mod;
}

const { ROOMS_BY_ID, roomShapes } = await load();

const rings = HALLS.flatMap((id) => {
  const room = ROOMS_BY_ID[id];
  if (!room) throw new Error(`${id} is not a room any more`);
  const shapes = roomShapes(room);
  if (!shapes.length) throw new Error(`${id} has no floor-plan outline to merge`);
  return shapes;
});

const all = rings.flat();
const lat0 = Math.min(...all.map((p) => p[0]));
const lat1 = Math.max(...all.map((p) => p[0]));
const lng0 = Math.min(...all.map((p) => p[1]));
const lng1 = Math.max(...all.map((p) => p[1]));
const perLng = METRES_PER_DEGREE_LAT * Math.cos((lat0 * Math.PI) / 180);

/** Metres east and north of the south-west corner, and back again. */
const east = (lng) => (lng - lng0) * perLng;
const north = (lat) => (lat - lat0) * METRES_PER_DEGREE_LAT;
const backLng = (x) => lng0 + x / perLng;
const backLat = (y) => lat0 + y / METRES_PER_DEGREE_LAT;

const W = Math.ceil(east(lng1) / CELL) + 2;
const H = Math.ceil(north(lat1) / CELL) + 2;

const inRing = (ring, x, y) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ay, ax] = [north(ring[i][0]), east(ring[i][1])];
    const [by, bx] = [north(ring[j][0]), east(ring[j][1])];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
  }
  return hit;
};

/** Which half-metre cells the six halls cover between them. */
const filled = new Uint8Array(W * H);
for (let j = 0; j < H; j += 1) {
  const y = (j + 0.5) * CELL;
  for (let i = 0; i < W; i += 1) {
    const x = (i + 0.5) * CELL;
    if (rings.some((ring) => inRing(ring, x, y))) filled[j * W + i] = 1;
  }
}
const covered = filled.reduce((n, one) => n + one, 0) * CELL * CELL;

/**
 * Walk the edge of what is filled, keeping the filled cells on the left.
 *
 * A square-tracing walk on the *corners* of the grid rather than its cells, so
 * every step is an axis-aligned half-metre and the ring closes exactly.
 */
const on = (i, j) => (i >= 0 && j >= 0 && i < W && j < H ? filled[j * W + i] === 1 : false);

/*
 * The boundary as directed edges, then stitched into a loop.
 *
 * Every side of a filled cell that faces an empty one is a step of the
 * boundary, pointing so the floor is always on its left. Each corner then has
 * exactly one step leading out of it, and following them from any start walks
 * the edge once and comes back. Collecting edges rather than walking cells
 * avoids the two cases a cell walk has to special-case — a one-cell isthmus and
 * a corner where two parts of the floor touch diagonally.
 */
const steps = new Map();
const add = (from, to) => steps.set(from.join(','), to);
for (let j = 0; j < H; j += 1) {
  for (let i = 0; i < W; i += 1) {
    if (!on(i, j)) continue;
    if (!on(i, j - 1)) add([i, j], [i + 1, j]);
    if (!on(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
    if (!on(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
    if (!on(i - 1, j)) add([i, j + 1], [i, j]);
  }
}
if (!steps.size) throw new Error('nothing filled — the halls did not rasterise');

/* The longest loop, which is the outside. Anything shorter is a hole, and this
 * floor has none — the check below would catch it if it ever did. */
let path = [];
const walked = new Set();
for (const first of steps.keys()) {
  if (walked.has(first)) continue;
  const loop = [];
  let at = first;
  while (steps.has(at) && !walked.has(at)) {
    walked.add(at);
    loop.push(at.split(',').map(Number));
    at = steps.get(at).join(',');
  }
  if (loop.length > path.length) path = loop;
}
if (path.length < 8) throw new Error('the boundary walk did not close');

/** Douglas–Peucker, so a straight wall is two points rather than four hundred. */
function simplify(points, slack) {
  if (points.length < 3) return points;
  let worst = 0;
  let at = 0;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i];
    const len = Math.hypot(bx - ax, by - ay);
    const d = len === 0
      ? Math.hypot(px - ax, py - ay)
      : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= slack) return [points[0], points[points.length - 1]];
  return [
    ...simplify(points.slice(0, at + 1), slack).slice(0, -1),
    ...simplify(points.slice(at), slack),
  ];
}

const metres = path.map(([i, j]) => [i * CELL, j * CELL]);
const kept = simplify([...metres, metres[0]], SLACK);
const ring = kept.slice(0, -1).map(([x, y]) => [
  Number(backLat(y).toFixed(6)),
  Number(backLng(x).toFixed(6)),
]);

/** Shoelace, in square metres, on the local grid. */
const area = (points) => {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(sum / 2);
};
const traced = area(kept.slice(0, -1));

console.error(`six halls cover ${Math.round(covered)} m2; the traced ring is ${Math.round(traced)} m2`);
console.error(`${path.length} boundary steps simplified to ${ring.length} points`);
if (Math.abs(traced - covered) > TOLERANCE) {
  throw new Error(
    `the traced ring is ${Math.round(Math.abs(traced - covered))} m2 off the halls it came from — refusing to write it`,
  );
}

writeFileSync(
  OUT,
  `/**
 * Gen Con's trade floor as one outline. GENERATED — do not edit.
 *
 * Run \`node scripts/merge-exhibit-floor.mjs\` to rebuild this. See that script
 * for why the six halls are drawn as one and how the ring is derived.
 *
 * Halls F to K are six rooms in the convention centre's floor plan and one room
 * at Gen Con: during the convention the walls between them are not there, the
 * aisles run straight through, and the booth numbering has never respected
 * them. They stay searchable and routable and every stand still knows which
 * hall it stands in — only the drawing is merged.
 *
 * Floor plans: Indianapolis Convention & Visitors Association.
 */

/** The halls this outline covers, in the order the aisles run. */
export const TRADE_HALLS: ReadonlySet<string> = new Set(${JSON.stringify(HALLS)});

/** What the merged floor is called where a hall name would have been. */
export const TRADE_FLOOR_NAME = 'Exhibit Hall';

/** ${Math.round(traced)} m2, traced at ${CELL} m off the six outlines it merges. */
export const TRADE_FLOOR: ReadonlyArray<readonly [number, number]> = [
${ring.map(([lat, lng]) => `  [${lat}, ${lng}],`).join('\n')}
];
`,
  'utf8',
);
console.error(`wrote ${OUT}`);
