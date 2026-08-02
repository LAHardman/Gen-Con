/**
 * Two checks over the geometry the map actually draws.
 *
 *   1. Does every room fall inside the building it belongs to?
 *   2. Do any two rooms on the same floor of the same building sit on
 *      each other?
 *
 * Both matter because the rooms come from three different places and none of
 * them knows about the others: a room is its floor-plan outline where the plan
 * draws one, its venue's outline where it fills the building, and a rectangle
 * hand-placed in a 0–100 grid where neither applies. A rectangle written from a
 * plan drawn at another scale lands a metre outside the real footprint easily
 * enough, and a plan can colour one hall straight through the next.
 *
 * So the check reads what would be drawn rather than what was authored, samples
 * it, and reports in square metres. A pair sharing a wall overlaps by a sliver
 * of one; `SLIVER` is what separates that from a collision.
 *
 *     node scripts/check-geometry.mjs
 *
 * Exits non-zero on any finding.
 */

import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Square metres two rooms may share before it counts as more than a wall. */
const SLIVER = 2;
/** Fraction of a room that may fall outside its building before it counts. */
const SPILL = 0.002;
/** Samples across a room, and across the box where two rooms cross. */
const GRID = 40;

const METRES_PER_DEGREE_LAT = 111320;
const metresPerDegreeLng = (lat) => METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);

function inRing(ring, lat, lng) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ai, bi] = ring[i];
    const [aj, bj] = ring[j];
    if (ai > lat !== aj > lat && lng < ((bj - bi) * (lat - ai)) / (aj - ai) + bi) inside = !inside;
  }
  return inside;
}

const inAny = (rings, lat, lng) => rings.some((ring) => inRing(ring, lat, lng));

function boxOf(rings) {
  const points = rings.flat();
  return {
    north: Math.max(...points.map((point) => point[0])),
    south: Math.min(...points.map((point) => point[0])),
    west: Math.min(...points.map((point) => point[1])),
    east: Math.max(...points.map((point) => point[1])),
  };
}

/** Square metres a box covers, near enough at the size of a building. */
const boxArea = (box) => (box.north - box.south) * METRES_PER_DEGREE_LAT
  * (box.east - box.west) * metresPerDegreeLng(box.north);

/** Reads `src/data/venues.ts` as it is, TypeScript and all. */
async function load() {
  const out = join(tmpdir(), `gen-con-venues-${process.pid}.mjs`);
  await build({
    entryPoints: [join(ROOT, 'src/data/venues.ts')],
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

const { ROOMS, VENUES_BY_ID, roomBounds, roomShapes, venueOutline } = await load();

/** What the map draws for a room, as rings of [lat, lng]. */
function drawnRings(room) {
  const shapes = roomShapes(room);
  if (shapes.length) return shapes.map((ring) => ring.map((point) => [point[0], point[1]]));
  if (room.fillsVenue) return [venueOutline(VENUES_BY_ID[room.venueId]).map((p) => [p[0], p[1]])];
  const [nw, se] = roomBounds(room);
  return [[[nw.lat, nw.lng], [nw.lat, se.lng], [se.lat, se.lng], [se.lat, nw.lng]]];
}

const drawn = ROOMS.map((room) => {
  const rings = drawnRings(room);
  return { room, rings, box: boxOf(rings) };
});

let findings = 0;

console.log('rooms outside their building');
for (const { room, rings, box } of drawn) {
  if (room.fillsVenue) continue; // it *is* the outline
  const outline = venueOutline(VENUES_BY_ID[room.venueId]).map((point) => [point[0], point[1]]);
  let inRoom = 0;
  let spilt = 0;
  for (let i = 0; i < GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) {
      const lat = box.south + ((box.north - box.south) * (i + 0.5)) / GRID;
      const lng = box.west + ((box.east - box.west) * (j + 0.5)) / GRID;
      if (!inAny(rings, lat, lng)) continue; // sample the room, not its bounds
      inRoom += 1;
      if (!inRing(outline, lat, lng)) spilt += 1;
    }
  }
  if (!inRoom || spilt / inRoom <= SPILL) continue;
  const metres = (boxArea(box) * spilt) / (GRID * GRID);
  console.log(`  ${room.venueId.padEnd(18)} ${room.id.padEnd(30)} `
    + `${((spilt / inRoom) * 100).toFixed(0)}% of it outside (~${Math.round(metres)} m2)`);
  findings += 1;
}

console.log('\nrooms on top of each other');
const byFloor = new Map();
for (const entry of drawn) {
  const key = `${entry.room.venueId}/${entry.room.level}`;
  if (!byFloor.has(key)) byFloor.set(key, []);
  byFloor.get(key).push(entry);
}
for (const [floor, entries] of byFloor) {
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      const one = entries[a];
      const other = entries[b];
      const north = Math.min(one.box.north, other.box.north);
      const south = Math.max(one.box.south, other.box.south);
      const west = Math.max(one.box.west, other.box.west);
      const east = Math.min(one.box.east, other.box.east);
      if (north <= south || east <= west) continue; // bounds don't even touch

      let shared = 0;
      for (let i = 0; i < GRID; i += 1) {
        for (let j = 0; j < GRID; j += 1) {
          const lat = south + ((north - south) * (i + 0.5)) / GRID;
          const lng = west + ((east - west) * (j + 0.5)) / GRID;
          if (inAny(one.rings, lat, lng) && inAny(other.rings, lat, lng)) shared += 1;
        }
      }
      if (!shared) continue;
      const metres = (boxArea({ north, south, west, east }) * shared) / (GRID * GRID);
      if (metres < SLIVER) continue; // a shared wall, not a collision
      console.log(`  ${floor.padEnd(28)} ${one.room.id} and ${other.room.id}  ~${Math.round(metres)} m2`);
      findings += 1;
    }
  }
}

console.log(findings ? `\n${findings} finding(s)` : '\nnone of either');
process.exit(findings ? 1 : 0);
