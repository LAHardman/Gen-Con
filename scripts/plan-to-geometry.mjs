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

/**
 * Where each plan prints its key. Nothing inside is part of the building, and
 * the swatches are drawn in the same colours as the thing they stand for, so
 * they have to be excluded by position rather than by colour. Page points.
 */
const LEGEND_BOXES = {
  'icc-level-1': [0, 25, 340, 125],
  'icc-level-2': [0, 20, 250, 95],
};

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

/* ------------------------------------------------------------------ naming */

/* ------------------------------------------------------------------- build */

function convertPlan(planId, plan) {
  const svg = readFileSync(join(PLANS, `${planId}.svg`), 'utf8');
  const labels = JSON.parse(readFileSync(join(PLANS, `${planId}.labels.json`), 'utf8'));
  const project = projector(plan);
  const scale = pointScale(plan);
  const legendBox = LEGEND_BOXES[planId];
  const page = plan.page;

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

function ts(value) {
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0');
}

function main() {
  const manifest = JSON.parse(readFileSync(join(PLANS, 'georeference.json'), 'utf8'));

  const rings = [];
  const shapesOut = [];
  const detailOut = [];
  const levelsOut = new Map();
  const credits = new Set();

  for (const [planId, plan] of Object.entries(manifest)) {
    if (planId.startsWith('__')) continue;
    const { features } = convertPlan(planId, plan);
    if (plan.credit) credits.add(plan.credit);
    levelsOut.set(plan.venueId, [...(levelsOut.get(plan.venueId) ?? []), plan.level]);

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
        shapesOut.push(`  '${plan.venueId}/${plan.level}/${name}': RINGS[${at}],`);
      }
      detail.push(`    { kind: '${feature.kind}', ring: RINGS[${at}], named: ${names.length > 0} },`);
    }

    detailOut.push(`  '${plan.venueId}/${plan.level}': [\n${detail.join('\n')}\n  ],`);
  }

  const levels = [...levelsOut]
    .map(([venueId, list]) => `  '${venueId}': [${list.map((l) => `'${l}'`).join(', ')}],`)
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

/** Whose drawings these are. Named on the map, next to the basemap's credit. */
export const PLAN_CREDIT = '${[...credits].join('; ')}';
`;

  writeFileSync(OUT, source);
  console.log(
    `${OUT}: ${rings.length} shapes, ${shapesOut.length} labels, ${(source.length / 1024) | 0} KB`,
  );
}

main();
