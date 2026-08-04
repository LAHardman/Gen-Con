/**
 * Read the hallways out of Gen Con's plans of the hotels.
 *
 * The convention centre's corridors come free: its plans are vector PDFs whose
 * legend keys every space by colour, one of those colours is "Prefunction /
 * Hallways", and `plan-to-geometry.mjs` reads them out with the rooms. Nothing
 * else on the campus has a PDF. What there is instead is Gen Con's own plan of
 * each hotel, as a picture — and those are drawn to a palette just as strict,
 * so the same idea works from pixels: the pale cream is what you walk on, the
 * tan is a room you can book, the darker brown is back of house.
 *
 * Doing it this way rather than by eye matters. A corridor is three or four
 * metres wide and the room rectangles in `venues.ts` are good to about five, so
 * anything traced by hand would look precise and be wrong at exactly the scale
 * it is read at. Colour is not a judgement call, the fit below is measured
 * against the building's surveyed footprint, and both are repeatable.
 *
 *     node scripts/venue-plans.mjs            # all of them
 *     node scripts/venue-plans.mjs westin-2   # one, with its fit reported
 *
 * Writes src/data/venue-plan.ts.
 *
 * WHAT IS NOT HERE. The JW Marriott's own sheet for its 1st floor is the
 * hotel's drawing rather than Gen Con's and uses none of these colours; Lucas
 * Oil's plans letter nothing and shade everything alike. Neither yields to this
 * and neither is faked — those floors show rooms and no corridors, which is
 * what the source supports.
 */

import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { decodePng } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLANS = join(ROOT, 'plans/venues');
const OUT = join(ROOT, 'src/data/venue-plan.ts');

/**
 * Gen Con's palette, sampled off the plans themselves.
 *
 * `circulation` is the answer; the rest are here because the building is all of
 * them together, and the fit below needs to know where the building is.
 */
const PALETTE = {
  circulation: [0xe7, 0xe2, 0xc4],
  room: [0xcd, 0xc7, 0xa5],
  roomAlt: [0xd9, 0xd2, 0xac],
  back: [0xa6, 0x9e, 0x83],
  restroom: [0xf2, 0xe3, 0x4a],
};

/** How far a pixel may sit from a palette colour and still be it. */
const TOLERANCE = 10;

/** Metres per cell in the rasters the fit is scored on. */
const CELL = 1;

/** Below this a patch of cream is a doorway or a smear, not a hall. Square metres. */
const MIN_AREA = 25;

/** Simplification tolerance, in metres. A corridor is metres wide; this is centimetres. */
const SIMPLIFY = 0.6;

/* ------------------------------------------------------------------ images */

function classify(image) {
  const { width, height, pixels } = image;
  const kinds = Object.entries(PALETTE);
  const map = new Uint8Array(width * height); // 0 nothing, else index+1
  for (let at = 0; at < width * height; at += 1) {
    const r = pixels[at * 4];
    const g = pixels[at * 4 + 1];
    const b = pixels[at * 4 + 2];
    for (let k = 0; k < kinds.length; k += 1) {
      const [, [qr, qg, qb]] = kinds[k];
      if (Math.abs(r - qr) <= TOLERANCE && Math.abs(g - qg) <= TOLERANCE && Math.abs(b - qb) <= TOLERANCE) {
        map[at] = k + 1;
        break;
      }
    }
  }
  return { width, height, map, kinds: kinds.map(([name]) => name) };
}

/* ------------------------------------------------------------------- venue */

const METRES_PER_DEGREE_LAT = 111320;
const metresPerDegreeLng = (lat) => METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);

/** The venue's footprint as a mask over its anchor box, in metre cells. */
function footprintMask(venue) {
  const { anchor, footprint } = venue;
  const perLng = metresPerDegreeLng(anchor.nw.lat);
  const ring = footprint.map(([lat, lng]) => [
    (lng - anchor.nw.lng) * perLng,
    (anchor.nw.lat - lat) * METRES_PER_DEGREE_LAT,
  ]);
  const w = Math.ceil(anchor.widthMetres / CELL);
  const h = Math.ceil(anchor.heightMetres / CELL);
  const mask = new Uint8Array(w * h);
  let filled = 0;
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      const x = (i + 0.5) * CELL;
      const y = (j + 0.5) * CELL;
      let inside = false;
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a, a += 1) {
        const [ax, ay] = ring[a];
        const [bx, by] = ring[b];
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      }
      if (inside) {
        mask[j * w + i] = 1;
        filled += 1;
      }
    }
  }
  return { w, h, mask, filled };
}

/* --------------------------------------------------------------------- fit */

