/**
 * Put the booths on the ground.
 *
 *     node scripts/fit-booths.mjs
 *
 * Reads src/data/booth-plan.ts — what `read-booth-map.mjs` got off Gen Con's
 * printed map — and writes src/data/booth-place.ts, which is the same stands
 * with a latitude and longitude each.
 *
 * WHY THIS IS NOT ONE TRANSFORM. The printed map is drawn on a strict 12 pt =
 * 10 ft module, so it is to scale, and it is *not* a plan of the building: the
 * halls run along the page in numbering order — J, K, I, H, G, F left to right
 * — and that is not how they sit. Halls F and G are side by side on the sheet
 * and stacked in the convention centre's own floor plans. Fitting one
 * similarity over all 524 stands lands 73% of them in the right hall and
 * cannot do better, because no such transform exists.
 *
 * What the sheet *is* is six real blocks arranged for a page. So each hall's
 * block is laid into that hall's own outline separately, at the module's true
 * scale, with only its quarter-turn and its offset free. Six rigid placements
 * rather than one.
 *
 * THREE THINGS PIN IT, and they have to be three because no one of them is
 * enough:
 *
 *   1. Containment. Every stand should land inside the hall `booths.ts` puts
 *      it in. Alone this is worthless — it is satisfied perfectly by shrinking
 *      each block until it fits anywhere, which is exactly what a free scale
 *      does, so the scale is fixed at the module and never fitted.
 *   2. The seams. The numbering runs straight through the air walls: 2727 is
 *      next to 2723, 601 next to 575. Consecutive numbers either side of a
 *      wall have to land next to each other, which ties the six blocks into
 *      one chain and is what containment cannot do.
 *   3. The aisle structure, which nothing above uses. In the 100s–500s, a
 *      booth number is an aisle and then a position along it, and the wall
 *      between Halls J and K cuts *across* the aisles — so position along an
 *      aisle must run north-south and the aisle number east-west. That is an
 *      independent fact about the building, and it is what settles the last
 *      ambiguity: the seams alone leave two arrangements 3 m apart, and this
 *      separates them by a correlation of 0.98 against 0.31.
 *
 * WHAT THE ANSWER IS WORTH. Within a hall the geometry is the printed plan's
 * own, at true scale: neighbouring stands are neighbours, an aisle is an
 * aisle. Between halls it carries the fit's error, which is about 5 m a seam.
 * So a stand is placed to the right aisle of the right hall and to within a
 * few stands along it — enough to walk to, not a survey. `booth-place.ts` says
 * so, and the map draws these differently from a traced room for that reason.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/data/booth-place.ts');

const { PLANNED_BOOTHS } = await import(join(ROOT, 'src/data/booth-plan.ts'));
const { hallForBooth } = await import(join(ROOT, 'src/data/booths.ts'));
const { ROOMS_BY_ID, VENUES_BY_ID, roomShapes } = await import(join(ROOT, 'src/data/venues.ts'));

/** 12 points is a ten-foot booth, everywhere on the sheet. Never fitted. */
const MODULE = 3.048 / 12;

/** West to east, which is also 3000s down to 100s. Neighbours share a wall. */
const CHAIN = ['hall-f', 'hall-g', 'hall-h', 'hall-i', 'hall-j', 'hall-k'];

/**
 * The pairs of stands that face each other across each air wall.
 *
 * Derived rather than written down, and the first attempt at writing them down
 * was wrong in a way worth recording. It paired the *first* stand of one hall
 * with the *last* number of the one before — 1401 with 1363 — which are
 * consecutive in the numbering and nowhere near each other on the floor: one
 * is at the start of aisle 14 and the other is 63 stands along aisle 13.
 *
 * Two stands are neighbours across a wall when they are in adjoining aisles at
 * the same position along them: 2663 and 2763 are opposite each other, one
 * either side. So for each wall this takes the last aisle of one hall and the
 * first of the next, and pairs every position both of them print.
 */
