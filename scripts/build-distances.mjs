/**
 * Every room to every other room, measured once, so the app never has to.
 *
 * WHY THIS EXISTS. Routing is not cheap: `walkBetween` copies the campus graph,
 * joins both ends to everything on their floors, and runs Dijkstra twice — a
 * measured **128 ms** a route. That is fine for the one route somebody has
 * asked for and hopeless for a list: showing "how far away" against eight
 * search results is a second of main-thread work per keystroke, and against
 * every room on the campus it is nineteen seconds. So the answer that cannot be
 * computed when it is wanted is computed here instead, and shipped as a table.
 *
 * WHY ROOM BY ROOM RATHER THAN ZONE BY ZONE. Grouping rooms into venue-and-
 * floor zones gives 31 zones and a 961-cell table, which sounds much cheaper
 * until you look at what a zone is. Measured across this campus:
 *
 *     icc/Level 1                20 rooms, 1 to 5 minutes apart inside it
 *     crowne-plaza/1st floor     19 rooms, 1 to 3
 *     marriott-downtown/1st      12 rooms, 1 to 2
 *     westin/1st floor            9 rooms, 1 to 1
 *
 * The hotels do collapse — a zone really is one number there. The convention
 * centre does not, and the convention centre is where people are: a single
 * number for Level 1 is wrong by up to four minutes on precisely the walks
 * that matter. The full table is 11,026 pairs and 9.3 KB gzipped, and it is
 * right to eight metres. There was nothing to buy with the imprecision.
 *
 * HOW IT IS BUILT. Not 11,026 routes — that would be twenty minutes. One graph
 * holding all 149 doorways at once, then one Dijkstra per room over it, which
 * is what `metresBetweenAll` in `route.ts` does. Same router, same constants,
 * same `WORTH_STAYING_IN` rule; the table cannot drift from the route it is
 * predicting because it is not a second implementation of it.
 *
 *     node scripts/build-distances.mjs
 *
 * Writes src/data/distances.ts. Refuses to write if a sample of the table
 * disagrees with what `walkBetween` says for the same pair.
 */

import { build } from 'esbuild';
import { rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/data/distances.ts');

/**
 * Metres per stored step.
 *
 * One byte a pair rather than two, which halves the table and — because base64
 * of 16-bit metres is very nearly incompressible — takes it from 18.8 KB
 * gzipped to 9.3 KB. The cost is 8 m of rounding at worst, which at walking
 * pace is seven seconds. The estimate is reported in whole minutes and padded
 * by one of them, so seven seconds is not merely tolerable, it is invisible:
 * the rounding error is a quarter of the unit the answer is printed in.
 */
const STEP = 16;
/** The "no route" marker, and the one value a real distance may not take. */
const NO_ROUTE = 255;
/** Every Nth pair is re-routed for real and compared. Deterministic on purpose. */
const CHECK_EVERY = 400;
/** Metres a checked pair may differ by before the table is refused. */
const TOLERANCE = STEP / 2;

async function load() {
  const out = join(tmpdir(), `distances-${process.pid}.mjs`);
  await build({
    stdin: {
      contents: `
        export { ROOMS } from './src/data/venues';
        export { placeAnchor, placePosition } from './src/data/navigation';
        export { metresBetweenAll, walkBetween } from './src/data/route';
      `,
      resolveDir: ROOT,
      sourcefile: 'distances-entry.ts',
      loader: 'ts',
    },
    outfile: out,
    bundle: true,
    format: 'esm',
    logLevel: 'warning',
  });
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    await rm(out, { force: true });
  }
}

const { ROOMS, placeAnchor, placePosition, metresBetweenAll, walkBetween } = await load();

// Sorted by id so the file is stable: a room added in the middle of venues.ts
// should not rewrite every row of the table and every line of the diff.
const rooms = [...ROOMS].map((room) => room.id).sort();
const anchors = new Map();
const doors = new Map();
for (const id of rooms) {
  const anchor = placeAnchor({ kind: 'room', roomId: id }, null);
  const at = placePosition({ kind: 'room', roomId: id }, null);
  if (anchor && at) {
    anchors.set(id, anchor);
    doors.set(id, at);
  }
}

