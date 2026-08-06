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
 *     node scripts/venue-plans.mjs --campus   # include Gen Con's campus sheets
 *                                             # (see everySheet: not yet placeable)
 *
 * It also does the reverse of the same trick: the plan colours the *rooms* too,
 * so where it can be told which drawn room is which authored one, that room
 * gives up its rectangle for the outline the plan draws. See `snap`.
 *
 * Writes src/data/venue-plan.ts.
 *
 * WHAT IS NOT HERE is whatever there is no sheet for — several upper floors,
 * and the stadium. Nothing is invented to fill a gap: a floor with no sheet
 * shows its rooms and no corridors, which is what its source supports.
 *
 * The sheets themselves need not be tidy. Several are phone screenshots of
 * Gen Con's own online map, statusbar and all, and the classifier does not
 * care: the palette is the palette, and everything that isn't one of these
 * five colours — street, park, browser chrome — never enters the fit. What a
 * sheet does have to do is frame the whole building, because the fit is against
 * the whole footprint. A screenshot of half a floor cannot be placed.
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
const CAMPUS = join(ROOT, 'plans/campus');
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

/**
 * Vertical circulation, which is drawn rather than coloured.
 *
 * An escalator or stair is a hatched grey block — Gen Con letters the big ones
 * UP TO 2ND FLOOR — and hatching is not one flat colour, so it cannot go in the
 * palette above. What it is instead is grey, in a band no other *interior*
 * surface occupies: the halls are cream and tan, the back of house is brown,
 * the restroom pictograms are white on tan.
 *
 * The streets are grey too, and much bigger, which is what the footprint test
 * in `verticals` is for: outside the building nothing here is read at all. The
 * one indoor grey that is not a stair is the odd printed rule, and the area
 * floor below drops those.
 */
const GREY_SPREAD = 8;
const GREY_MIN = 0x55;
const GREY_MAX = 0xa8;

/** An escalator pair is a few metres each way. Square metres. */
const MIN_VERTICAL = 4;
const MAX_VERTICAL = 160;

/** Metres per cell in the rasters the fit is scored on. */
const CELL = 1;

/** Below this a patch of cream is a doorway or a smear, not a hall. Square metres. */
const MIN_AREA = 25;

/** And below this a patch of tan is a cupboard, not a room anyone books. */
const MIN_ROOM = 12;

/** Simplification tolerance, in metres. A corridor is metres wide; this is centimetres. */
const SIMPLIFY = 0.6;

/* ------------------------------------------------------------------ images */

