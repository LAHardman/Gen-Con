/**
 * Turn the official floor plans into map geometry.
 *
 * Drawing a plan over the map as a picture never quite works: it arrives as one
 * flat image in somebody else's palette, its paper greys fight the basemap, and
 * wherever the fit is a metre out the whole sheet looks wrong at once. Reading
 * the plan into real coordinates instead lets the map draw it the way it draws
 * everything else — the halls become shapes the app styles, labels, and knows
 * the bounds of.
 *
 * The plans say what each shape is by colouring it, and their own legend gives
 * the key: exhibit halls and meeting rooms in one colour, prefunction space in
 * another, restrooms, service areas. That colour is the classification, so the
 * page background, the surrounding streets and the legend itself simply aren't
 * among the colours that mean anything and never make it into the output.
 *
 * The printed room numbers, read back by `plan-labels.py`, name the shapes they
 * sit inside — which is what makes "Exhibit Hall D" on the map the actual
 * outline of Exhibit Hall D rather than a rectangle drawn where it roughly is.
 *
 * Every sheet of a building is placed by one frame the whole venue shares, so
 * two floors of the same room cannot disagree about where that room is. The
 * frame comes from `plans/georeference.json`; `scripts/fit-plan.mjs` derives it.
 *
 *     node scripts/plan-to-geometry.mjs
 *
 * Regenerates src/data/plan-geometry.ts from everything in plans/.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLANS = join(ROOT, 'plans');
const OUT = join(ROOT, 'src/data/plan-geometry.ts');

/**
 * The plans' own legends, colour by colour.
 *
 * `room` is anything the convention lets to somebody — halls and meeting rooms
 * alike, which the two levels key in different colours. The rest is the space
 * between: the prefunction halls people queue in, service areas, restrooms.
 */
const LEGEND = {
  '#748ba8': 'room', // L1 "Exhibit Halls/Meeting Rooms"; L2 "Meeting Rooms"
  '#a0b1c4': 'room', // L2 "Exhibit Halls"
  '#f6bebd': 'circulation', // "Prefunction/Hallways"
  '#ee7d7d': 'restroom', // "Restrooms"
  '#b9c4d3': 'service', // "Service Areas"
};

/** Thin stroked lines inside a hall: the airwalls it divides along. */
const DIVIDER_STROKE = '#b9c4d3';

/** Below this a shape is a door swing or a column, not a space. Square metres. */
const MIN_AREA = 4;
/** Simplification tolerance, in metres. Well under a wall's thickness. */
const TOLERANCE = 0.25;

/* --------------------------------------------------------------- SVG paths */

/** Splits a path's `d` into subpaths of points, flattening the curves. */
function subpaths(d) {
  const out = [];
  let current = null;
  let at = [0, 0];
  let start = [0, 0];

  const tokens = d.match(/[MLCQZ]|[-+]?\d*\.?\d+/g) ?? [];
  let i = 0;
  const num = () => Number(tokens[i++]);

  while (i < tokens.length) {
    const op = tokens[i++];
    if (op === 'M') {
      at = start = [num(), num()];
      current = [at];
      out.push(current);
    } else if (op === 'L') {
      at = [num(), num()];
      current?.push(at);
    } else if (op === 'C' || op === 'Q') {
      const control = op === 'C' ? [[num(), num()], [num(), num()]] : [[num(), num()]];
      const end = [num(), num()];
      for (const point of flatten(at, control, end)) current?.push(point);
      at = end;
    } else if (op === 'Z') {
      at = start;
      current = null;
    }
  }
  return out.filter((points) => points.length >= 3);
}

/** Béziers, at eight segments — finer than anything a plan's corners need. */
function flatten(from, control, to) {
  const points = [];
  const all = [from, ...control, to];
  for (let step = 1; step <= 8; step += 1) {
    const t = step / 8;
    let level = all;
    while (level.length > 1) {
      const next = [];
      for (let k = 0; k + 1 < level.length; k += 1) {
        next.push([
          level[k][0] + (level[k + 1][0] - level[k][0]) * t,
          level[k][1] + (level[k + 1][1] - level[k][1]) * t,
        ]);
      }
      level = next;
    }
    points.push(level[0]);
  }
  return points;
}