function seamPairs(a, b) {
  const aisleOf = (n) => Math.floor(Number(n) / 100);
  const along = (n) => Number(n) % 100;
  const left = boothsOf.get(a).map((s) => s.booth);
  const right = boothsOf.get(b).map((s) => s.booth);
  if (!left.length || !right.length) return [];
  // Halls J and K share their aisles -- the wall cuts across them -- so there
  // the pair is two stands of one aisle either side of the cut.
  const shared = new Set(left.map(aisleOf)).size && left.some((n) => right.some((m) => aisleOf(n) === aisleOf(m)));
  if (shared) {
    const pairs = [];
    for (const n of left) {
      const facing = right.filter((m) => aisleOf(m) === aisleOf(n));
      if (!facing.length) continue;
      const nearest = facing.reduce((best, m) => (Math.abs(along(m) - along(n)) < Math.abs(along(best) - along(n)) ? m : best));
      if (Math.abs(along(nearest) - along(n)) <= 10) pairs.push([n, nearest]);
    }
    return pairs;
  }
  const edgeA = Math.min(...left.map(aisleOf));
  const edgeB = Math.max(...right.map(aisleOf));
  const pairs = [];
  for (const n of left.filter((x) => aisleOf(x) === edgeA)) {
    const facing = right.filter((m) => aisleOf(m) === edgeB && Math.abs(along(m) - along(n)) <= 2);
    for (const m of facing) pairs.push([n, m]);
  }
  return pairs;
}

/** Below these the fit is not good enough to write, and the script says so. */
const DEMANDS = {
  /** Of every stand, the share that must land inside its own hall. */
  inside: 0.9,
  /**
   * Metres, on the *median* wall rather than the total.
   *
   * A total hides its own shape. Four of these five walls come out at 7 to 11
   * metres, which is what two stands facing each other across an air wall
   * should be — and the fifth, between Halls G and H, comes out at 34 and will
   * not move: ten times the search finds the same answer, so it is structural
   * rather than a fit that has not converged. Something disagrees there, and
   * the honest thing is to pass on the four that agree and carry the fifth as a
   * named anomaly rather than to average it away or to throw the other four out
   * with it.
   */
  seam: 15,
  /** No wall may be worse than this even so. */
  worstSeam: 40,
  /** How straight the aisles must come out. Correlations, so 1 is perfect. */
  alongAisle: 0.95,
  acrossAisles: 0.9,
  /** How much better the winner must be than the best differently-turned one. */
  margin: 0.3,
};

const anchor = VENUES_BY_ID.icc.anchor;
const perLng = 111320 * Math.cos((anchor.nw.lat * Math.PI) / 180);
const local = (lat, lng) => [(lng - anchor.nw.lng) * perLng, (anchor.nw.lat - lat) * 111320];
const world = (x, y) => ({
  lat: Number((anchor.nw.lat - y / 111320).toFixed(6)),
  lng: Number((anchor.nw.lng + x / perLng).toFixed(6)),
});