function classify(image) {
  const { width, height, pixels } = image;
  const kinds = Object.entries(PALETTE);
  const map = new Uint8Array(width * height); // 0 nothing, else index+1
  // The hatched greys go in a map of their own rather than into `map`.
  //
  // Everything downstream reads `map` as "the building": the fit takes every
  // non-zero pixel as a point of it, and the streets on a sheet are grey too.
  // Folding grey into the same map moved the fit on every hotel — the halls
  // came out in slightly different places for no better reason. So this stays
  // beside it, read only by `verticals`.
  const grey = new Uint8Array(width * height);
  for (let at = 0; at < width * height; at += 1) {
    const r = pixels[at * 4];
    const g = pixels[at * 4 + 1];
    const b = pixels[at * 4 + 2];
    let hit = 0;
    for (let k = 0; k < kinds.length; k += 1) {
      const [, [qr, qg, qb]] = kinds[k];
      if (Math.abs(r - qr) <= TOLERANCE && Math.abs(g - qg) <= TOLERANCE && Math.abs(b - qb) <= TOLERANCE) {
        hit = k + 1;
        break;
      }
    }
    map[at] = hit;
    if (!hit) {
      const high = Math.max(r, g, b);
      const low = Math.min(r, g, b);
      if (high - low <= GREY_SPREAD && high >= GREY_MIN && high <= GREY_MAX) grey[at] = 1;
    }
  }
  return { width, height, map, grey, kinds: kinds.map(([name]) => name) };
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
function fit(plan, venue, report, hint = null) {
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
  // On a sheet of one building the coloured area *is* that building, so its box
  // and the footprint's are the same object at two scales and that fixes the
  // starting point. On a campus sheet they are not the same object at all — the
  // colour covers a mile of downtown — and the same arithmetic guesses a scale
  // several times too fine, from which no sweep this wide can recover. Such a
  // sheet says what it is instead; see CAMPUS_SHEETS.
  const guess = hint ?? Math.max(
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

/** Connected runs of the wanted kinds, four-connected, as lists of pixel indices. */
function components(plan, wanted) {
  const { width, height, map } = plan;
  const want = (at) => wanted.has(map[at]);
  const seen = new Uint8Array(width * height);
  const out = [];
  for (let start = 0; start < map.length; start += 1) {
    if (!want(start) || seen[start]) continue;
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
        if (!want(next) || seen[next]) continue;
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

function convert(path, venue, level, rooms, report, sheet = {}) {
  const image = decodePng(readFileSync(path));
  const plan = classify(image);
  const kind = (name) => plan.kinds.indexOf(name) + 1;

  const perLng = metresPerDegreeLng(venue.anchor.nw.lat);

  // A georeferenced sheet needs no fitting: it already knows where it is, and
  // the frame is just that knowledge written in the venue's own terms.
  const frame = sheet.geo
    ? {
      scale: sheet.geo.scale,
      east0: (sheet.geo.lng0 - venue.anchor.nw.lng) * perLng,
      south0: (venue.anchor.nw.lat - sheet.geo.lat0) * METRES_PER_DEGREE_LAT,
      value: null,
    }
    : fit(plan, venue, report, null);
  if (!frame) return null;
  if (sheet.geo && report) console.log(`      georeferenced: ${frame.scale} m/px`);
  /*
   * A campus sheet is a mile of downtown, so everything below has to be told
   * which building it is looking at.
   *
   * `trace` walks the whole classified image, and on a sheet of one hotel that
   * is right — the sheet *is* the hotel. On a campus sheet it hands back every
   * cream corridor from Georgia Street to the stadium: the JW's 2nd floor came
   * out as eighteen shapes spanning 1138 by 858 metres and 22,419 m² of
   * "hotel", which is nine times the building. The rooms went the same way,
   * with 752 m² of Rooms 201–205 landing outside the JW.
   *
   * So the classified map is cut to the venue's surveyed outline first, before
   * anything is traced from it. Cutting the pixels rather than filtering the
   * finished shapes is what matters: a corridor that runs from one building
   * into the next is one component either way, and only a cut divides it.
   *
   * `plan.grey` is deliberately left whole. `verticals` reads that, and its
   * size test — a stair is small, a street is not — depends on the streets
   * staying the size they are. Clipping them to the footprint would leave
   * fragments the right size to be mistaken for an escalator.
   */
  if (sheet.geo) clipToVenue(plan, frame, venue, perLng, report);

  const project = ([px, py]) => {
    const east = frame.east0 - frame.scale * px;
    const south = frame.south0 - frame.scale * py;
    return [
      Number((venue.anchor.nw.lat - south / METRES_PER_DEGREE_LAT).toFixed(6)),
      Number((venue.anchor.nw.lng + east / perLng).toFixed(6)),
    ];
  };

  const perPixel = frame.scale * frame.scale;
  const trace = (wanted, minArea) => {
    const out = [];
    for (const piece of components(plan, wanted)) {
      if (piece.length * perPixel < minArea) continue;
      const loops = outline(piece, plan.width, plan.height);
      const rings = [];
      for (const loop of loops) {
        // A hole smaller than the shapes worth drawing is a column or a doorway.
        if (rings.length && loop.length * frame.scale < Math.sqrt(minArea) * 4) continue;
        const cut = simplify(loop, SIMPLIFY / frame.scale);
        if (cut.length >= 3) rings.push(cut);
      }
      if (rings.length) out.push({ piece, rings });
    }
    return out;
  };

  const found = verticals(plan, perPixel, project, venue);

  /*
   * A campus sheet is read for its stairs and nothing else.
   *
   * The convention centre's corridors already come from its architect's PDFs —
   * vector, keyed by a printed legend, and the best geometry in this
   * repository. Reading them again off a raster of Gen Con's rendering would
   * replace a measurement with a worse measurement, and `walkable.ts` prefers
   * VENUE_HALLS to the PDF detail, so it would silently win. Vertical
   * circulation is the one thing the PDFs do not have.
   */
  if (sheet.verticalsOnly) return { halls: [], verticals: found, snapped: [] };

  const halls = trace(new Set([kind('circulation')]), MIN_AREA)
    .map(({ rings }) => rings.map((ring) => ring.map(project)));

  return {
    halls,
    verticals: found,
    snapped: snap(plan, frame, trace, rooms, venue, project, report),
  };
}

/**
 * Where the drawing puts a staircase, escalator or lift.
 *
 * Everything else here traces an outline; this only wants a position, because
 * that is all a route needs — the point at which one floor becomes another.
 * So a component is kept if it is the right size to be one and it lands inside
 * the building, and reported as its middle.
 *
 * The footprint test is doing the real work. Grey is also what the streets and
 * the railway are drawn in, and on a campus sheet there is far more street than
 * building; inside the walls the only greys are these.
 */
/**
 * Blank every classified pixel outside the venue's own footprint.
 *
 * Only the bounding box is walked point-in-polygon; everything beyond it is
 * cleared wholesale, which on an 8192-square sheet is the difference between
 * a hundred thousand tests and sixty-seven million.
 */
function clipToVenue(plan, frame, venue, perLng, report) {
  const inside = within(venue.footprint);
  const toPixel = ([lat, lng]) => [
    (frame.east0 - (lng - venue.anchor.nw.lng) * perLng) / frame.scale,
    (frame.south0 - (venue.anchor.nw.lat - lat) * METRES_PER_DEGREE_LAT) / frame.scale,
  ];

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const corner of venue.footprint) {
    const [px, py] = toPixel(corner);
    x0 = Math.min(x0, px);
    x1 = Math.max(x1, px);
    y0 = Math.min(y0, py);
    y1 = Math.max(y1, py);
  }
  x0 = Math.max(0, Math.floor(x0));
  y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(plan.width - 1, Math.ceil(x1));
  y1 = Math.min(plan.height - 1, Math.ceil(y1));

  let kept = 0;
  for (let y = 0; y < plan.height; y += 1) {
    const row = y * plan.width;
    if (y < y0 || y > y1) {
      plan.map.fill(0, row, row + plan.width);
      continue;
    }
    plan.map.fill(0, row, row + x0);
    plan.map.fill(0, row + x1 + 1, row + plan.width);
    for (let x = x0; x <= x1; x += 1) {
      if (!plan.map[row + x]) continue;
      // The pixel's centre, since a pixel is a square and its corner can fall
      // the other side of a wall from the rest of it.
      if (inside(unproject(frame, venue, perLng, x + 0.5, y + 0.5))) kept += 1;
      else plan.map[row + x] = 0;
    }
  }
  if (report) console.log(`      clipped to ${venue.id}: ${kept} pixels inside its footprint`);
}

function unproject(frame, venue, perLng, px, py) {
  return [
    venue.anchor.nw.lat - (frame.south0 - frame.scale * py) / METRES_PER_DEGREE_LAT,
    venue.anchor.nw.lng + (frame.east0 - frame.scale * px) / perLng,
  ];
}

/** Is this [lat, lng] within the building's surveyed outline? Even-odd. */
function within(footprint) {
  const ring = footprint.map(([lat, lng]) => [lng, lat]);
  return ([lat, lng]) => {
    let odd = false;
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a, a += 1) {
      const [ax, ay] = ring[a];
      const [bx, by] = ring[b];
      if (ay > lat !== by > lat && lng < ((bx - ax) * (lat - ay)) / (by - ay) + ax) odd = !odd;
    }
    return odd;
  };
}

function verticals(plan, perPixel, project, venue) {
  const { anchor, footprint } = venue;
  const perLng = metresPerDegreeLng(anchor.nw.lat);
  const inside = within(footprint);

  const found = [];
  // Over the grey map rather than the classified one; `components` walks
  // whichever it is handed.
  for (const piece of components({ ...plan, map: plan.grey }, new Set([1]))) {
    const area = piece.length * perPixel;
    if (area < MIN_VERTICAL || area > MAX_VERTICAL) continue;
    let x = 0;
    let y = 0;
    for (const at of piece) {
      x += at % plan.width;
      y += Math.floor(at / plan.width);
    }
    const middle = project([x / piece.length, y / piece.length]);
    if (!inside(middle)) continue;
    found.push({ at: middle, squareMetres: Number(area.toFixed(1)) });
  }
  // Nearest the middle of the building first, which is where the main ones are.
  const centre = [anchor.nw.lat - anchor.heightMetres / 2 / METRES_PER_DEGREE_LAT,
    anchor.nw.lng + anchor.widthMetres / 2 / perLng];
  found.sort((a, b) => Math.hypot(a.at[0] - centre[0], a.at[1] - centre[1])
    - Math.hypot(b.at[0] - centre[0], b.at[1] - centre[1]));
  return found;
}

/**
 * Each room's rectangle replaced by the shape the plan draws for it.
 *
 * The rectangles were read off these same plans by eye and are good to about
 * five metres, which is wider than the corridors now drawn beside them — so
 * where a rectangle and the drawing disagree, the drawing wins. The plan colours
 * a bookable room, so the shape is already there; all that is needed is to say
 * which drawn room is which authored one, and the rectangle answers that: it is
 * roughly right, which is enough to point at the blob underneath it.
 *
 * Only where the answer is unambiguous, and only where the answer is an
 * improvement. A ballroom the plan draws as one space with three authored
 * sections in it stays three rectangles, because one outline shared three ways
 * would be three rooms the map could no longer tell apart. And a traced shape
 * is taken only if it lands inside the building and clear of its neighbours —
 * the plan and OpenStreetMap are two tracings of one building and they disagree
 * at the edges, so a shape that reads better against the drawing can still read
 * worse against everything else the map draws. Where it does, the rectangle
 * stays: swapping one kind of wrongness for another is not progress.
 */
const CLAIMED = 0.35;
const AMBIGUOUS = 0.55;
/** Slack in the two comparisons below: a wall's thickness, in square metres. */
const TOUCHING = 2;

function snap(plan, frame, trace, rooms, venue, project, report) {
  const drawn = trace(new Set([plan.kinds.indexOf('room') + 1, plan.kinds.indexOf('roomAlt') + 1]), MIN_ROOM);
  if (!drawn.length || !rooms.length) return [];

  // Each drawn room as the set of metre cells it covers, so overlap with a
  // rectangle is a count rather than a polygon intersection.
  const cells = drawn.map(({ piece }) => {
    const set = new Set();
    for (const at of piece) {
      const px = at % plan.width;
      const py = (at - px) / plan.width;
      const east = frame.east0 - frame.scale * px;
      const south = frame.south0 - frame.scale * py;
      set.add(`${Math.floor(east)},${Math.floor(south)}`);
    }
    return set;
  });

  const wide = venue.anchor.widthMetres / venue.grid.width;
  const tall = venue.anchor.heightMetres / venue.grid.height;

  /** A room's hand-placed rectangle as the same metre cells. */
  const rect = (room) => {
    const east0 = (room.rect.x - venue.grid.x) * wide;
    const south0 = (room.rect.y - venue.grid.y) * tall;
    const set = new Set();
    for (let e = 0; e < room.rect.width * wide; e += 1) {
      for (let s = 0; s < room.rect.height * tall; s += 1) {
        set.add(`${Math.floor(east0 + e)},${Math.floor(south0 + s)}`);
      }
    }
    return set;
  };

  const wants = new Map();
  for (const room of rooms) {
    const mine = rect(room);
    const scores = cells.map((set) => {
      let both = 0;
      for (const key of mine) if (set.has(key)) both += 1;
      return both / mine.size;
    });

      const order = scores.map((value, at) => ({ value, at })).sort((a, b) => b.value - a.value);
    if (!order.length || order[0].value < CLAIMED) continue;
    if (order[1] && order[1].value > order[0].value * AMBIGUOUS) continue;
    if (!wants.has(order[0].at)) wants.set(order[0].at, []);
    wants.get(order[0].at).push({ room, value: order[0].value });
  }

  // The building, so a traced shape can be checked against it before it is
  // believed, and every room's cells as the map has them now.
  const target = footprintMask(venue);
  const inBuilding = (key) => {
    const [east, south] = key.split(',').map(Number);
    const i = Math.floor(east / CELL);
    const j = Math.floor(south / CELL);
    return i >= 0 && j >= 0 && i < target.w && j < target.h && target.mask[j * target.w + i] === 1;
  };
  const current = new Map(rooms.map((room) => [room.id, rect(room)]));

  const candidates = [];
  for (const [at, claimants] of wants) {
    // One drawn room, several authored: an airwalled ballroom. Leave them be.
    if (claimants.length !== 1) continue;
    candidates.push({ at, room: claimants[0].room, value: claimants[0].value });
  }
  candidates.sort((a, b) => b.value - a.value);

  // The test is not whether the traced shape is perfect but whether it is
  // better than the rectangle it would replace, on the two things that can go
  // visibly wrong: leaving the building, and landing on the room next door.
  const spill = (shape) => {
    let out = 0;
    for (const key of shape) if (!inBuilding(key)) out += 1;
    return out * CELL * CELL;
  };
  const clash = (shape, mine) => {
    let worst = { area: 0, id: null };
    for (const other of rooms) {
      if (other.id === mine) continue;
      let both = 0;
      for (const key of shape) if (current.get(other.id).has(key)) both += 1;
      const area = both * CELL * CELL;
      if (area > worst.area) worst = { area, id: other.id };
    }
    return worst;
  };

  const out = [];
  const refused = [];
  for (const { at, room } of candidates) {
    const shape = cells[at];
    const was = current.get(room.id);

    // No slack at all on leaving the building: the footprint is surveyed, the
    // check in `check-geometry.mjs` treats any spill as a finding, and a shape
    // that pokes through a wall is the one thing worse than a rough rectangle.
    const spilt = spill(shape);
    if (spilt > spill(was)) {
      refused.push(`${room.id} — ${Math.round(spilt)} m2 of it outside the building, worse than its rectangle`);
      continue;
    }
    const hit = clash(shape, room.id);
    if (hit.area > clash(was, room.id).area + TOUCHING) {
      refused.push(`${room.id} — would sit ${Math.round(hit.area)} m2 on ${hit.id}`);
      continue;
    }

    current.set(room.id, shape);
    out.push({ roomId: room.id, rings: drawn[at].rings.map((ring) => ring.map(project)) });
  }

  if (report) {
    console.log(`      rooms: ${out.length} of ${rooms.length} snapped to the drawing`);
    for (const why of refused) console.log(`        kept its rectangle: ${why}`);
  }
  return out;
}

/**
 * Every sheet to read, from both places they come from.
 *
 * A hotel sheet is one building, so it names one. A campus sheet from Gen Con's
 * tile pyramid is every building at once — the fit solves for scale and offset
 * against one building's own footprint, so the same sheet is simply read once
 * per building it is asked for, each time finding a different part of it.
 */
function everySheet() {
  const list = [];
  const add = (dir, file, targets) => {
    const id = file.replace(/\.png$/, '');
    for (const target of targets) list.push({ id, path: join(dir, file), ...target });
  };
  for (const file of readdirSync(PLANS).filter((n) => n.endsWith('.png')).sort()) {
    const sheet = SHEETS[file.replace(/\.png$/, '')];
    if (sheet) add(PLANS, file, [sheet]);
    else console.warn(`  ${file}: not in SHEETS, skipped`);
  }
  /*
   * Campus sheets are read whenever they are there, and their absence is said
   * out loud.
   *
   * They are not committed — they are Gen Con's drawings and eighteen megabytes
   * of them — so a fresh clone has none, and a rebuild without them writes a
   * `venue-plan.ts` missing the convention centre's stairs and six whole
   * floors: the JW's 2nd and 3rd, the Hyatt's, Hilton's and Le Meridien's 1st,
   * and the Embassy's 2nd. That file looks perfectly healthy; the only signs
   * are a building that stops changing floors and hotels that cannot be routed
   * into. Hence the warning rather than a silent skip, and the named list in
   * `venue-plan.test.ts` rather than a count.
   */
  let campus = [];
  try {
    campus = readdirSync(CAMPUS).filter((n) => n.endsWith('.png')).sort();
  } catch {
    campus = [];
  }
  if (!campus.length) {
    console.warn('  no plans/campus — run `npm run plans:campus` first, or the');
    console.warn("  convention centre's stairs and six whole floors of hotels");
    console.warn('  will be missing from the output');
  }
  for (const file of campus) {
    const targets = CAMPUS_SHEETS[file.replace(/\.png$/, '')];
    if (targets) add(CAMPUS, file, targets);
    else console.warn(`  campus/${file}: not in CAMPUS_SHEETS, skipped`);
  }
  return list;
}

async function main() {
  // The first thing that isn't a flag, so `--campus westin-2` reads the same
  // as `westin-2 --campus`.
  const only = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  const { venues, rooms, hasPlanShape } = await loadVenues();

  const halls = new Map();
  const snapped = new Map();
  const lifts = new Map();
  for (const sheet of everySheet()) {
    const id = `${sheet.id}:${sheet.venueId}`;
    if (only && sheet.id !== only && id !== only) continue;
    const venue = venues[sheet.venueId];
    if (!venue) {
      console.warn(`  ${id}: no venue ${sheet.venueId}, skipped`);
      continue;
    }

    // Only rooms the floor plans don't already outline, and only ones drawn as
    // a rectangle — a room that is its whole venue has nothing to snap to.
    const floor = rooms.filter((room) => room.venueId === sheet.venueId
      && room.level === sheet.level
      && !room.fillsVenue
      && !hasPlanShape(room));

    const built = convert(sheet.path, venue, sheet.level, floor, true, sheet);
    if (!built) {
      console.warn(`  ${id}: nothing traced`);
      continue;
    }
    const holes = built.halls.reduce((n, rings) => n + rings.length - 1, 0);
    console.log(`  ${id}: ${built.halls.length} hall shape(s)${holes ? `, ${holes} hole(s)` : ''}`
      + `, ${built.verticals.length} stair/lift`);
    // A building with its own sheet keeps what that gave: it is a drawing of
    // one building rather than a thirty-second of a campus.
    const key = `${sheet.venueId}/${sheet.level}`;
    if (built.halls.length && !halls.has(key)) halls.set(key, built.halls);
    if (built.verticals.length && !lifts.has(key)) lifts.set(key, built.verticals);
    for (const room of built.snapped) if (!snapped.has(room.roomId)) snapped.set(room.roomId, room.rings);
  }

  if (only) return;
  writeFileSync(OUT, render(halls, snapped, lifts));
  const size = Math.round(readFileSync(OUT).length / 1024);
  const shapes = [...halls.values()].reduce((n, list) => n + list.length, 0);
  const marks = [...lifts.values()].reduce((n, list) => n + list.length, 0);
  console.log(`${OUT}: ${shapes} halls over ${halls.size} floors, ${snapped.size} rooms snapped, `
    + `${marks} stairs/lifts over ${lifts.size} floors, ${size} KB`);
}

/**
 * Where a campus sheet sits in the world.
 *
 * These are not fitted, they are georeferenced, and the difference is the
 * difference between guessing and knowing. `fit` places a plan by taking its
 * coloured area to *be* the building and aligning that box with the venue's,
 * which is right for a screenshot of one hotel and hopeless for a sheet of a
 * mile of downtown — the convention centre came out at 32% overlap that way.
 *
 * A pyramid level is a single rigid drawing: one scale, one offset, south at
 * the top, the same for every building on it. So three numbers place all of
 * them at once, and they were found by starting from two landmarks read off
 * the sheet by eye — Monument Circle and Lucas Oil's bowl — and then refining
 * against all fourteen surveyed footprints together, which is a far better
 * measurement than either landmark.
 *
 * The result covers 76% of the surveyed footprints, and the two biggest
 * buildings, which are the ones with the geometry to be sure about, sit at
 * 94%: the convention centre and Lucas Oil. Of the rest, the ones that score
 * badly are the ones Gen Con does not colour as its own venues — Circle
 * Centre, the Indiana Rep, the escape room.
 *
 * This is for the z5 sheet `plans:campus` writes. A different zoom is a
 * different number of pixels for the same ground, so `scale` would need
 * halving or doubling with it.
 */
const CAMPUS_GEO = { scale: 0.155266, lat0: 39.758405, lng0: -86.154774 };

/**
 * Which of Gen Con's campus levels holds which building's floor.
 *
 * Gen Con numbers the *event levels of the campus* rather than the floors of
 * any one building, so its level 3 is the JW's 3rd, the Hyatt's 3rd, the
 * Embassy's 5th and the Hilton's 9th at once. The convention centre is the
 * simple case and the reason these are fetched: it is only on levels 1 and 2,
 * and those are its own Level 1 and Level 2.
 */
const CAMPUS_SHEETS = {
  'level-1': [
    { venueId: 'icc', level: 'Level 1', geo: CAMPUS_GEO, verticalsOnly: true },
    // The Hyatt's atrium lobby, with three escalators lettered UP TO 2ND FLOOR.
    { venueId: 'hyatt', level: '1st floor', geo: CAMPUS_GEO },
    // The Hilton's lobby, running east from Market Street.
    { venueId: 'hilton', level: '1st floor', geo: CAMPUS_GEO },
    { venueId: 'le-meridien', level: '1st floor', geo: CAMPUS_GEO },
  ],
  'level-2': [
    { venueId: 'icc', level: 'Level 2', geo: CAMPUS_GEO, verticalsOnly: true },
    // Griffin Hall, rooms 201 to 209, the corridor down the west side and the
    // stair lettered DOWN TO 1ST FLOOR. The hotel screenshot in
    // `plans/venues/` covers only the JW's 1st, so this is the only source
    // there is for its 2nd.
    { venueId: 'jw-marriott', level: '2nd floor', geo: CAMPUS_GEO },
    // Lettered STREET LEVEL ENTRANCE (2ND FLOOR), which is why the Embassy's
    // way out is upstairs: its lobby, registration and lifts are all here.
    { venueId: 'embassy-suites', level: '2nd floor', geo: CAMPUS_GEO },
  ],
  // The JW's Grand Ballroom, rooms 300 to 314, and DOWN TO 2ND FLOOR.
  'level-3': [{ venueId: 'jw-marriott', level: '3rd floor', geo: CAMPUS_GEO }],
};

/**
 * Which sheet is which. The file name says it, but a floor is named differently
 * by every building and the map has to agree with `venues.ts` exactly.
 */
const SHEETS = {
  'crowne-plaza-1': { venueId: 'crowne-plaza', level: '1st floor' },
  'crowne-plaza-mezzanine': { venueId: 'crowne-plaza', level: 'Mezzanine' },
  'embassy-suites-5': { venueId: 'embassy-suites', level: '5th floor' },
  'hilton-2': { venueId: 'hilton', level: '2nd floor' },
  'jw-marriott-1': { venueId: 'jw-marriott', level: '1st floor' },
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
    return {
      venues: Object.fromEntries(module.VENUES.map((venue) => [venue.id, venue])),
      rooms: module.ROOMS,
      // A room the convention centre's plans already letter keeps that
      // outline; nothing here is better than the architect's own drawing.
      // Asked of the authored labels rather than of `roomShapes`, which after
      // the first run would already be answering with this script's own output.
      hasPlanShape: (room) => (room.plan ?? []).length > 0,
    };
  } finally {
    await rm(out, { force: true });
  }
}

function render(halls, snapped, lifts = new Map()) {
  const ring = ([lat, lng]) => `[${lat}, ${lng}]`;
  const lines = [];
  lines.push('/**');
  lines.push(" * The hotels' floors, read off Gen Con's plans. GENERATED — do not edit.");
  lines.push(' *');
  lines.push(' * Run `node scripts/venue-plans.mjs` to rebuild this. See that script for how a');
  lines.push(" * picture of a floor becomes map geometry, and for the two buildings it can't");
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
  lines.push(" * rest are the rooms it runs around, because a hotel's circulation is one");
  lines.push(' * connected thing and drawing only its outside would cover them over.');
  lines.push(' */');
  lines.push('export const VENUE_HALLS: Record<string, readonly (readonly PlanRing[])[]> = {');
  for (const [key, shapes] of [...halls].sort()) {
    lines.push(`  '${key}': [`);
    for (const rings of shapes) {
      lines.push('    [');
      for (const points of rings) lines.push(`      [${points.map(ring).join(', ')}],`);
      lines.push('    ],');
    }
    lines.push('  ],');
  }
  lines.push('};');
  lines.push('');
  lines.push('/**');
  lines.push(' * The shape the plan draws for a room, where it could be told which is which.');
  lines.push(' *');
  lines.push(' * Replaces that room’s hand-placed rectangle. Rooms missing from here are the');
  lines.push(' * ones the match was not sure about — chiefly the sections of a ballroom the');
  lines.push(' * plan draws as a single space — and they keep their rectangle.');
  lines.push(' */');
  lines.push('/**');
  lines.push(' * Where a floor becomes another one: stairs, escalators and lift banks.');
  lines.push(' *');
  lines.push(' * A position rather than an outline, because that is all a route needs — the');
  lines.push(' * point at which one storey turns into the next. Read as the grey hatched');
  lines.push(' * blocks the plans draw inside the walls, which is what an escalator is drawn');
  lines.push(' * as; Gen Con letters the big ones UP TO 2ND FLOOR beside the very same shape.');
  lines.push(' */');
  lines.push('export const VENUE_VERTICAL: Record<string, readonly (readonly [number, number])[]> = {');
  for (const [key, marks] of [...lifts].sort()) {
    lines.push(`  '${key}': [`);
    for (const mark of marks) lines.push(`    [${mark.at[0]}, ${mark.at[1]}],`);
    lines.push('  ],');
  }
  lines.push('};');
  lines.push('');
  lines.push('export const VENUE_ROOM_SHAPES: Record<string, readonly PlanRing[]> = {');
  for (const [id, rings] of [...snapped].sort()) {
    lines.push(`  '${id}': [`);
    for (const points of rings) lines.push(`    [${points.map(ring).join(', ')}],`);
    lines.push('  ],');
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

await main();
