/**
 * Work out where a venue's floor plans sit in the world.
 *
 * A plan is a scale drawing and Web Mercator is conformal over a city block, so
 * the only freedom is how big the drawing is and where its corner goes — one
 * scale and two offsets, three numbers rather than four. Letting the two axes
 * scale independently is what lets a fit go quietly wrong: it can squash the
 * drawing to cover a building it doesn't actually match, and nothing about the
 * result looks obviously broken until you notice the west wall is 40 m off.
 *
 * Every sheet of a building is fitted together, into one frame the whole venue
 * shares, because they are one drawing of one building issued floor by floor —
 * the convention centre's two put its walls at the same page coordinates to a
 * tenth of a point. Fitting them separately would let two floors of the same
 * room disagree about where that room is, by however much the search happened
 * to wander. Sharing the frame makes disagreement impossible rather than small.
 *
 * The frame is fitted against the building's OpenStreetMap footprint, clipped
 * first: the convention centre's OSM way also carries the thin skywalk arm
 * running south to Lucas Oil Stadium and no floor plan of the convention centre
 * draws that. Left in, it drags the fit south chasing area no plan can cover.
 *
 *     node scripts/fit-plan.mjs icc
 *     node scripts/fit-plan.mjs icc 39.7633    # a different clip line
 *
 * Prints the frame to paste into plans/georeference.json, and how well each
 * sheet then agrees with the mapped building.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const R = 6378137;
const mercX = (lng) => (R * lng * Math.PI) / 180;
const mercY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const unMercX = (x) => ((x / R) * 180) / Math.PI;
const unMercY = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);

/** The fills that mean "building" — see LEGEND in plan-to-geometry.mjs. */
const BUILDING = new Set(['#748ba8', '#a0b1c4', '#f6bebd', '#ee7d7d', '#b9c4d3']);

/**
 * Where the building stops and the arm begins, as a latitude.
 *
 * Only needed for a footprint that runs well past what its plans draw. Defaults
 * to the convention centre's; pass your own as the second argument.
 */
const DEFAULT_CLIP = 39.7633;

