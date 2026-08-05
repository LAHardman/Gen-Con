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
 *     node scripts/gencon-tiles.mjs --zoom 5        # this level, whatever it costs
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
 * Note that this is *not* a slippy map: it is a small pyramid in the
 * `CRS.Simple` style Gen Con's own Leaflet map uses, starting around z2, so a
 * URL built from Web Mercator coordinates asks for something that was never
 * there. An absent object on that bucket answers 403 rather than 404, which
 * makes a wrong guess look exactly like a refusal.
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

/**
 * The campus levels Gen Con's own switcher offers, bottom to top.
 *
 * The basement is written more than one way by different people; each name
 * here is tried in turn and the first that has tiles wins.
 */
const FLOORS = [['B', 'b', '0'], ['1'], ['2'], ['3'], ['4']];

/** At once, and how long to wait between rounds. Their CDN, their rules. */
const AT_ONCE = 4;
const PAUSE = 120;

/**
 * The most tiles one level may cost, and why there is a limit at all.
 *
 * The pyramid is a plain power of two — z3 is 8x8, z5 is 32x32, z7 is 128x128 —
 * and it goes deeper than anything here can use. Taking the deepest level is
 * both rude and useless: z7 is sixteen thousand requests for one floor, and it
 * stitches to 32768x32768, which is four gigabytes of pixels before anything
 * reads them.
 *
 * What the reading actually needs is a building big enough on the sheet to tell
 * a hatched escalator from a wall. Gen Con's own screenshots of single hotels
 * are around 1500 pixels across and are legible at that; z5 puts the whole
 * campus in 8192 and the convention centre in a couple of thousand, which is
 * the same grade. So: the deepest level that stays inside this budget, which is
 * z5, and a flag for anyone who wants otherwise.
 */
const MAX_TILES = 1200;

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
  //
  // `deepest` is the deepest level worth taking rather than the deepest that
  // exists: a level costs (2^z)^2 tiles, and past MAX_TILES that is a great
  // many requests for detail nothing here reads. WANTED overrides it.
  let deepest = null;
  for (let z = 0; z <= 10; z += 1) {
    if (WANTED !== null && z !== WANTED) continue;
    if (WANTED === null && 4 ** z > MAX_TILES) {
      console.log(`  level ${floor}: stopping at z${deepest?.z ?? '?'}; z${z} would be ${4 ** z} tiles`);
      break;
    }
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
      let tile;
      try {
        tile = decodePng(bodies[i]);
      } catch (error) {
        // One unreadable square is a hole in the sheet, not a reason to throw
        // away the other few hundred.
        console.warn(`    ${z}/${x}/${y}: ${error.message}`);
        return;
      }
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

/** `--zoom N` takes that level whatever it costs; otherwise MAX_TILES decides. */
const WANTED = process.argv.includes('--zoom')
  ? Number(process.argv[process.argv.indexOf('--zoom') + 1])
  : null;

async function main() {
  const asked = process.argv.includes('--floors')
    ? process.argv[process.argv.indexOf('--floors') + 1].split(',').map((name) => [name])
    : FLOORS;

  for (const names of asked) {
    let found = null;
    for (const name of names) {
      try {
        const area = await survey(name);
        if (area) { found = { name, area }; break; }
      } catch (error) {
        console.warn(`  level ${name}: ${error.message}`);
      }
    }
    if (!found) {
      console.warn(`  level ${names[0]}: no tiles`);
      continue;
    }
    await stitch(found.name, found.area);
  }
}

await main();
