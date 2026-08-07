/**
 * Put the booths on the ground.
 *
 *     node scripts/fit-booths.mjs
 *
 * Reads src/data/booth-plan.ts — what `read-booth-map.mjs` got off Gen Con's
 * printed map — and writes src/data/booth-place.ts, which is the same stands
 * with a latitude and longitude each.
 *
 * IT IS ONE TRANSFORM, and this script used to argue at length that it could
 * not be. The old argument was that the sheet arranges the halls for a page
 * rather than as the building has them — Halls F and G side by side on it,
 * stacked in the convention centre's own plans — so each hall's block had to be
 * laid down separately: six rigid placements chained together at the walls.
 *
 * That was wrong, and the sheet says so plainly once it is measured rather than
 * read by its hall letters. The floor is drawn as one filled polygon; that
 * polygon is 282.2 m across at the printed module, and the six halls together
 * are 282.5 m. Laid down as a single piece it covers them well and every stand
 * lands inside. What disagrees with the building is the hall letters `booths.ts`
 * infers from the numbering, not the drawing.
 *
 * Which also settles the thing that made the old answer bad to look at. Six
 * blocks placed independently overlap wherever the chain pulled two of them
 * together, and no amount of tuning stops that, because nothing in the
 * objective forbade it. One rigid transform cannot: the stands do not overlap
 * on the page, so they cannot overlap on the ground.
 *
 * WHAT PINS IT. The scale is never fitted — 12 points is a ten-foot booth
 * everywhere on the sheet. That leaves eight ways up and an offset, and three
 * separate things agree on which:
 *
 *   1. The silhouette. The carpet's outline against the halls' outline, and
 *      that is a shape rather than a rectangle: a 175 m chamfer down one side
 *      and a step at one end.
 *   2. Containment. Every stand inside the halls. Worthless alone — a small
 *      enough block fits anywhere — but the scale is fixed, so it is not free.
 *   3. The aisle structure, which the fit never optimises for. In the 100s to
 *      500s a booth number is an aisle and then a position along it, and the
 *      wall between Halls J and K cuts across those aisles rather than between
 *      them. So position along an aisle has to run north-south, and the aisle
 *      number east-west. That is a fact about the building that nothing here
 *      is fitting to, which is why it is the one worth having.
 *
 * AND THE ENTRANCES ARE CHECKED, not fitted. The sheet marks five ways on to
 * the floor. `walkable.ts` finds the halls' doorways from the building's traced
 * plan and has never seen the PDF. Where the two land is reported below and
 * refused on, rather than optimised towards.
 *
 * WHAT THE ANSWER IS WORTH. The geometry is the printed plan's own at true
 * scale, rigidly placed: neighbouring stands are neighbours, an aisle is an
 * aisle, no two stands overlap, and what error there is, is one registration
 * error shared by the whole floor rather than something that accumulates across
 * it. Enough to walk to. Not a survey.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/data/booth-place.ts');

const { PLANNED_BOOTHS, PLAN_FLOOR, PLAN_ENTRANCES } = await import(join(ROOT, 'src/data/booth-plan.ts'));
const { ROOMS_BY_ID, VENUES_BY_ID, roomShapes } = await import(join(ROOT, 'src/data/venues.ts'));
const { roomEntrance } = await import(join(ROOT, 'src/data/walkable.ts'));
const { EXHIBITORS } = await import(join(ROOT, 'src/data/exhibitors.ts'));

/** 12 points is a ten-foot booth, everywhere on the sheet. Never fitted. */
const MODULE = 3.048 / 12;
/** A ten-foot booth, in metres. */
const BOOTH = 3.048;

/** The exhibit floor, whatever the walls across it are called. */
const HALLS = ['hall-f', 'hall-g', 'hall-h', 'hall-i', 'hall-j', 'hall-k'];

/** Below these the fit is not good enough to write, and the script says so. */
const DEMANDS = {
  /** Carpet against halls, as an intersection over union. */
  cover: 0.9,
  /** How much better the winner must be than the best differently-turned one. */
  margin: 0.05,
  /** Of every stand, the share that must land inside the halls at all. */
  inside: 0.98,
  /** How straight the aisles must come out. Correlations, so 1 is perfect. */
  alongAisle: 0.95,
  acrossAisles: 0.9,
  /** Metres, from each marked entrance to the nearest hall wall. */
  entrance: 8,
};