/**
 * Where the plan sits on the building.
 *
 * Gen Con draws its plans with south at the top — see the note in `venues.ts` —
 * so the whole transform is a half-turn, a uniform scale and an offset:
 *
 *     east  = east0  - scale * px
 *     south = south0 - scale * py
 *
 * measured in metres from the venue's north-west corner. Three unknowns, and
 * the thing they are fitted against is the building's own surveyed footprint:
 * the plan's coloured area *is* the building, so the right transform is the one
 * that lays one over the other. Scored as intersection over union, searched
 * coarsely and then refined, which is quick enough at these sizes and immune to
 * the local minima a gradient would fall into.
 */
function fit(plan, venue, report) {
  const target = footprintMask(venue);

  // Sample the plan's coloured pixels rather than all of them; the fit is over
  // areas, and a stride of three is a few tens of thousands of points.
  const points = [];
  const stride = 3;
  for (let py = 0; py < plan.height; py += stride) {
    for (let px = 0; px < plan.width; px += stride) {
      if (plan.map[py * plan.width + px]) points.push([px, py]);
    }
  }
  if (!points.length) return null;

  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const [px, py] of points) {
    if (px < box.x0) box.x0 = px;
    if (px > box.x1) box.x1 = px;
    if (py < box.y0) box.y0 = py;
    if (py > box.y1) box.y1 = py;
  }

  const score = (scale, east0, south0, sample = points) => {
    const seen = new Uint8Array(target.w * target.h);
    let both = 0;
    let mine = 0;
    for (const [px, py] of sample) {
      const i = Math.floor((east0 - scale * px) / CELL);
      const j = Math.floor((south0 - scale * py) / CELL);
      if (i < 0 || j < 0 || i >= target.w || j >= target.h) {
        mine += 1;
        continue;
      }
      const at = j * target.w + i;
      if (seen[at]) continue;
      seen[at] = 1;
      mine += 1;
      if (target.mask[at]) both += 1;
    }
    return both / (mine + target.filled - both);
  };

  // The plan's coloured area is the building, so its box and the footprint's
  // are the same object at two scales. That fixes the starting point; the
  // search then covers a wide range around it, because a plan can carry the
  // pavement outside the doors or crop the far end of a wing.
  const guess = Math.max(
    venue.anchor.widthMetres / (box.x1 - box.x0),
    venue.anchor.heightMetres / (box.y1 - box.y0),
  );

  // Sweep coarsely on a quarter of the points, then refine on all of them. The
  // sweep only has to land in the right basin; the refinement does the rest.
  const coarse = points.filter((_, i) => i % 4 === 0);
  const span = Math.max(venue.anchor.widthMetres, venue.anchor.heightMetres) * 0.35;

  let best = null;
  for (let k = 0.55; k <= 1.5; k += 0.05) {
    const scale = guess * k;
    // Align the boxes, then look either side of that by a good fraction of the
    // building — the plan's extent and the footprint's need not agree.
    const east0 = venue.anchor.widthMetres + scale * box.x0;
    const south0 = venue.anchor.heightMetres + scale * box.y0;
    for (let de = -span; de <= span; de += 6) {
      for (let ds = -span; ds <= span; ds += 6) {
        const value = score(scale, east0 + de, south0 + ds, coarse);
        if (!best || value > best.value) best = { value, scale, east0: east0 + de, south0: south0 + ds };
      }
    }
  }

  // Refine on every point, halving the step until it is well under a metre.
  best = { ...best, value: score(best.scale, best.east0, best.south0) };
  let step = 6;
  let scaleStep = guess * 0.05;
  for (let round = 0; round < 7; round += 1) {
    step /= 2;
    scaleStep /= 2;
    let moved = true;
    while (moved) {
      moved = false;
      for (const ds of [-scaleStep, 0, scaleStep]) {
        for (const de of [-step, 0, step]) {
          for (const dn of [-step, 0, step]) {
            if (!ds && !de && !dn) continue;
            const value = score(best.scale + ds, best.east0 + de, best.south0 + dn);
            if (value > best.value) {
              best = { value, scale: best.scale + ds, east0: best.east0 + de, south0: best.south0 + dn };
              moved = true;
            }
          }
        }
      }
    }
  }

  if (report) {
    console.log(`      fit: ${best.scale.toFixed(3)} m/px, overlap ${(best.value * 100).toFixed(0)}%`);
  }
  return best;
}

/* ------------------------------------------------------------------- trace */

/** Connected runs of one kind, four-connected, as lists of pixel indices. */
function components(plan, wanted) {
  const { width, height, map } = plan;
  const seen = new Uint8Array(width * height);
  const out = [];
  for (let start = 0; start < map.length; start += 1) {
    if (map[start] !== wanted || seen[start]) continue;
    const queue = [start];
    const piece = [];
    seen[start] = 1;
    while (queue.length) {
      const at = queue.pop();
      piece.push(at);
      const x = at % width;
      const y = (at - x) / width;
      const around = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of around) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (map[next] !== wanted || seen[next]) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    out.push(piece);
  }
  return out;
}