function inside(ring, x, y) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Every shape a plan draws for the building, in page points. */
function buildingShapes(planId, legend) {
  const svg = readFileSync(join(ROOT, 'plans', `${planId}.svg`), 'utf8');
  const out = [];

  for (const path of svg.matchAll(/<path ([^>]*?)\/>/g)) {
    const fill = (path[1].match(/fill="([^"]*)"/) ?? [])[1];
    if (!BUILDING.has(fill)) continue;

    const d = (path[1].match(/ d="([^"]*)"/) ?? [])[1] ?? '';
    for (const sub of d.split('M').slice(1)) {
      const points = [...sub.matchAll(/([-+]?[\d.]+) ([-+]?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
      if (points.length < 3) continue;
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      // The legend's swatches are drawn in the colours they stand for, so they
      // have to be excluded by where they are rather than by what they are.
      if (legend && box[0] >= legend[0] && box[1] >= legend[1]
          && box[2] <= legend[2] && box[3] <= legend[3]) continue;
      out.push(points);
    }
  }
  return out;
}

/** The footprint ring for a venue, straight out of the generated module. */
function footprint(venueId) {
  const source = readFileSync(join(ROOT, 'src/data/footprints.ts'), 'utf8');
  const at = source.indexOf(`  ${venueId}: [`);
  if (at < 0) throw new Error(`no footprint for ${venueId}`);
  const body = source.slice(at, source.indexOf('\n  ],', at));
  return [...body.matchAll(/\[([-\d.]+), ([-\d.]+)\]/g)].map((m) => [+m[1], +m[2]]);
}

/** A plan rasterised in its own page space, so scoring is a lookup. */
function rasterise(shapes, page, w = 1400, h = 1200) {
  const mask = new Uint8Array(w * h);
  const [x0, y0, x1, y1] = page;
  for (const ring of shapes) {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const i0 = Math.max(0, Math.floor(((Math.min(...xs) - x0) / (x1 - x0)) * w));
    const i1 = Math.min(w - 1, Math.ceil(((Math.max(...xs) - x0) / (x1 - x0)) * w));
    const j0 = Math.max(0, Math.floor(((Math.min(...ys) - y0) / (y1 - y0)) * h));
    const j1 = Math.min(h - 1, Math.ceil(((Math.max(...ys) - y0) / (y1 - y0)) * h));
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        if (mask[j * w + i]) continue;
        const x = x0 + ((i + 0.5) / w) * (x1 - x0);
        const y = y0 + ((j + 0.5) / h) * (y1 - y0);
        if (inside(ring, x, y)) mask[j * w + i] = 1;
      }
    }
  }
  return { mask, page, w, h };
}

function main() {
  const venueId = process.argv[2];
  if (!venueId) {
    console.error('usage: node scripts/fit-plan.mjs <venue-id> [clip-latitude]');
    process.exit(1);
  }
  const clip = Number(process.argv[3] ?? DEFAULT_CLIP);

  const manifest = JSON.parse(readFileSync(join(ROOT, 'plans/georeference.json'), 'utf8'));
  const venue = manifest[venueId];
  if (!venue) throw new Error(`${venueId} is not in plans/georeference.json`);

  const page = venue.frame.page;
  const plans = Object.entries(venue.plans).map(([planId, plan]) => ({
    planId,
    level: plan.level,
    raster: rasterise(buildingShapes(planId, plan.legend), page),
  }));

  const ring = footprint(venueId).map(([lat, lng]) => [mercX(lng), mercY(lat)]);

  // Sample the clipped footprint's neighbourhood on a fixed metric grid; every
  // candidate is then scored by looking each cell up in each plan's raster.
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const gx0 = Math.min(...xs) - 40;
  const gx1 = Math.max(...xs) + 40;
  const gy0 = mercY(clip);
  const gy1 = Math.max(...ys) + 40;
  const N = 260;
  const cells = [];
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      const x = gx0 + ((i + 0.5) / N) * (gx1 - gx0);
      const y = gy0 + ((j + 0.5) / N) * (gy1 - gy0);
      cells.push([x, y, inside(ring, x, y)]);
    }
  }
  const footCells = cells.filter((cell) => cell[2]).length;

  function iou({ mask, w, h }, x0, y0, s) {
    let both = 0;
    let spill = 0;
    for (const [x, y, isBuilding] of cells) {
      const px = (x - x0) / s;
      const py = (y - y0) / s;
      const i = (((px - page[0]) / (page[2] - page[0])) * w) | 0;
      const j = (((py - page[1]) / (page[3] - page[1])) * h) | 0;
      const drawn = i >= 0 && i < w && j >= 0 && j < h && mask[j * w + i];
      if (drawn && isBuilding) both += 1;
      else if (drawn) spill += 1;
    }
    return both / (footCells + spill);
  }

  // One frame for the whole venue, so every sheet gets the same answer. Scored
  // as the mean over sheets: a floor that draws less of the building than the
  // others still gets an equal say in where the building is.
  const score = (x0, y0, s) =>
    plans.reduce((sum, plan) => sum + iou(plan.raster, x0, y0, s), 0) / plans.length;

  const [px0, py0, px1, py1] = page;
  const s0 = (mercX(venue.frame.bounds.east) - mercX(venue.frame.bounds.west)) / (px1 - px0);
  let best = {
    s: s0,
    x0: mercX(venue.frame.bounds.west) - px0 * s0,
    y0: mercY(venue.frame.bounds.south) - py0 * s0,
  };
  best.score = score(best.x0, best.y0, best.s);
  console.log(`current: ${best.s.toFixed(4)} m/pt, mean IoU ${best.score.toFixed(4)}`);

  let stepXY = 40;
  let stepS = 0.05;
  for (let round = 0; round < 9; round += 1) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [dx, dy, ds] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const x0 = best.x0 + dx * stepXY;
        const y0 = best.y0 + dy * stepXY;
        const s = best.s * (1 + ds * stepS);
        const value = score(x0, y0, s);
        if (value > best.score + 1e-6) {
          best = { x0, y0, s, score: value };
          improved = true;
        }
      }
    }
    stepXY /= 2;
    stepS /= 2;
  }

  console.log(`fitted:  ${best.s.toFixed(4)} m/pt, mean IoU ${best.score.toFixed(4)}`);
  for (const plan of plans) {
    console.log(`  ${plan.planId.padEnd(14)} IoU ${iou(plan.raster, best.x0, best.y0, best.s).toFixed(4)}`);
  }
  console.log(JSON.stringify({
    page,
    bounds: {
      west: +unMercX(best.x0 + best.s * px0).toFixed(7),
      south: +unMercY(best.y0 + best.s * py0).toFixed(7),
      east: +unMercX(best.x0 + best.s * px1).toFixed(7),
      north: +unMercY(best.y0 + best.s * py1).toFixed(7),
    },
  }, null, 2));
}

main();