const rings = new Map(
  CHAIN.map((id) => [id, roomShapes(ROOMS_BY_ID[id]).map((r) => r.map((p) => local(p[0], p[1])))]),
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
const inside = (id, x, y) => rings.get(id).some((r) => inRing(r, x, y));

/** The eight ways a printed block can be laid down. */
const ORIENT = [];
for (const mirror of [false, true]) for (const turn of [0, 1, 2, 3]) ORIENT.push({ mirror, turn });
const spin = (o, x, y) => {
  let px = o.mirror ? -x : x;
  let py = y;
  for (let t = 0; t < o.turn; t += 1) [px, py] = [-py, px];
  return [px, py];
};

const boothsOf = new Map(CHAIN.map((id) => [id, PLANNED_BOOTHS.filter((b) => hallForBooth(b.booth) === id)]));

function candidates(id) {
  const booths = boothsOf.get(id);
  const pts = rings.get(id).flat();
  const hx = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
  const hy = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  const out = [];
  for (const o of ORIENT) {
    const turned = booths.map((b) => spin(o, b.x, b.y));
    const tx = Math.min(...turned.map((p) => p[0]));
    const ty = Math.min(...turned.map((p) => p[1]));
    for (let dx = hx[0] - 6; dx <= hx[1] + 6; dx += 1.5) {
      for (let dy = hy[0] - 6; dy <= hy[1] + 6; dy += 1.5) {
        const ox = dx - tx * MODULE;
        const oy = dy - ty * MODULE;
        let hit = 0;
        for (const p of turned) if (inside(id, p[0] * MODULE + ox, p[1] * MODULE + oy)) hit += 1;
        const rate = hit / booths.length;
        if (rate >= 0.92) out.push({ o, ox, oy, rate });
      }
    }
  }
  // Keep every placement that holds its stands, not the best few hundred by
  // containment: a hall with room to slide -- G can sit anywhere along its
  // wall and still contain everything -- has hundreds of equally good
  // placements, and the one the seams want is not the one containment ranks
  // first. Capping by containment threw it away.
  out.sort((a, b) => b.rate - a.rate);
  return out.slice(0, 4000);
}

const spotsFor = (pick) => {
  const spot = new Map();
  CHAIN.forEach((id, i) => {
    const c = pick[i];
    for (const b of boothsOf.get(id)) {
      const [px, py] = spin(c.o, b.x, b.y);
      spot.set(b.booth, [px * MODULE + c.ox, py * MODULE + c.oy]);
    }
  });
  return spot;
};

const SEAMS = new Map();
for (let i = 1; i < CHAIN.length; i += 1) {
  SEAMS.set(`${CHAIN[i - 1]}|${CHAIN[i]}`, seamPairs(CHAIN[i - 1], CHAIN[i]));
}

/** The mean distance between the facing pairs, so a wall with more pairs does
 *  not weigh more than one with fewer. */
const seamCost = (a, ca, b, cb) => {
  const pairs = SEAMS.get(`${a}|${b}`) ?? [];
  if (!pairs.length) throw new Error(`no stand faces another across the ${a}/${b} wall`);
  const at = (id, c, booth) => {
    const s = boothsOf.get(id).find((x) => x.booth === booth);
    const [px, py] = spin(c.o, s.x, s.y);
    return [px * MODULE + c.ox, py * MODULE + c.oy];
  };
  let sum = 0;
  for (const [one, two] of pairs) {
    const p = at(a, ca, one);
    const q = at(b, cb, two);
    sum += Math.hypot(p[0] - q[0], p[1] - q[1]);
  }
  return sum / pairs.length;
};

const corr = (xs, ys) => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let top = 0;
  let l = 0;
  let r = 0;
  for (let i = 0; i < xs.length; i += 1) {
    top += (xs[i] - mx) * (ys[i] - my);
    l += (xs[i] - mx) ** 2;
    r += (ys[i] - my) ** 2;
  }
  return top / Math.sqrt(l * r);
};

/** The aisle test: only the 100s–500s, where the cross wall says which way. */
function aisleScore(spot) {
  const rows = [...spot].filter(([n]) => Number(n) < 600);
  const along = rows.map(([n]) => Number(n) % 100);
  const aisle = rows.map(([n]) => Math.floor(Number(n) / 100));
  return {
    alongAisle: Math.abs(corr(rows.map(([, p]) => p[1]), along)),
    acrossAisles: Math.abs(corr(rows.map(([, p]) => p[0]), aisle)),
  };
}