const anchor = VENUES_BY_ID.icc.anchor;
const perLng = 111320 * Math.cos((anchor.nw.lat * Math.PI) / 180);
/** Metres east and metres north of the venue's own anchor. */
const local = (lat, lng) => [(lng - anchor.nw.lng) * perLng, (lat - anchor.nw.lat) * 111320];
// Seven decimals, where everything else in this repository uses six.
//
// Six is a tenth of a metre, which is normally far finer than anything here
// deserves. It is not fine enough for these: stands abut, so two of them share
// an edge exactly, and rounding both sides of that edge independently can push
// them a tenth of a metre into each other. That is invisible on a map and still
// means the file says stands overlap when the fit says they do not.
const world = (x, y) => ({
  lat: Number((anchor.nw.lat + y / 111320).toFixed(7)),
  lng: Number((anchor.nw.lng + x / perLng).toFixed(7)),
});

const rings = new Map(
  HALLS.map((id) => [id, roomShapes(ROOMS_BY_ID[id]).map((r) => r.map((p) => local(p[0], p[1])))]),
);
const inRing = (ring, x, y) => {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[i];
    const q = ring[j];
    if (p[1] > y !== q[1] > y && x < ((q[0] - p[0]) * (y - p[1])) / (q[1] - p[1]) + p[0]) odd = !odd;
  }
  return odd;
};
const hallAt = (x, y) => HALLS.find((id) => rings.get(id).some((r) => inRing(r, x, y)));

/** The eight ways a printed block can be laid down. */
const ORIENT = [];
for (const mirror of [false, true]) for (const turn of [0, 1, 2, 3]) ORIENT.push({ mirror, turn });
/** Page points to metres, turned. The scale is the module and stays the module. */
const spin = (o, x, y) => {
  let px = (o.mirror ? -x : x) * MODULE;
  let py = y * MODULE;
  for (let t = 0; t < o.turn; t += 1) [px, py] = [-py, px];
  return [px, py];
};

/* ------------------------------------------------- the halls, as a raster */

const corners = HALLS.flatMap((id) => rings.get(id).flat());
const GX0 = Math.floor(Math.min(...corners.map((p) => p[0]))) - 40;
const GX1 = Math.ceil(Math.max(...corners.map((p) => p[0]))) + 40;
const GY0 = Math.floor(Math.min(...corners.map((p) => p[1]))) - 40;
const GY1 = Math.ceil(Math.max(...corners.map((p) => p[1]))) + 40;
const GW = GX1 - GX0;
const GH = GY1 - GY0;
const halls = new Uint8Array(GW * GH);
let hallArea = 0;
for (let y = 0; y < GH; y += 1) {
  for (let x = 0; x < GW; x += 1) {
    if (hallAt(GX0 + x + 0.5, GY0 + y + 0.5)) { halls[y * GW + x] = 1; hallArea += 1; }
  }
}

/**
 * How much of the halls the carpet covers, over how much the two cover between
 * them. A square metre a cell, which is finer than either outline is drawn and
 * much finer than the answer needs to be.
 */
function cover(ring) {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - GX0));
  const x1 = Math.min(GW, Math.ceil(Math.max(...xs) - GX0));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - GY0));
  const y1 = Math.min(GH, Math.ceil(Math.max(...ys) - GY0));
  let both = 0;
  let carpet = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (!inRing(ring, GX0 + x + 0.5, GY0 + y + 0.5)) continue;
      carpet += 1;
      if (halls[y * GW + x]) both += 1;
    }
  }
  return both / (hallArea + carpet - both);
}

/* ------------------------------------------------------------ the search */

console.log('laying the whole sheet down, eight ways:');
const ranked = [];
for (const o of ORIENT) {
  const shape = PLAN_FLOOR.map(([x, y]) => spin(o, x, y));
  const cx = (Math.min(...shape.map((p) => p[0])) + Math.max(...shape.map((p) => p[0]))) / 2;
  const cy = (Math.min(...shape.map((p) => p[1])) + Math.max(...shape.map((p) => p[1]))) / 2;
  let best = { dx: (GX0 + GX1) / 2 - cx, dy: (GY0 + GY1) / 2 - cy, score: -1 };
  // Coarse to fine. A metre's step over every plausible offset is a quarter of
  // a million rasterisations, and nearly all of them are hopeless.
  for (const step of [8, 3, 1, 0.5]) {
    const span = step * 6;
    const from = { ...best };
    for (let dx = from.dx - span; dx <= from.dx + span + 1e-9; dx += step) {
      for (let dy = from.dy - span; dy <= from.dy + span + 1e-9; dy += step) {
        const score = cover(shape.map((p) => [p[0] + dx, p[1] + dy]));
        if (score > best.score) best = { dx, dy, score };
      }
    }
  }
  ranked.push({ o, ...best });
  console.log(`  turn ${o.turn} ${o.mirror ? 'mirrored' : 'as drawn'}: ${best.score.toFixed(3)}`);
}
ranked.sort((a, b) => b.score - a.score);
const won = ranked[0];
const margin = won.score - ranked[1].score;
console.log(`\nbest: turn ${won.o.turn} ${won.o.mirror ? 'mirrored' : 'as drawn'}, covering `
  + `${won.score.toFixed(3)} against ${ranked[1].score.toFixed(3)} for the next way up`);