const missing = rooms.filter((id) => !anchors.has(id));
if (missing.length) {
  console.error(`No position for ${missing.length} rooms: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`Routing ${rooms.length} rooms against each other...`);
const started = Date.now();
const table = metresBetweenAll(rooms.map((id) => ({ id, anchor: anchors.get(id) })));
console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s`);

/* --------------------------------------------------------------- packing */

const n = rooms.length;
const pairs = (n * (n - 1)) / 2;
const packed = new Uint8Array(pairs);
const at = (i, j) => i * n - (i * (i + 1)) / 2 + (j - i - 1);

let reachable = 0;
let asymmetric = 0;
let longest = 0;
for (let i = 0; i < n; i += 1) {
  for (let j = i + 1; j < n; j += 1) {
    const there = table.get(rooms[i])?.get(rooms[j]);
    const back = table.get(rooms[j])?.get(rooms[i]);
    // Every edge is added in both directions with the same metres, so the two
    // should agree exactly. Counted rather than assumed, because if they ever
    // stop agreeing, storing half a matrix is quietly the wrong shape.
    if (there !== undefined && back !== undefined && Math.abs(there - back) > TOLERANCE) {
      asymmetric += 1;
    }
    const metres = there ?? back;
    if (metres === undefined) {
      packed[at(i, j)] = NO_ROUTE;
      continue;
    }
    reachable += 1;
    longest = Math.max(longest, metres);
    // At least one step between two rooms that are not the same room. Some
    // doorways are within eight metres of each other and would round to zero,
    // and zero has to keep meaning "the same place" — `roughMinutes` reads it
    // as "you are here". It costs nothing in the answer: a walk of five metres
    // and a walk of sixteen are both one minute.
    packed[at(i, j)] = Math.max(1, Math.min(NO_ROUTE - 1, Math.round(metres / STEP)));
  }
}

if (asymmetric) {
  console.error(`${asymmetric} pairs measure differently in each direction — the table is not symmetric.`);
  process.exit(1);
}
if (reachable < pairs * 0.99) {
  console.error(`Only ${reachable} of ${pairs} pairs have a route; something is disconnected.`);
  process.exit(1);
}

/* -------------------------------------------------------------- checking */

console.log('Checking a sample against the router itself...');
let checked = 0;
const wrong = [];
for (let i = 0; i < n; i += 1) {
  for (let j = i + 1; j < n; j += 1) {
    if ((at(i, j) + 1) % CHECK_EVERY) continue;
    checked += 1;
    const walk = walkBetween(anchors.get(rooms[i]), anchors.get(rooms[j]));
    const stored = packed[at(i, j)] === NO_ROUTE ? null : packed[at(i, j)] * STEP;
    const real = walk ? Math.round(walk.metres) : null;
    // Half a step, except at the floor, where a walk shorter than one step is
    // deliberately stored as one — see the packing above.
    const agrees =
      stored === null || real === null
        ? stored === real
        : Math.abs(real - stored) <= TOLERANCE || (stored === STEP && real < STEP);
    if (!agrees) wrong.push(`${rooms[i]} → ${rooms[j]}: table ${stored} m, router ${real} m`);
  }
}
if (wrong.length) {
  console.error(`${wrong.length} of ${checked} sampled pairs disagree with the router:`);
  for (const line of wrong.slice(0, 10)) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`  ${checked} pairs agree with walkBetween to within ${TOLERANCE} m`);
if (longest / STEP >= NO_ROUTE - 1) {
  console.error(`The longest walk is ${Math.round(longest)} m, past what one byte of ${STEP} m steps can hold.`);
  process.exit(1);
}

/* --------------------------------------------------------------- writing */

const base64 = Buffer.from(packed).toString('base64');

const file = `/**
 * How far it is from every room to every other, in metres.
 *
 * Generated by scripts/build-distances.mjs — do not edit by hand. That script
 * carries the method, the measurements behind it and the checking; this is only
 * its answer. Read it through \`nearby.ts\`, which is the part with an opinion
 * about what the numbers mean.
 *
 * ${n} rooms, ${pairs.toLocaleString('en-GB')} pairs, ${reachable.toLocaleString('en-GB')} of them reachable on foot.
 * The longest walk on the campus is ${Math.round(longest).toLocaleString('en-GB')} m.
 *
 * These are the same metres \`walkBetween\` would find for the same two doorways
 * — one graph, one Dijkstra per room, rather than a second implementation of
 * the same idea — and the build re-routes a sample of them to prove it.
 *
 * SHAPE. The upper triangle of a symmetric matrix, row by row, one byte a pair,
 * base64. Row \`i\` column \`j\` (for \`i < j\`) is at
 * \`i * n - i * (i + 1) / 2 + (j - i - 1)\`, and holds the walk in ${STEP}-metre
 * steps; ${NO_ROUTE} means no route was found.
 *
 * Half a matrix because every edge in the graph is added in both directions
 * with the same length, so the two directions cannot differ — and the build
 * refuses to write if they ever do. One byte rather than two because base64 of
 * 16-bit metres barely compresses: this is 9.3 KB gzipped against 18.8, for 8 m
 * of rounding at worst — seven seconds' walking, under an answer printed in
 * whole minutes and padded by one of them.
 */

/** Room ids, sorted, in the order the table indexes them. */
export const DISTANCE_ROOMS: readonly string[] = [
${rooms.map((id) => `  '${id}',`).join('\n')}
];

/**
 * The doorway each row was measured from, as [latitude, longitude].
 *
 * Carried here rather than looked up because working out where a room is
 * entered means gridding its floor — the expensive half of the router, and the
 * thing this table exists to avoid loading. Five decimals is about a metre,
 * which is finer than a doorway is wide.
 */
export const DISTANCE_DOORS: ReadonlyArray<readonly [number, number]> = [
${rooms.map((id) => `  [${doors.get(id).lat.toFixed(5)}, ${doors.get(id).lng.toFixed(5)}],`).join('\n')}
];

/** Metres per stored step. Multiply a cell by this to read it. */
export const DISTANCE_STEP = ${STEP};

/** The value standing for "these two are not joined by anything walkable". */
export const NO_ROUTE = ${NO_ROUTE};

/** The packed upper triangle. Decoded once, on first use, by \`nearby.ts\`. */
export const DISTANCE_TABLE =
  '${base64}';
`;

await writeFile(OUT, file);
console.log(
  `Wrote ${OUT}: ${n} rooms, ${pairs.toLocaleString('en-GB')} pairs, ${(base64.length / 1024).toFixed(1)} KB of base64.`,
);