/**
 * The outer boundary of a set of pixels, as a ring of pixel corners.
 *
 * Marching the boundary of the filled cells rather than tracing their centres,
 * so the ring runs along the edge of the shape and not half a pixel inside it.
 */
function outline(piece, width, height) {
  const inside = new Set(piece);
  const filled = (x, y) => x >= 0 && y >= 0 && x < width && y < height && inside.has(y * width + x);

  // Every exposed side, anticlockwise, keyed by where it starts.
  const sides = new Map();
  const name = ([x, y]) => `${x},${y}`;
  const add = (from, to) => {
    const key = name(from);
    if (!sides.has(key)) sides.set(key, []);
    sides.get(key).push(to);
  };
  for (const at of piece) {
    const x = at % width;
    const y = (at - x) / width;
    if (!filled(x, y - 1)) add([x, y], [x + 1, y]);
    if (!filled(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
    if (!filled(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
    if (!filled(x - 1, y)) add([x, y + 1], [x, y]);
  }

  // Every loop, not just the outer one. A hotel's circulation is one connected
  // thing that runs round the ballroom, so its boundary has holes in it — and a
  // polygon drawn from the outside alone would paint straight over the rooms it
  // is supposed to lead to.
  const loops = [];
  while (sides.size) {
    const [start] = sides.keys();
    const ring = [];
    let at = start;
    while (sides.has(at)) {
      const next = sides.get(at).pop();
      if (!sides.get(at).length) sides.delete(at);
      ring.push(next);
      at = name(next);
    }
    if (ring.length >= 4) loops.push(ring);
  }
  const area = (ring) => {
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
    }
    return Math.abs(sum / 2);
  };
  // Outer boundary first, which is how a polygon with holes is written.
  return loops.sort((a, b) => area(b) - area(a));
}

/** Ramer–Douglas–Peucker, closed. */
function simplify(ring, tolerance) {
  const run = (points) => {
    if (points.length < 3) return points;
    const [ax, ay] = points[0];
    const [bx, by] = points[points.length - 1];
    const dx = bx - ax;
    const dy = by - ay;
    const span = Math.hypot(dx, dy);
    let worst = 0;
    let at = 0;
    for (let i = 1; i < points.length - 1; i += 1) {
      const [px, py] = points[i];
      const distance = span
        ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / span
        : Math.hypot(px - ax, py - ay);
      if (distance > worst) {
        worst = distance;
        at = i;
      }
    }
    if (worst <= tolerance) return [points[0], points[points.length - 1]];
    return [...run(points.slice(0, at + 1)).slice(0, -1), ...run(points.slice(at))];
  };
  return run([...ring, ring[0]]).slice(0, -1);
}

/* ------------------------------------------------------------------- build */

function convert(file, venue, level, report) {
  const image = decodePng(readFileSync(join(PLANS, file)));
  const plan = classify(image);
  const wanted = plan.kinds.indexOf('circulation') + 1;

  const frame = fit(plan, venue, report);
  if (!frame) return null;

  const perLng = metresPerDegreeLng(venue.anchor.nw.lat);
  const project = ([px, py]) => {
    const east = frame.east0 - frame.scale * px;
    const south = frame.south0 - frame.scale * py;
    return [
      Number((venue.anchor.nw.lat - south / METRES_PER_DEGREE_LAT).toFixed(6)),
      Number((venue.anchor.nw.lng + east / perLng).toFixed(6)),
    ];
  };

  const perPixel = frame.scale * frame.scale;
  const shapes = [];
  for (const piece of components(plan, wanted)) {
    if (piece.length * perPixel < MIN_AREA) continue;
    const loops = outline(piece, plan.width, plan.height);
    const rings = [];
    for (const loop of loops) {
      // A hole smaller than the shapes worth drawing is a column or a doorway.
      if (rings.length && loop.length * frame.scale < Math.sqrt(MIN_AREA) * 4) continue;
      const cut = simplify(loop, SIMPLIFY / frame.scale);
      if (cut.length >= 3) rings.push(cut.map(project));
    }
    if (rings.length) shapes.push(rings);
  }

  return { shapes, frame };
}

async function main() {
  const only = process.argv[2];
  const venues = await loadVenues();
  const sheets = readdirSync(PLANS).filter((name) => name.endsWith('.png')).sort();

  const out = new Map();
  for (const file of sheets) {
    const id = file.replace(/\.png$/, '');
    if (only && id !== only) continue;
    const sheet = SHEETS[id];
    if (!sheet) {
      console.warn(`  ${id}: not in SHEETS, skipped`);
      continue;
    }
    const venue = venues[sheet.venueId];
    if (!venue) {
      console.warn(`  ${id}: no venue ${sheet.venueId}, skipped`);
      continue;
    }
    const built = convert(file, venue, sheet.level, true);
    if (!built || !built.shapes.length) {
      console.warn(`  ${id}: nothing traced`);
      continue;
    }
    const holes = built.shapes.reduce((n, rings) => n + rings.length - 1, 0);
    console.log(`  ${id}: ${built.shapes.length} hall shape(s)${holes ? `, ${holes} hole(s)` : ''}`);
    out.set(`${sheet.venueId}/${sheet.level}`, built.shapes);
  }

  if (only) return;
  writeFileSync(OUT, render(out));
  const size = Math.round(readFileSync(OUT).length / 1024);
  const shapes = [...out.values()].reduce((n, list) => n + list.length, 0);
  console.log(`${OUT}: ${shapes} shapes over ${out.size} floors, ${size} KB`);
}

/**
 * Which sheet is which. The file name says it, but a floor is named differently
 * by every building and the map has to agree with `venues.ts` exactly.
 */
const SHEETS = {
  'crowne-plaza-1': { venueId: 'crowne-plaza', level: '1st floor' },
  'crowne-plaza-mezzanine': { venueId: 'crowne-plaza', level: 'Mezzanine' },
  'embassy-suites-5': { venueId: 'embassy-suites', level: '5th floor' },
  'hilton-2': { venueId: 'hilton', level: '2nd floor' },
  'hilton-9': { venueId: 'hilton', level: '9th floor' },
  'hyatt-2': { venueId: 'hyatt', level: '2nd floor' },
  'hyatt-3': { venueId: 'hyatt', level: '3rd floor' },
  'le-meridien-2': { venueId: 'le-meridien', level: '2nd floor' },
  'marriott-downtown-1': { venueId: 'marriott-downtown', level: '1st floor' },
  'marriott-downtown-2': { venueId: 'marriott-downtown', level: '2nd floor' },
  'omni-1': { venueId: 'omni', level: '1st floor' },
  'omni-2': { venueId: 'omni', level: '2nd floor' },
  'westin-1': { venueId: 'westin', level: '1st floor' },
  'westin-2': { venueId: 'westin', level: '2nd floor' },
};

/**
 * The venues, straight from `venues.ts`.
 *
 * Bundled and imported rather than parsed, so the anchor and footprint the fit
 * is measured against are the same values the app draws with, whatever shape
 * that file is in. Same trick as `check-geometry.mjs`.
 */
async function loadVenues() {
  const out = join(tmpdir(), `gen-con-venues-${process.pid}.mjs`);
  await build({
    entryPoints: [join(ROOT, 'src/data/venues.ts')],
    outfile: out,
    bundle: true,
    format: 'esm',
    logLevel: 'warning',
  });
  try {
    const module = await import(pathToFileURL(out).href);
    return Object.fromEntries(module.VENUES.map((venue) => [venue.id, venue]));
  } finally {
    await rm(out, { force: true });
  }
}

function render(out) {
  const lines = [];
  lines.push('/**');
  lines.push(' * Hallways in the hotels, read off Gen Con\'s plans. GENERATED — do not edit.');
  lines.push(' *');
  lines.push(' * Run `node scripts/venue-plans.mjs` to rebuild this. See that script for how a');
  lines.push(' * picture of a floor becomes map geometry, and for the two buildings it can\'t');
  lines.push(' * read.');
  lines.push(' *');
  lines.push(' * Source: Gen Con LLC.');
  lines.push(' */');
  lines.push('');
  lines.push("import type { PlanRing } from './plan-geometry';");
  lines.push('');
  lines.push('/**');
  lines.push(' * Prefunction space and corridors, by `venue/level`.');
  lines.push(' *');
  lines.push(' * Each shape is a polygon with holes: the first ring is its outside and the');
  lines.push(' * rest are the rooms it runs around, because a hotel\'s circulation is one');
  lines.push(' * connected thing and drawing only its outside would cover them over.');
  lines.push(' */');
  lines.push('export const VENUE_HALLS: Record<string, readonly (readonly PlanRing[])[]> = {');
  for (const [key, shapes] of [...out].sort()) {
    lines.push(`  '${key}': [`);
    for (const rings of shapes) {
      lines.push('    [');
      for (const ring of rings) {
        lines.push(`      [${ring.map(([lat, lng]) => `[${lat}, ${lng}]`).join(', ')}],`);
      }
      lines.push('    ],');
    }
    lines.push('  ],');
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

await main();
