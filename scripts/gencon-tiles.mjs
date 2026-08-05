/**
 * Fetch Gen Con's own floor plans, at the resolution they publish them.
 *
 * `gencon.com/map` is a Leaflet map like this one, and its floor plans are a
 * tile pyramid — one set per campus level, cut into 256-pixel squares:
 *
 *     https://<cdn>/maps/v9/floor-<level>/<z>/<x>/<y>.png
 *
 * That beats every other source this repo has for the hotels. The sheets in
 * `plans/venues/` are screenshots: cropped, scaled by whatever was holding the
 * phone, and framing whatever happened to be on screen. The pyramid is the
 * drawing itself, whole, at one scale, with every floor in one frame.
 *
 *     node scripts/gencon-tiles.mjs                 # every floor it can find
 *     node scripts/gencon-tiles.mjs --floors 1,2    # just these
 *
 * Writes one stitched PNG per floor into `plans/campus/`, which
 * `venue-plans.mjs` then reads exactly as it reads the screenshots — the fit
 * there solves for scale and offset, so it does not care that these cover the
 * whole campus rather than one building, only that a building is whole inside
 * them.
 *
 * NOTHING ABOUT THE PYRAMID IS ASSUMED. The zoom levels it goes to and the
 * range of tiles at each are found by probing outward from a tile known to
 * exist, because guessing them from a URL is how you quietly fetch half a
 * campus.
 *
 * Be a good guest: this is somebody's CDN. Requests are made a few at a time
 * with a pause between, tiles already on disk are never fetched twice, and the
 * whole pyramid for a floor is a few hundred squares.
 *
 * Source: Gen Con LLC.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodePng, encodePng } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache/gencon-tiles');
const OUT = join(ROOT, 'plans/campus');

const HOST = process.env.GENCON_TILES ?? 'https://d2lkgynick4c0n.cloudfront.net/maps/v9';
const TILE = 256;

/** The campus levels Gen Con's own switcher offers, bottom to top. */
const FLOORS = ['B', '1', '2', '3', '4'];

/** At once, and how long to wait between rounds. Their CDN, their rules. */
const AT_ONCE = 4;
const PAUSE = 120;

const wait = (ms) => new Promise((done) => { setTimeout(done, ms); });

async function fetchTile(floor, z, x, y) {
  const path = join(CACHE, `floor-${floor}`, String(z), String(x), `${y}.png`);
  if (existsSync(path)) return readFileSync(path);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`${HOST}/floor-${floor}/${z}/${x}/${y}.png`);
      if (response.status === 403 || response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
      return body;
    } catch (error) {
      if (attempt === 3) throw error;
      await wait(400 * 2 ** attempt);
    }
  }
  return null;
}

/**
 * How deep the pyramid goes and how wide it is there.
 *
 * Every zoom is tried rather than stopping at the first empty one, because the
 * pyramid need not start at zero and Gen Con's does not. Then the extent at the
 * deepest level, by stepping out from a tile that exists until they stop.
 */
async function survey(floor) {
  // Every level, not up to the first gap: the pyramid need not start at zero,
  // and Gen Con's does not — its shallowest published level is well in.
  let deepest = null;
  for (let z = 0; z <= 10; z += 1) {
    const found = await probe(floor, z);
    if (found) deepest = { z, ...found };
  }
  if (!deepest) return null;

  const { z } = deepest;
  const box = { x0: deepest.x, x1: deepest.x, y0: deepest.y, y1: deepest.y };
  // One step at a time from the edge that is moving, not `edge + step * n` —
  // the edge has already moved by the time the next step is taken.
  const reach = async (axis, step) => {
    for (let n = 0; n < 256; n += 1) {
      const edge = axis === 'x'
        ? (step < 0 ? box.x0 : box.x1) + step
        : (step < 0 ? box.y0 : box.y1) + step;
      if (edge < 0) break;
      const x = axis === 'x' ? edge : deepest.x;
      const y = axis === 'y' ? edge : deepest.y;
      if (!(await fetchTile(floor, z, x, y))) break;
      if (axis === 'x') { if (step < 0) box.x0 = edge; else box.x1 = edge; }
      else if (step < 0) box.y0 = edge; else box.y1 = edge;
    }
  };
  // Along the row and column through the known tile. A pyramid is a rectangle,
  // and the fill below tolerates a hole anywhere in it.
  await reach('x', -1);
  await reach('x', 1);
  await reach('y', -1);
  await reach('y', 1);
  return { z, ...box };
}

/** Any tile at this zoom, or null. Small pyramids start at 0,0. */
async function probe(floor, z) {
  const span = 2 ** z;
  for (let x = 0; x < Math.min(span, 8); x += 1) {
    for (let y = 0; y < Math.min(span, 8); y += 1) {
      if (await fetchTile(floor, z, x, y)) return { x, y };
    }
  }
  return null;
}

async function stitch(floor, area) {
  const { z, x0, x1, y0, y1 } = area;
  const width = (x1 - x0 + 1) * TILE;
  const height = (y1 - y0 + 1) * TILE;
  const sheet = new Uint8Array(width * height * 4);

  const jobs = [];
  for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) jobs.push([x, y]);

  let done = 0;
  for (let at = 0; at < jobs.length; at += AT_ONCE) {
    const round = jobs.slice(at, at + AT_ONCE);
    const bodies = await Promise.all(round.map(([x, y]) => fetchTile(floor, z, x, y)));
    round.forEach(([x, y], i) => {
      done += 1;
      if (!bodies[i]) return;
      const tile = decodePng(bodies[i]);
      const left = (x - x0) * TILE;
      const top = (y - y0) * TILE;
      for (let row = 0; row < Math.min(TILE, tile.height); row += 1) {
        const from = row * tile.width * 4;
        const to = ((top + row) * width + left) * 4;
        sheet.set(tile.pixels.subarray(from, from + Math.min(TILE, tile.width) * 4), to);
      }
    });
    await wait(PAUSE);
  }

  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, `level-${floor}.png`);
  writeFileSync(path, encodePng(width, height, sheet));
  console.log(`  level ${floor}: ${width}x${height} from ${done} tiles at z${z} → ${path}`);
}

async function main() {
  const asked = process.argv.includes('--floors')
    ? process.argv[process.argv.indexOf('--floors') + 1].split(',')
    : FLOORS;

  for (const floor of asked) {
    let area;
    try {
      area = await survey(floor);
    } catch (error) {
      console.warn(`  level ${floor}: ${error.message}`);
      continue;
    }
    if (!area) {
      console.warn(`  level ${floor}: no tiles`);
      continue;
    }
    await stitch(floor, area);
  }
}

await main();