function paths(svg) {
  const out = [];
  for (const match of svg.matchAll(/<path ([^>]*?)\/>/g)) {
    const attrs = match[1];
    const fill = (attrs.match(/fill="([^"]*)"/) ?? [])[1] ?? 'none';
    const stroke = (attrs.match(/stroke="([^"]*)"/) ?? [])[1] ?? null;
    const d = (attrs.match(/ d="([^"]*)"/) ?? [])[1] ?? '';
    for (const points of subpaths(d)) out.push({ fill, stroke, points });
  }
  return out;
}

/* ------------------------------------------------------------- geometry bits */

function boundsOf(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function within([x0, y0, x1, y1], box) {
  return x0 >= box[0] && y0 >= box[1] && x1 <= box[2] && y1 <= box[3];
}

function area(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function contains(points, [x, y]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ramer–Douglas–Peucker. Plans are mostly right angles, so this is nearly free. */
function simplify(points, tolerance) {
  if (points.length < 4) return points;

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
  return [
    ...simplify(points.slice(0, at + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(at), tolerance),
  ];
}

/* ------------------------------------------------------------- projection */

const R = 6378137;
const mercY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const unMercY = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);

/**
 * A plan's page points to real coordinates.
 *
 * The map draws in Web Mercator, so the plan's rectangle is stretched onto the
 * world in that projection rather than in degrees — the difference over a
 * building is small but it is the difference between the north and south walls
 * both landing on the basemap and only one of them doing so.
 */
function projector({ page: [x0, y0, x1, y1], bounds }) {
  const north = mercY(bounds.north);
  const south = mercY(bounds.south);
  return ([x, y]) => [
    unMercY(south + ((y - y0) / (y1 - y0)) * (north - south)),
    bounds.west + ((x - x0) / (x1 - x0)) * (bounds.east - bounds.west),
  ];
}

/** Metres per page point, for talking about tolerances in real units. */
function pointScale({ page: [x0, , x1], bounds }) {
  const metres = ((bounds.east - bounds.west) * Math.PI * R) / 180
    * Math.cos((bounds.north * Math.PI) / 180);
  return metres / (x1 - x0);
}

/* ------------------------------------------------------------------- build */

function convertPlan(planId, plan, frame) {
  const svg = readFileSync(join(PLANS, `${planId}.svg`), 'utf8');
  const labels = JSON.parse(readFileSync(join(PLANS, `${planId}.labels.json`), 'utf8'));
  const project = projector(frame);
  const scale = pointScale(frame);
  const legendBox = plan.legend;
  const page = frame.page;

  const shapes = [];
  for (const { fill, stroke, points } of paths(svg)) {
    const kind = LEGEND[fill.toLowerCase()]
      ?? (fill === 'none' && stroke?.toLowerCase() === DIVIDER_STROKE ? 'divider' : null);
    if (!kind) continue;

    const box = boundsOf(points);
    if (!within(box, page)) continue;
    if (legendBox && within(box, legendBox)) continue;
    if (kind !== 'divider' && area(points) * scale * scale < MIN_AREA) continue;

    shapes.push({ kind, points, box, size: area(points) });
  }

  // Each printed label names the tightest shape it falls inside, so a number
  // sitting in a meeting room claims that room and not the hall around it.
  const named = new Map();
  for (const label of labels) {
    let best = null;
    for (const shape of shapes) {
      if (shape.kind !== 'room') continue;
      if (!contains(shape.points, [label.x, label.y])) continue;
      if (!best || shape.size < best.size) best = shape;
    }
    if (!best) continue;
    if (!named.has(best)) named.set(best, []);
    named.get(best).push(label);
  }

  // A shape answers to every label printed on it, and to all of them together:
  // "HALL A" and "EXHIBIT HALL A" both mean the same room, and a block of
  // meeting rooms divided by airwalls answers to each number along it.
  for (const [shape, parts] of named) {
    parts.sort((a, b) => b.y - a.y || a.x - b.x);
    const printed = parts.map((part) => part.text);
    shape.keys = new Set([...printed, printed.join(' ')].map(key));
  }

  const tolerance = TOLERANCE / scale;
  const features = shapes.map((shape) => ({
    kind: shape.kind,
    keys: shape.keys ?? new Set(),
    ring: simplify([...shape.points, shape.points[0]], tolerance).slice(0, -1).map(project),
  }));

  return { plan, features };
}

/** Labels are matched as printed, ignoring case and how the spacing fell. */
const key = (text) => text.replace(/\s+/g, ' ').trim().toUpperCase();

/* ------------------------------------------------------------- outline */

/**
 * The building's outline, traced around everything its plans draw.
 *
 * The venue outline used to come from OpenStreetMap while the interior came
 * from the plans, and two independent tracings of one building never quite
 * agree — the line sat a few metres off its own rooms, and ran on for another
 * 90 m down the skywalk arm to the stadium, which no plan draws. An outline
 * taken from the same drawing as the interior can't disagree with it.
 *
 * Union of every floor, not just the ground one: an upper floor that oversails
 * is still part of the building's extent.
 *
 * Rasterising and tracing rather than unioning polygons directly, because the
 * shapes number in the hundreds, meet along walls drawn as hairline gaps, and
 * only the outer boundary is wanted. Closing the raster bridges those gaps;
 * anything smaller than a wall is not a courtyard.
 */
const OUTLINE = {
  /** Metres per raster cell. Finer than the wall thickness being bridged. */
  cell: 0.5,
  /** Morphological closing radius, in metres: a wall's drawn thickness. */
  close: 1.5,
  /** Simplification tolerance, in metres. Above the raster's own stair-stepping. */
  tolerance: 0.8,
};

function traceOutline(ringsLatLng) {
  const points = ringsLatLng.flat();
  const lat0 = Math.max(...points.map((p) => p[0]));
  const lng0 = Math.min(...points.map((p) => p[1]));
  const perLat = 111320;
  const perLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const toLocal = ([lat, lng]) => [(lng - lng0) * perLng, (lat0 - lat) * perLat];
  const toWorld = ([x, y]) => [lat0 - y / perLat, lng0 + x / perLng];

  const local = ringsLatLng.map((ring) => ring.map(toLocal));
  const pad = OUTLINE.close * 2;
  const flat = local.flat();
  const maxX = Math.max(...flat.map((p) => p[0])) + pad;
  const maxY = Math.max(...flat.map((p) => p[1])) + pad;
  const w = Math.ceil((maxX + pad) / OUTLINE.cell);
  const h = Math.ceil((maxY + pad) / OUTLINE.cell);
  const at = (grid, x, y) => x >= 0 && y >= 0 && x < w && y < h && grid[y * w + x] === 1;

  // Fill every shape.
  const cellX = (i) => (i + 0.5) * OUTLINE.cell - pad;
  const cellY = (j) => (j + 0.5) * OUTLINE.cell - pad;
  let grid = new Uint8Array(w * h);
  for (const ring of local) {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) + pad) / OUTLINE.cell));
    const i1 = Math.min(w - 1, Math.ceil((Math.max(...xs) + pad) / OUTLINE.cell));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) + pad) / OUTLINE.cell));
    const j1 = Math.min(h - 1, Math.ceil((Math.max(...ys) + pad) / OUTLINE.cell));
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        if (grid[j * w + i]) continue;
        if (contains(ring, [cellX(i), cellY(j)])) grid[j * w + i] = 1;
      }
    }
  }

  // Close: grow by a wall's thickness to bridge the gaps between shapes, then
  // shrink by the same, which leaves the outer boundary where it started.
  const radius = Math.round(OUTLINE.close / OUTLINE.cell);
  const morph = (source, grow) => {
    const out = new Uint8Array(w * h);
    for (let j = 0; j < h; j += 1) {
      for (let i = 0; i < w; i += 1) {
        let hit = false;
        for (let dj = -radius; dj <= radius && !hit; dj += 1) {
          for (let di = -radius; di <= radius && !hit; di += 1) {
            // Dilating asks whether any neighbour is set; eroding, whether any
            // is clear. Off the edge counts as clear either way.
            if (at(source, i + di, j + dj) === grow) hit = true;
          }
        }
        out[j * w + i] = (grow ? hit : !hit) ? 1 : 0;
      }
    }
    return out;
  };
  grid = morph(morph(grid, true), false);

  // Keep the largest connected piece: a plan can carry a detached canopy or a
  // stray mark, and the building is not those.
  const seen = new Uint8Array(w * h);
  let best = null;
  for (let start = 0; start < grid.length; start += 1) {
    if (!grid[start] || seen[start]) continue;
    const queue = [start];
    const piece = [];
    seen[start] = 1;
    while (queue.length) {
      const index = queue.pop();
      piece.push(index);
      const x = index % w;
      const y = (index - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!at(grid, nx, ny) || seen[ny * w + nx]) continue;
        seen[ny * w + nx] = 1;
        queue.push(ny * w + nx);
      }
    }
    if (!best || piece.length > best.length) best = piece;
  }
  if (!best) return [];
  const solid = new Uint8Array(w * h);
  for (const index of best) solid[index] = 1;

  // Moore-neighbour boundary following, clockwise from the topmost-leftmost
  // cell, which is on the outer boundary by construction.
  const around = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  let sx = -1;
  let sy = -1;
  for (let index = 0; index < solid.length && sy < 0; index += 1) {
    if (solid[index]) {
      sx = index % w;
      sy = (index - sx) / w;
    }
  }
  const contour = [];
  let cx = sx;
  let cy = sy;
  let from = 0;
  let guard = w * h * 4;
  do {
    contour.push([cellX(cx), cellY(cy)]);
    let moved = false;
    for (let step = 1; step <= 8; step += 1) {
      const side = (from + step) % 8;
      const nx = cx + around[side][0];
      const ny = cy + around[side][1];
      if (!at(solid, nx, ny)) continue;
      cx = nx;
      cy = ny;
      from = (side + 4) % 8; // now facing back the way we came
      moved = true;
      break;
    }
    if (!moved) break;
  } while ((cx !== sx || cy !== sy) && (guard -= 1) > 0);

  return simplify([...contour, contour[0]], OUTLINE.tolerance).slice(0, -1).map(toWorld);
}