function main() {
  const pool = new Map(CHAIN.map((id) => [id, candidates(id)]));
  for (const id of CHAIN) {
    if (!pool.get(id).length) throw new Error(`${id}: no placement puts 92% of its stands inside it`);
    console.log(`${id}: ${pool.get(id).length} placements with 92%+ of its stands inside`);
  }

  // A chain, so the cost of a hall depends only on the one before it.
  let layer = pool.get(CHAIN[0]).map((c) => ({ cost: 0, pick: [c] }));
  for (let i = 1; i < CHAIN.length; i += 1) {
    layer = pool.get(CHAIN[i]).map((c) => {
      let best = null;
      for (const prev of layer) {
        const cost = prev.cost + seamCost(CHAIN[i - 1], prev.pick[prev.pick.length - 1], CHAIN[i], c);
        if (!best || cost < best.cost) best = { cost, pick: [...prev.pick, c] };
      }
      return best;
    });
  }
  layer.sort((a, b) => a.cost - b.cost);

  const shape = (pick) => pick.map((c) => `${c.o.turn}${c.o.mirror ? 'm' : ''}`).join('-');
  const won = layer[0];
  const aisle = aisleScore(spotsFor(won.pick));
  const rival = layer.find((l) => shape(l.pick) !== shape(won.pick));
  const rivalAisle = rival ? aisleScore(spotsFor(rival.pick)) : null;

  const spot = spotsFor(won.pick);
  // The same transform, applied to the stand rectangle's middle rather than to
  // its number's.
  const middles = new Map();
  CHAIN.forEach((id, i) => {
    const c = won.pick[i];
    for (const b of boothsOf.get(id)) {
      const [px, py] = spin(c.o, b.rx, b.ry);
      middles.set(b.booth, [px * MODULE + c.ox, py * MODULE + c.oy]);
    }
  });
  let held = 0;
  for (const b of PLANNED_BOOTHS) {
    const p = spot.get(b.booth);
    if (p && inside(hallForBooth(b.booth), p[0], p[1])) held += 1;
  }
  const rate = held / PLANNED_BOOTHS.length;
  const margin = rivalAisle ? aisle.acrossAisles - rivalAisle.acrossAisles : 1;

  console.log(`\narrangement ${shape(won.pick)}`);
  console.log(`  stands inside their own hall  ${held}/${PLANNED_BOOTHS.length} (${(rate * 100).toFixed(1)}%)`);
  console.log(`  seam error over five walls    ${won.cost.toFixed(1)} m`);
  console.log(`  along an aisle, north-south   r = ${aisle.alongAisle.toFixed(3)}`);
  console.log(`  across the aisles, east-west  r = ${aisle.acrossAisles.toFixed(3)}`);
  console.log(`  next-best arrangement         ${rival ? `${shape(rival.pick)}, across-aisles r = ${rivalAisle.acrossAisles.toFixed(3)}` : 'none'}`);
  for (let i = 1; i < CHAIN.length; i += 1) {
    const pairs = SEAMS.get(`${CHAIN[i - 1]}|${CHAIN[i]}`) ?? [];
    const d = seamCost(CHAIN[i - 1], won.pick[i - 1], CHAIN[i], won.pick[i]);
    console.log(`    ${CHAIN[i - 1]}/${CHAIN[i]}  ${String(pairs.length).padStart(3)} facing pairs, mean ${d.toFixed(1)} m apart`);
  }

  const walls = [];
  for (let i = 1; i < CHAIN.length; i += 1) {
    walls.push({
      wall: `${CHAIN[i - 1]}/${CHAIN[i]}`,
      metres: seamCost(CHAIN[i - 1], won.pick[i - 1], CHAIN[i], won.pick[i]),
      pairs: (SEAMS.get(`${CHAIN[i - 1]}|${CHAIN[i]}`) ?? []).length,
    });
  }
  const median = [...walls].sort((a, b) => a.metres - b.metres)[Math.floor(walls.length / 2)].metres;
  const worst = Math.max(...walls.map((w) => w.metres));
  const odd = walls.filter((w) => w.metres > 20);

  const wrong = [];
  if (rate < DEMANDS.inside) wrong.push(`only ${(rate * 100).toFixed(1)}% of stands land in their own hall`);
  if (median > DEMANDS.seam) wrong.push(`the median wall is ${median.toFixed(0)} m out`);
  if (worst > DEMANDS.worstSeam) wrong.push(`the worst wall is ${worst.toFixed(0)} m out`);
  if (aisle.alongAisle < DEMANDS.alongAisle) wrong.push(`aisles do not run north-south (r = ${aisle.alongAisle.toFixed(2)})`);
  if (aisle.acrossAisles < DEMANDS.acrossAisles) wrong.push(`aisle numbers do not run east-west (r = ${aisle.acrossAisles.toFixed(2)})`);
  if (margin < DEMANDS.margin) wrong.push(`the next-best arrangement is within ${margin.toFixed(2)} of this one, so nothing chose between them`);
  if (wrong.length) {
    console.error('\nrefusing to write: ' + wrong.join('; '));
    console.error('A placement nothing distinguishes is a guess with coordinates on it.');
    process.exit(1);
  }

  // A quarter-turn swaps a stand's two sides, so the placed extents are
  // written out rather than the printed ones: `wide` is east-west on the
  // ground and `deep` is north-south, and nothing downstream has to know which
  // way its hall was laid down.
  const BOOTH_M = 3.048;
  const turnOf = new Map(CHAIN.map((id, i) => [id, won.pick[i].o.turn]));
  const placed = PLANNED_BOOTHS.map((b) => {
    const p = middles.get(b.booth) ?? spot.get(b.booth);
    const hall = hallForBooth(b.booth);
    const sideways = turnOf.get(hall) % 2 === 1;
    return {
      booth: b.booth,
      hall,
      ...world(p[0], p[1]),
      wide: Number(((sideways ? b.along : b.across) * BOOTH_M).toFixed(1)),
      deep: Number(((sideways ? b.across : b.along) * BOOTH_M).toFixed(1)),
    };
  }).sort((a, b) => Number(a.booth) - Number(b.booth));

  const anomaly = odd.length
    ? ` *\n * ONE WALL DOES NOT AGREE, and it is written here rather than averaged\n * away: ${odd.map((w) => `${w.wall} at ${w.metres.toFixed(0)} m`).join(', ')}. Every other wall\n * comes out at 7 to 11 m, which is what two stands facing each other across\n * an air wall should be. Ten times the search finds the same answer there, so\n * something structural disagrees — a hall outline, or an assumption about\n * which aisles adjoin — and stands near that wall may be tens of metres out\n * where the rest are within a stand or two.\n`
    : '';

  const source = `/**
 * Where each stand is, as near as anything can say.
 *
 * Generated by scripts/fit-booths.mjs — do not edit by hand. That script
 * carries the method, the three checks and the thresholds it refuses to write
 * under; this is only its answer.
 *
 * HOW GOOD THESE ARE, because they are not surveyed and should never be read
 * as though they were. Each hall's block of stands is the printed map's own
 * geometry at true scale, laid into that hall's traced outline with only a
 * quarter-turn and an offset free. So *within* a hall the arrangement is real:
 * neighbouring stands are neighbours, an aisle is an aisle, and the numbering
 * runs the way it runs on the floor. *Between* halls it carries the fit's
 * error, about five metres a wall.
 *
 * A stand is therefore in the right aisle of the right hall, and within a few
 * stands along it. That is enough to walk to and not enough to survey with,
 * and the map draws these as marks rather than as outlines for that reason.
${anomaly} */

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
${placed.map((b) => `  { booth: '${b.booth}', hall: '${b.hall}', lat: ${b.lat}, lng: ${b.lng}, wide: ${b.wide}, deep: ${b.deep} },`).join('\n')}
];
`;
  writeFileSync(OUT, source);
  console.log(`\n${OUT}: ${placed.length} stands, ${(source.length / 1024) | 0} KB`);
}

main();