const put = (x, y) => {
  const [px, py] = spin(won.o, x, y);
  return [px + won.dx, py + won.dy];
};

/* ------------------------------------------------------------- the stands */

// A stand's sides are given across and along the page. A quarter-turn swaps
// which of those is east-west, and nothing drawing these should have to know
// which way the sheet went down, so it is resolved here.
const sideways = won.o.turn % 2 === 1;
const placed = PLANNED_BOOTHS.map((b) => {
  // Two positions, because they answer different questions. The number says
  // *which* stand, and is printed at the booth's own place along its aisle, so
  // it is what the aisle check has to use. The rectangle says *what the stand
  // is*, and on a 2x9 island its middle is twelve metres from the number.
  const [x, y] = put(b.rx, b.ry);
  const [fx, fy] = put(b.x, b.y);
  return {
    booth: b.booth,
    hall: hallAt(x, y),
    x,
    y,
    fx,
    fy,
    wide: Number(((sideways ? b.along : b.across) * BOOTH).toFixed(1)),
    deep: Number(((sideways ? b.across : b.along) * BOOTH).toFixed(1)),
  };
});

const held = placed.filter((s) => s.hall).length;
console.log(`${held}/${placed.length} stands inside the halls (${(held / placed.length * 100).toFixed(1)}%)`);

/* ---------------------------------------- the aisles, which nothing fitted */

const correlation = (xs, ys) => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let top = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < xs.length; i += 1) {
    top += (xs[i] - mx) * (ys[i] - my);
    left += (xs[i] - mx) ** 2;
    right += (ys[i] - my) ** 2;
  }
  return Math.abs(top / Math.sqrt(left * right));
};
// Over the stands the exhibitor list recognises, and only those. Three of the
// 565 numbers were misread — 246, 264 and 281, all of them four-digit numbers
// in the 2000s that came out three digits — and they sit 700 points from the
// aisle they claim. Three points out of 129 drag this correlation from 0.99 to
// 0.34 on their own. Excluding them is not tuning the placement against the
// answer sheet: it is a check on where stands are, and those three are known
// to be reading failures before it runs. `exhibitors.ts` flags them, and the
// reader's own guard is what flags them with it.
const listed = new Set(EXHIBITORS.map((e) => e.booth).filter(Boolean));
const stretch = placed.filter((s) => Number(s.booth) < 600 && listed.has(s.booth));
const along = correlation(stretch.map((s) => s.fy), stretch.map((s) => Number(s.booth) % 100));
const across = correlation(stretch.map((s) => s.fx), stretch.map((s) => Math.floor(Number(s.booth) / 100)));
console.log(`aisles: position along runs north-south at ${along.toFixed(3)}, aisle number east-west at ${across.toFixed(3)}`);

/* --------------------------------------------------------- no two overlap */

// The whole point of placing the sheet in one piece, so it is checked rather
// than assumed: a mistake in the turn, or in which side of a stand is which,
// would show up here and nowhere else.
const overlaps = [];
const cells = new Map();
const CELL = 12;
for (const s of placed) {
  const gx = Math.floor(s.x / CELL);
  const gy = Math.floor(s.y / CELL);
  for (let ax = gx - 1; ax <= gx + 1; ax += 1) {
    for (let ay = gy - 1; ay <= gy + 1; ay += 1) {
      for (const other of cells.get(`${ax},${ay}`) ?? []) {
        const gapX = Math.abs(s.x - other.x) - (s.wide + other.wide) / 2;
        const gapY = Math.abs(s.y - other.y) - (s.deep + other.deep) / 2;
        // A tenth of a metre of slack: stand sizes are rounded to whole booths
        // and two stands back to back share their edge.
        if (gapX < -0.1 && gapY < -0.1) overlaps.push([s.booth, other.booth]);
      }
    }
  }
  const key = `${gx},${gy}`;
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push(s);
}
console.log(`overlapping stands: ${overlaps.length}${overlaps.length ? ` (${overlaps.slice(0, 6).map((p) => p.join('/')).join(' ')})` : ''}`);

/* -------------------------------------------------- the entrances, checked */

const doors = HALLS
  .map((id) => roomEntrance(roomShapes(ROOMS_BY_ID[id]), ROOMS_BY_ID[id].venueId, ROOMS_BY_ID[id].level))
  .filter(Boolean)
  .map((d) => local(d.door.lat, d.door.lng));