function ts(value) {
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0');
}

function main() {
  const manifest = JSON.parse(readFileSync(join(PLANS, 'georeference.json'), 'utf8'));

  const rings = [];
  const shapesOut = [];
  const detailOut = [];
  const levelsOut = new Map();
  const byVenue = new Map();
  const credits = new Set();

  // One frame per venue, shared by all its sheets, so two floors of the same
  // room can never disagree about where that room is. See georeference.json.
  const sheets = Object.values(manifest)
    .filter((venue) => venue.venueId)
    .flatMap((venue) =>
      Object.entries(venue.plans).map(([planId, plan]) => ({ planId, plan, venue })));

  for (const { planId, plan, venue } of sheets) {
    const { features } = convertPlan(planId, plan, venue.frame);
    if (venue.credit) credits.add(venue.credit);
    levelsOut.set(venue.venueId, [...(levelsOut.get(venue.venueId) ?? []), plan.level]);
    byVenue.set(venue.venueId, [
      ...(byVenue.get(venue.venueId) ?? []),
      ...features.filter((feature) => feature.kind !== 'divider').map((feature) => feature.ring),
    ]);

    // A key printed on more than one shape says nothing about which: every
    // hall is labelled "EXHIBIT", so that word can't stand for a room. Drop
    // those and keep the keys that identify one shape.
    const claims = new Map();
    for (const [index, feature] of features.entries()) {
      for (const name of feature.keys) {
        claims.set(name, claims.has(name) ? null : index);
      }
    }

    const detail = [];
    for (const [index, feature] of features.entries()) {
      rings.push(
        `  [${feature.ring.map(([lat, lng]) => `[${ts(lat)}, ${ts(lng)}]`).join(', ')}],`,
      );
      const at = rings.length - 1;

      const names = [...feature.keys].filter((name) => claims.get(name) === index).sort();
      for (const name of names) {
        shapesOut.push(`  '${venue.venueId}/${plan.level}/${name}': RINGS[${at}],`);
      }
      detail.push(`    { kind: '${feature.kind}', ring: RINGS[${at}], named: ${names.length > 0} },`);
    }

    detailOut.push(`  '${venue.venueId}/${plan.level}': [\n${detail.join('\n')}\n  ],`);
  }

  const levels = [...levelsOut]
    .map(([venueId, list]) => `  '${venueId}': [${list.map((l) => `'${l}'`).join(', ')}],`)
    .join('\n');

  const outlines = [...byVenue]
    .map(([venueId, venueRings]) => {
      const traced = traceOutline(venueRings);
      console.log(`  ${venueId}: outline traced, ${traced.length} points`);
      return `  '${venueId}': [${traced.map(([lat, lng]) => `[${ts(lat)}, ${ts(lng)}]`).join(', ')}],`;
    })
    .join('\n');

  const source = `/**
 * Floor-plan geometry, in real coordinates. GENERATED — do not edit.
 *
 * Run \`node scripts/plan-to-geometry.mjs\` to rebuild this from the plans in
 * \`plans/\`. See that script for how a printed drawing becomes map geometry.
 *
 * Source: ${[...credits].join('; ')}.
 */

/** [latitude, longitude], the order the map draws in. */
export type PlanRing = ReadonlyArray<readonly [number, number]>;

/** What a shape is, taken from the plans' own legends. */
export type PlanDetailKind = 'circulation' | 'service' | 'restroom' | 'divider' | 'room';

export interface PlanDetail {
  kind: PlanDetailKind;
  ring: PlanRing;
  /** Whether any room can claim this shape; unclaimed ones still get drawn. */
  named: boolean;
}

/** Every shape on every plan, once. The two maps below index into this. */
const RINGS: PlanRing[] = [
${rings.join('\n')}
];

/**
 * The outline of each space the plans name, under every label printed on it —
 * \`venue/level/LABEL\`, the label as it appears on the drawing. Rooms in
 * \`venues.ts\` claim shapes by those labels, so a room on the map is drawn as
 * the shape the architect drew. Rooms sharing one shape, as a block of meeting
 * rooms divided by airwalls does, resolve to the same ring.
 */
export const PLAN_SHAPES: Record<string, PlanRing> = {
${shapesOut.join('\n')}
};

/**
 * Every shape on a plan, in drawing order: the halls and meeting rooms, and the
 * prefunction space, service cores, restrooms and airwall lines between them.
 * Drawn as the building's fabric beneath the rooms.
 */
export const PLAN_DETAIL: Record<string, readonly PlanDetail[]> = {
${detailOut.join('\n')}
};

/** The levels each venue has plans for, ground floor first. */
export const PLAN_LEVELS: Record<string, readonly string[]> = {
${levels}
};

/**
 * The building's outline, traced around everything its plans draw.
 *
 * Drawn instead of the OpenStreetMap footprint for a venue that has one, so the
 * line around the building and the rooms inside it come from the same drawing
 * and agree. The OSM outline stays in \`footprints.ts\` as the surveyed shape of
 * the building from above, and is still what every other venue is drawn as.
 */
export const PLAN_OUTLINE: Record<string, PlanRing> = {
${outlines}
};

/** Whose drawings these are. Named on the map, next to the basemap's credit. */
export const PLAN_CREDIT = '${[...credits].join('; ')}';
`;

  writeFileSync(OUT, source);
  console.log(
    `${OUT}: ${rings.length} shapes, ${shapesOut.length} labels, ${(source.length / 1024) | 0} KB`,
  );
}

main();