/** How far a point is from the nearest hall wall, inside or out. */
const fromWall = (px, py) => {
  let near = Infinity;
  for (const id of HALLS) {
    for (const ring of rings.get(id)) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [ax, ay] = ring[j];
        const [bx, by] = ring[i];
        const dx = bx - ax;
        const dy = by - ay;
        const len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
        near = Math.min(near, Math.hypot(ax + dx * t - px, ay + dy * t - py));
      }
    }
  }
  return near;
};
const entrances = PLAN_ENTRANCES.map(({ x, y }) => {
  const [ex, ey] = put(x, y);
  return {
    wall: fromWall(ex, ey),
    door: Math.min(...doors.map((d) => Math.hypot(d[0] - ex, d[1] - ey))),
  };
});
// Two numbers, and the first is the one worth refusing on. An entrance is a
// hole in a wall, so a correctly placed one lands *on* a wall — that is a
// registration check, and one an entrance dropped in the middle of the floor
// would fail. The second is context rather than a test: `roomEntrance` returns
// a single point per hall, chosen as the spot on its outline nearest to open
// floor, and along a sixty-metre concourse wall that pick is close to
// arbitrary. Two entrances off the same wall are 61 m apart and both right.
console.log(`entrances: ${entrances.map((e) => `${e.wall.toFixed(1)} m`).join(', ')} from the nearest hall wall`);
console.log(`           ${entrances.map((e) => `${e.door.toFixed(0)} m`).join(', ')} from the nearest doorway the plan finds`);

/* ------------------------------------------------------------ the refusal */

const failed = [];
if (won.score < DEMANDS.cover) failed.push(`the carpet covers only ${won.score.toFixed(3)} of the halls`);
if (margin < DEMANDS.margin) failed.push(`only ${margin.toFixed(3)} better than laying the sheet down another way`);
if (held / placed.length < DEMANDS.inside) failed.push(`only ${(held / placed.length * 100).toFixed(1)}% of stands are inside a hall`);
if (along < DEMANDS.alongAisle) failed.push(`position along an aisle runs north-south at only ${along.toFixed(3)}`);
if (across < DEMANDS.acrossAisles) failed.push(`aisle number runs east-west at only ${across.toFixed(3)}`);
if (overlaps.length) failed.push(`${overlaps.length} pairs of stands overlap`);
if (Math.max(...entrances.map((e) => e.wall)) > DEMANDS.entrance) failed.push(`an entrance is ${Math.max(...entrances.map((e) => e.wall)).toFixed(1)} m from any hall wall`);
if (failed.length) {
  console.error(`\nnot written:\n${failed.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}

const kept = placed.filter((s) => s.hall).sort((a, b) => Number(a.booth) - Number(b.booth));
const source = `/**
 * Where each stand is.
 *
 * Generated by scripts/fit-booths.mjs — do not edit by hand. That script
 * carries the method, the checks and the thresholds it refuses to write under;
 * this is only its answer.
 *
 * HOW GOOD THESE ARE, because they are not surveyed and should not be read as
 * though they were. The printed map is one to-scale plan of the whole exhibit
 * floor, and it is laid on to the building as a single rigid piece: the scale
 * is the sheet's own module and is never fitted, so only the way up and the
 * offset were ever chosen. The carpet's outline then covers the six halls'
 * outlines to ${won.score.toFixed(3)}, against ${ranked[1].score.toFixed(3)} for the next way of laying it
 * down, and ${(held / placed.length * 100).toFixed(1)}% of the stands land inside them.
 *
 * So the arrangement is the printed plan's own, exactly: neighbouring stands
 * are neighbours, an aisle is an aisle, and no two stands overlap — that last
 * being a property of placing the sheet in one piece rather than something
 * tuned for. What error there is, is one registration error shared by the whole
 * floor rather than something that accumulates across it.
 *
 * The five entrances the sheet marks land ${entrances.map((e) => e.wall.toFixed(1)).join(', ')} m from a hall
 * wall, which is where a hole in a wall should be. \`walkable.ts\` has never
 * seen the PDF.
 *
 * \`hall\` is which hall outline the stand actually falls in, which is not
 * always what \`booths.ts\` would say from its number. The numbering does not
 * respect the walls, and during the convention the walls are not there.
 */

export interface PlacedBooth {
  booth: string;
  /** The room id of the hall it stands in. */
  hall: string;
  lat: number;
  lng: number;
  /** The stand's own size on the ground, in metres. */
  wide: number;
  deep: number;
}

export const PLACED_BOOTHS: ReadonlyArray<PlacedBooth> = [
${kept.map((s) => {
    const at = world(s.x, s.y);
    return `  { booth: '${s.booth}', hall: '${s.hall}', lat: ${at.lat}, lng: ${at.lng}, wide: ${s.wide}, deep: ${s.deep} },`;
  }).join('\n')}
];
`;
writeFileSync(OUT, source);
console.log(`\n${OUT}: ${kept.length} stands, ${(source.length / 1024) | 0} KB`);
