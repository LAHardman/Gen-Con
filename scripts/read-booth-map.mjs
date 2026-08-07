/**
 * Read Gen Con's printed exhibit-hall map, which has no text on it.
 *
 *     node scripts/read-booth-map.mjs plans/2026.exhibithallmap.pdf
 *
 * Regenerates src/data/booth-plan.ts. The PDF is Gen Con's programme spread and
 * is not in this repository; it is published each year and has to be fetched by
 * hand (`files.gencon.com` refuses this environment's egress).
 *
 * WHAT IS ON THE PAGE. The exhibitor index is text, and `exhibitors.ts`
 * already holds it. The floor is not: 4,495 filled paths, of which 2,099 are
 * the outlines of digits and most of the rest are the lines between stands.
 * The page's text layer holds the index and a dozen big labels and nothing
 * else, so the booth numbers have to be read as shapes.
 *
 * WHICH PATHS ARE ON THE FLOOR. The floor is not a band across the page — it
 * is an L, whose right-hand third comes down 140 points further than its left,
 * with the index filling the notch beside it. This used to be cut at `y > 300`
 * and that took 205 stands off the plan along with the index. The sheet draws
 * the floor as a single filled polygon, over the index's white background
 * rather than under it, so the polygon answers the question directly.
 *
 * HOW THE NUMBERS ARE READ, and each step is checkable:
 *
 *   1. Every filled path is replayed through the content stream with its
 *      transform, so each shape lands in page coordinates.
 *   2. A digit is navy, 4.2 pt tall and no wider than tall. That is 2,099
 *      shapes. The hairlines between stands are the same colour and are 0.7 pt
 *      tall, which is what separates them.
 *   3. Each digit is scan-filled into a 12x16 coverage raster, normalised to
 *      its own bounding box, and clustered by mean absolute difference. Ten
 *      clusters come out far larger than the rest. Those are the ten digits;
 *      `DIGITS` below is what they look like, read off a rendering of the
 *      cluster means, which is the one step here a machine did not do.
 *   4. Every glyph is then read as the *nearest of those ten means*, not as
 *      whichever cluster absorbed it. A cluster exists because nothing took
 *      its seed, and a seed is an arbitrary specimen — reading by cluster
 *      dropped 36 glyphs into an eleventh one and took a digit off 36 numbers.
 *   5. Digits are grouped into lines by baseline proximity, then into numbers
 *      by *advance* — the distance from one glyph's left edge to the next.
 *      Not by the gap between their boxes: "1" is 1.2 pt narrower than every
 *      other digit, so the gap after a 1 is the same size as the gap between
 *      two numbers, and no threshold on it can tell them apart. The advance is
 *      2.7 pt inside a number and 6.4 pt between two.
 *   6. A number is three or four digits. A longer run is two numbers set closer
 *      than the rest — booths facing each other across an aisle — and is cut at
 *      the widest advance inside it.
 *
 * HOW THE STANDS ARE FOUND. Not by looking for rectangles: a stand's outline
 * is drawn as four separate strips and only some of them leave the content
 * stream as one closed path, so "the rectangle nearest this number" gave one
 * rectangle to several numbers and wrote 316 stands on top of each other.
 * Every line on the sheet is rasterised instead, the digits left out of it, and
 * each stand grows out from its number until it meets a line or another stand.
 * They grow together, which is what makes overlapping impossible rather than
 * unlikely.
 *
 * HOW IT IS CHECKED, which matters more than any of the above. `exhibitors.ts`
 * holds 726 booth numbers, pulled from a different Gen Con system on a
 * different day. 559 of the 565 numbers read here are in it: 98.9%. Nothing
 * about this pipeline was tuned against that list — it is the answer sheet, it
 * is the reason the reading can be believed, and the script refuses to write a
 * file that disagrees with it, because a misreading produces numbers and
 * numbers look like numbers.
 *
 * WHAT THIS DOES NOT DO. It reads the sheet; it does not place it. `x` and `y`
 * here are page points. They do turn into coordinates — the sheet is one plan
 * of the whole floor, drawn to scale — but doing that is `fit-booths.mjs`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { encodePng } from './lib/png.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/data/booth-plan.ts');

/**
 * The ten digits, in the order their clusters come out by size.
 *
 * This is the one step a machine did not do: the cluster means were rendered
 * as a picture and read. Re-run the script with `--digits` to write that
 * picture out again and check it.
 */
const DIGITS = ['2', '1', '3', '5', '4', '6', '0', '9', '7', '8'];

/** Navy. Everything on the grid is drawn in it; nothing else is. */
const INK = '22,30,39';
/**
 * The carpet, which is the exhibit floor and the only reliable way to say
 * what is on it.
 *
 * This used to be `y > 300` — "the grid is the upper three quarters, below it
 * is the exhibitor index" — and that is wrong, because the floor is not a
 * band across the page. It is an L: the right-hand third comes down 140 points
 * further than the left, and the index fills the notch beside it. A horizontal
 * cut cannot separate those two, and this one took 205 stands off the plan
 * along with the index.
 *
 * The sheet draws the floor as one filled polygon in this colour, over the
 * index's white background rather than under it, so the polygon is the answer
 * to the question directly and no cut has to be guessed.
 */
const CARPET = '246,242,236';
/** A stand is a whole number of ten-foot booths. */
const MODULE = 12;

const NUM = (v) => Number(v.toFixed(2));

async function shapesOf(pdfPath) {
  // Not a dependency of the app. This runs by hand, once a year, against a file
  // that is not in the repository either, so pdfjs is not worth carrying in
  // `package.json` for the other 364 days. Resolved from here first and from
  // the working directory second, which is what makes `npm i --no-save` in a
  // scratch directory enough.
  let pdfjs;
  for (const from of [import.meta.url, pathToFileURL(join(process.cwd(), 'x.mjs')).href]) {
    try {
      pdfjs = await import(createRequire(from).resolve('pdfjs-dist/legacy/build/pdf.mjs'));
      break;
    } catch {
      /* try the next place */
    }
  }
  if (!pdfjs) throw new Error('needs pdfjs-dist: npm i --no-save pdfjs-dist');
  const { getDocument, OPS } = pdfjs;
  const doc = await getDocument({ data: new Uint8Array(readFileSync(pdfPath)), useSystemFonts: true })
    .promise;
  const page = await doc.getPage(1);
  const ops = await page.getOperatorList();

  const mul = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const at = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  let ctm = [1, 0, 0, 1, 0, 0];
  let colour = [0, 0, 0];
  const stack = [];
  let pending = null;
  const shapes = [];

  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push([ctm, colour]);
    else if (fn === OPS.restore) { const was = stack.pop(); if (was) [ctm, colour] = was; }
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.setFillRGBColor) colour = [...args].slice(0, 3);
    else if (fn === OPS.constructPath) {
      const [cmds, coords] = args;
      const subpaths = [];
      let cur = [];
      let k = 0;
      for (const c of cmds) {
        if (c === OPS.moveTo) { if (cur.length) subpaths.push(cur); cur = [at(ctm, coords[k], coords[k + 1])]; k += 2; }
        else if (c === OPS.lineTo) { cur.push(at(ctm, coords[k], coords[k + 1])); k += 2; }
        else if (c === OPS.curveTo) { for (let j = 0; j < 3; j += 1) { cur.push(at(ctm, coords[k], coords[k + 1])); k += 2; } }
        else if (c === OPS.rectangle) {
          if (cur.length) subpaths.push(cur);
          const [x, y, w, h] = [coords[k], coords[k + 1], coords[k + 2], coords[k + 3]];
          k += 4;
          subpaths.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => at(ctm, px, py)));
          cur = [];
        } else if (c === OPS.closePath) { if (cur.length) { subpaths.push(cur); cur = []; } }
      }
      if (cur.length) subpaths.push(cur);
      pending = { subpaths, colour: [...colour] };
    } else if (fn === OPS.fill || fn === OPS.eoFill) {
      if (pending?.subpaths.length) {
        const all = pending.subpaths.flat();
        shapes.push({
          subpaths: pending.subpaths,
          x0: Math.min(...all.map((p) => p[0])), x1: Math.max(...all.map((p) => p[0])),
          y0: Math.min(...all.map((p) => p[1])), y1: Math.max(...all.map((p) => p[1])),
          rings: pending.subpaths.length,
          ink: pending.colour.join(','),
        });
      }
      pending = null;
    }
  }
  // The page's text layer is the exhibitor index and a dozen big labels, so it
  // is no use for booth numbers — but five of those labels say EXHIBIT HALL
  // ENTRANCE, and where a floor is entered is worth more to the fit than any
  // amount of what is on it.
  const texts = (await page.getTextContent()).items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ text: it.str.trim(), x: it.transform[4], y: it.transform[5], width: it.width ?? 0, height: it.height ?? 0 }));
  return { shapes, texts };
}

/**
 * Where the sheet says you can get on to the floor.
 *
 * Each label is set beside the wall it names, reading along it, so the label's
 * middle pushed on to the nearest point of the carpet outline is the doorway
 * to within a few metres — which is finer than the outline itself is drawn.
 */
function entrancesOf(texts, carpet) {
  const found = texts.filter((t) => /EXHIBIT\s+HALL\s+ENTRANCE/i.test(t.text));
  return found.map((t) => {
    // Rotated labels carry their length in y rather than x; either way the
    // middle is half a label along whichever way it runs.
    const along = t.width || 0;
    const mid = t.height > t.width
      ? [t.x, t.y + along / 2]
      : [t.x + along / 2, t.y];
    let best = mid;
    let near = Infinity;
    for (let i = 0, j = carpet.length - 1; i < carpet.length; j = i, i += 1) {
      const [ax, ay] = carpet[j];
      const [bx, by] = carpet[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len = dx * dx + dy * dy;
      const t0 = len ? Math.max(0, Math.min(1, ((mid[0] - ax) * dx + (mid[1] - ay) * dy) / len)) : 0;
      const on = [ax + dx * t0, ay + dy * t0];
      const gap = Math.hypot(on[0] - mid[0], on[1] - mid[1]);
      if (gap < near) { near = gap; best = on; }
    }
    return { x: NUM(best[0]), y: NUM(best[1]), away: NUM(near) };
  });
}

/**
 * The exhibit floor's outline, off the sheet rather than off a guess.
 *
 * The widest single-ring fill in the carpet colour. The tinted feature blocks
 * — Art Show, Family Fun, Entrepreneurs Avenue — are drawn on top of it in a
 * different colour and do not compete; nothing else on the page is anywhere
 * near this size.
 */
function floorOf(shapes) {
  const carpets = shapes.filter((s) => s.ink === CARPET && s.rings === 1);
  if (!carpets.length) throw new Error(`no ${CARPET} fill on the page: is this the exhibit hall map?`);
  const widest = carpets.reduce((best, s) => (s.x1 - s.x0 > best.x1 - best.x0 ? s : best));
  if (widest.x1 - widest.x0 < 500) throw new Error('the carpet is too small to be the floor');
  return widest.subpaths[0];
}

const describe = (ring) => {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return `x ${Math.min(...xs).toFixed(0)}-${Math.max(...xs).toFixed(0)} y ${Math.min(...ys).toFixed(0)}-${Math.max(...ys).toFixed(0)}`;
};

/** Even-odd, on the shape's own middle. */
function standsOn(ring, s) {
  const x = (s.x0 + s.x1) / 2;
  const y = (s.y0 + s.y1) / 2;
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [px, py] = ring[i];
    const [qx, qy] = ring[j];
    if (py > y !== qy > y && x < ((qx - px) * (y - py)) / (qy - py) + px) odd = !odd;
  }
  return odd;
}

/** Coverage raster of a glyph, normalised to its own box, top row first. */
function raster(g, w = 12, h = 16, sub = 3) {
  const cov = new Float32Array(w * h);
  const sx = g.x1 - g.x0 || 0.5;
  const sy = g.y1 - g.y0;
  for (let py = 0; py < h; py += 1) {
    for (let s = 0; s < sub; s += 1) {
      const y = g.y1 - ((py + (s + 0.5) / sub) / h) * sy;
      const cuts = [];
      for (const sp of g.subpaths) {
        for (let i = 0, j = sp.length - 1; i < sp.length; j = i++) {
          const [ax, ay] = sp[i];
          const [bx, by] = sp[j];
          if (ay > y !== by > y) cuts.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      }
      cuts.sort((a, b) => a - b);
      for (let px = 0; px < w; px += 1) {
        const x = g.x0 + ((px + 0.5) / w) * sx;
        for (let c = 0; c + 1 < cuts.length; c += 2) {
          if (x >= cuts[c] && x <= cuts[c + 1]) { cov[py * w + px] += 1 / sub; break; }
        }
      }
    }
  }
  return cov;
}

const apart = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};

/** Greedy clustering: seed, absorb everything within `tol`, repeat. */
function cluster(rasters, tol = 0.06) {
  const taken = new Uint8Array(rasters.length);
  const out = [];
  for (;;) {
    const seed = taken.indexOf(0);
    if (seed === -1) break;
    const members = [];
    for (let i = 0; i < rasters.length; i += 1) {
      if (!taken[i] && apart(rasters[seed], rasters[i]) <= tol) { taken[i] = 1; members.push(i); }
    }
    out.push(members);
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Every line the sheet draws, as a raster, so that a stand can be found by
 * walking outwards from its number until something stops it.
 *
 * WHY NOT JUST TAKE THE RECTANGLES. Because they are not rectangles. A stand's
 * outline is drawn as its four sides, each a separate filled strip, and only
 * some of them happen to come out of the content stream as one closed path.
 * Booth 131's outline is four fragments and was never found; 131 then took the
 * nearest rectangle it could see, which was 129's, and the two were written
 * with the same middle and the same size. 150 rectangles ended up carrying
 * more than one number that way — 316 stands drawn on top of each other, which
 * is most of what was wrong with the last map.
 *
 * So nothing here looks for a rectangle. The lines are drawn into a raster,
 * the digits left out of it because they are inside the stands, and each stand
 * is then whatever its number can expand into.
 */
function wallsOf(shapes, glyphs, scale = 4) {
  const skip = new Set(glyphs);
  const walls = shapes.filter((s) => s.ink === INK && !skip.has(s));
  const points = walls.flatMap((s) => s.subpaths.flat());
  const x0 = Math.min(...points.map((p) => p[0]));
  const y0 = Math.min(...points.map((p) => p[1]));
  const w = Math.ceil((Math.max(...points.map((p) => p[0])) - x0) * scale) + 2;
  const h = Math.ceil((Math.max(...points.map((p) => p[1])) - y0) * scale) + 2;
  const px = new Uint8Array(w * h);
  const mark = (ax, ay, bx, by) => {
    // The sides are drawn, not filled: a strip 0.7 pt thick is two pixels here
    // and a scan-fill sampling at pixel centres can step straight over it.
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * scale));
    for (let i = 0; i <= steps; i += 1) {
      const x = Math.round((ax + ((bx - ax) * i) / steps - x0) * scale);
      const y = Math.round((ay + ((by - ay) * i) / steps - y0) * scale);
      if (x >= 0 && x < w && y >= 0 && y < h) px[y * w + x] = 1;
    }
  };
  for (const s of walls) {
    for (const sp of s.subpaths) {
      for (let i = 0; i < sp.length; i += 1) {
        const a = sp[i];
        const b = sp[(i + 1) % sp.length];
        mark(a[0], a[1], b[0], b[1]);
      }
    }
  }
  return { px, w, h, x0, y0, scale };
}

/**
 * The stand each number stands on: every stand grows out from its number, a
 * pixel at a time, until it meets a drawn line or another stand.
 *
 * They grow *together* rather than one at a time, and that is the whole point.
 * A stand grown to completion on its own will run straight through its
 * neighbour wherever the sheet leaves a side open — and the sheet does, often,
 * because a stand's outline is four separate strips and the ones on an aisle
 * are frequently not closed. Growing them all at once and refusing any step
 * that would cross another makes overlapping impossible rather than unlikely:
 * two stands can meet, they cannot pass.
 */
function footprints(numbers, walls) {
  const { px, w, h, x0, y0, scale } = walls;
  const clear = (ax, ay, bx, by) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let i = 0; i <= steps; i += 1) {
      const x = Math.round(ax + ((bx - ax) * i) / steps);
      const y = Math.round(ay + ((by - ay) * i) / steps);
      if (x < 0 || x >= w || y < 0 || y >= h) return false;
      if (px[y * w + x]) return false;
    }
    return true;
  };
  const at = numbers.map((n) => [((n.x0 + n.x1) / 2 - x0) * scale, (n.y - y0) * scale]);
  const box = at.map(() => ({ l: 1, r: 1, u: 1, d: 1 }));
  /** Nothing fifteen booths away can ever be in the way. */
  const REACH = 15 * MODULE * scale;
  const near = at.map(([cx, cy], i) => at
    .map((p, j) => j)
    .filter((j) => j !== i && Math.abs(at[j][0] - cx) < REACH && Math.abs(at[j][1] - cy) < REACH));
  const hits = (i, side, step) => {
    const b = box[i];
    const l = at[i][0] - b.l - (side === 'l' ? step : 0);
    const r = at[i][0] + b.r + (side === 'r' ? step : 0);
    const d = at[i][1] - b.d - (side === 'd' ? step : 0);
    const u = at[i][1] + b.u + (side === 'u' ? step : 0);
    return near[i].some((j) => {
      const o = box[j];
      return l < at[j][0] + o.r && r > at[j][0] - o.l && d < at[j][1] + o.u && u > at[j][1] - o.d;
    });
  };
  const CAP = 14 * MODULE * scale;
  for (let grew = true; grew;) {
    grew = false;
    for (let i = 0; i < numbers.length; i += 1) {
      const b = box[i];
      const [cx, cy] = at[i];
      if (b.l < CAP && clear(cx - b.l - 1, cy - b.d, cx - b.l - 1, cy + b.u) && !hits(i, 'l', 1)) { b.l += 1; grew = true; }
      if (b.r < CAP && clear(cx + b.r + 1, cy - b.d, cx + b.r + 1, cy + b.u) && !hits(i, 'r', 1)) { b.r += 1; grew = true; }
      if (b.u < CAP && clear(cx - b.l, cy + b.u + 1, cx + b.r, cy + b.u + 1) && !hits(i, 'u', 1)) { b.u += 1; grew = true; }
      if (b.d < CAP && clear(cx - b.l, cy - b.d - 1, cx + b.r, cy - b.d - 1) && !hits(i, 'd', 1)) { b.d += 1; grew = true; }
    }
  }
  // Then out to the middle of the wall, which is where the boundary between
  // two stands actually is.
  //
  // A wall is drawn with a thickness, and growth stops at the face of it — so
  // both stands sharing a wall stop short by its whole width and each comes out
  // 12% under a whole booth. Splitting that gap puts the boundary on the wall's
  // middle, which is both the right answer and one that cannot overlap: two
  // stands facing each other each move half way, so they meet exactly.
  //
  // Not a snap to the 12-point module, which was tried and is wrong: it put
  // seven overlaps back, because the numbers are printed near their stands'
  // edges rather than in the middle and the lattice cannot be phased from them.
  /** Half a wall, so a side with nothing facing it does not run away. */
  const REACHOUT = 0.75 * scale;
  const gap = (i, side) => {
    const [cx, cy] = at[i];
    const b = box[i];
    let best = Infinity;
    for (const j of near[i]) {
      const o = box[j];
      const overlapsX = cx - b.l < at[j][0] + o.r && cx + b.r > at[j][0] - o.l;
      const overlapsY = cy - b.d < at[j][1] + o.u && cy + b.u > at[j][1] - o.d;
      // Only what is actually on that side. Taking the nearest of everything
      // in line finds the neighbour behind you, at a negative distance, and
      // every stand then stays exactly where it was.
      let away = null;
      if (side === 'l' && overlapsY) away = cx - b.l - (at[j][0] + o.r);
      if (side === 'r' && overlapsY) away = at[j][0] - o.l - (cx + b.r);
      if (side === 'd' && overlapsX) away = cy - b.d - (at[j][1] + o.u);
      if (side === 'u' && overlapsX) away = at[j][1] - o.d - (cy + b.u);
      if (away !== null && away >= 0) best = Math.min(best, away);
    }
    return Math.min(REACHOUT, best / 2);
  };
  return box.map((b, i) => {
    const l = b.l + gap(i, 'l');
    const r = b.r + gap(i, 'r');
    const d = b.d + gap(i, 'd');
    const u = b.u + gap(i, 'u');
    return {
      rx: NUM(at[i][0] / scale + x0 + (r - l) / 2 / scale),
      ry: NUM(at[i][1] / scale + y0 + (u - d) / 2 / scale),
      across: NUM((l + r) / scale / MODULE),
      along: NUM((u + d) / scale / MODULE),
    };
  });
}

const meanOf = (members, rasters) => {
  const mean = new Float32Array(rasters[0].length);
  for (const m of members) for (let k = 0; k < mean.length; k += 1) mean[k] += rasters[m][k] / members.length;
  return mean;
};

/**
 * What each glyph is, as the nearest of the ten shapes rather than as
 * whichever cluster happened to absorb it.
 *
 * Clustering finds the ten shapes; it is a poor way to *apply* them. A cluster
 * exists because nothing absorbed its seed, and the seed is an arbitrary
 * member — so the same digit drawn a shade heavier can sit far enough from one
 * particular specimen to start an eleventh cluster, and reading the sheet by
 * cluster then throws those glyphs away. That happened here: an eleventh
 * cluster of 36 glyphs, which is 36 booth numbers quietly losing a digit and
 * some of them still looking like booth numbers afterwards.
 *
 * So the clusters are used only to derive ten means, and every glyph is then
 * measured against those. A mean is a far better specimen than any one member.
 * What stays unread is what is not close to any digit, which is what the
 * handful of stray label letters should be.
 */
function readGlyphs(rasters, groups, tol = 0.06) {
  const means = groups.slice(0, DIGITS.length).map((members) => meanOf(members, rasters));
  const digitAt = new Map();
  let unread = 0;
  rasters.forEach((r, i) => {
    let best = -1;
    let near = Infinity;
    means.forEach((mean, d) => {
      const gap = apart(mean, r);
      if (gap < near) { near = gap; best = d; }
    });
    if (near <= tol) digitAt.set(i, DIGITS[best]);
    else unread += 1;
  });
  return { digitAt, unread };
}

/**
 * The cluster means, side by side, big enough to read.
 *
 * `DIGITS` is the one thing here a machine did not decide, so it needs a way
 * to be checked and — when the clustering shifts, which it does as soon as the
 * glyphs going into it change — a way to be read again. Each cluster is drawn
 * as its average coverage, in the order `DIGITS` indexes.
 */
function digitSheet(groups, rasters, w = 12, h = 16, zoom = 14, pad = 26) {
  const cols = groups.length;
  const W = cols * (w * zoom + pad) + pad;
  const H = h * zoom + pad * 2 + 10 * zoom;
  const px = new Uint8Array(W * H * 4).fill(255);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  groups.forEach((members, c) => {
    const mean = new Float32Array(w * h);
    for (const m of members) for (let k = 0; k < mean.length; k += 1) mean[k] += rasters[m][k] / members.length;
    const left = pad + c * (w * zoom + pad);
    for (let y = 0; y < h * zoom; y += 1) {
      for (let x = 0; x < w * zoom; x += 1) {
        const v = 255 - Math.round(255 * mean[Math.floor(y / zoom) * w + Math.floor(x / zoom)]);
        const at = ((y + pad) * W + left + x) * 4;
        px[at] = v; px[at + 1] = v; px[at + 2] = v;
      }
    }
    // A tally under each column, so the picture also says which cluster is
    // which without counting across.
    for (let t = 0; t <= c && t < 10; t += 1) {
      for (let y = 0; y < zoom - 2; y += 1) {
        for (let x = 0; x < zoom - 2; x += 1) {
          const at = ((h * zoom + pad * 2 + t * zoom + y) * W + left + x) * 4;
          px[at] = 0; px[at + 1] = 0; px[at + 2] = 0;
        }
      }
    }
  });
  return { width: W, height: H, pixels: px };
}

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) throw new Error('usage: node scripts/read-booth-map.mjs <exhibithallmap.pdf> [--digits]');
  const showDigits = process.argv.includes('--digits');

  const { shapes, texts } = await shapesOf(pdfPath);
  const carpet = floorOf(shapes);
  console.log(`carpet: ${carpet.length} corners, ${describe(carpet)}`);
  const entrances = entrancesOf(texts, carpet);
  console.log(`entrances: ${entrances.length}, each within ${Math.max(...entrances.map((e) => e.away)).toFixed(1)} pt of the wall`);
  if (entrances.length < 4) throw new Error(`only ${entrances.length} entrances found; the fit is anchored on them`);
  const grid = shapes.filter((s) => s.ink === INK && standsOn(carpet, s));
  const tall = (s) => s.y1 - s.y0;
  const wide = (s) => s.x1 - s.x0;

  const glyphs = grid.filter((s) => tall(s) > 3.8 && tall(s) < 4.8 && wide(s) < 4.5);
  console.log(`${shapes.length} filled paths -> ${grid.length} on the floor, ${glyphs.length} digit-shaped glyphs`);

  const rasters = glyphs.map((g) => raster(g));
  const groups = cluster(rasters);
  console.log(`clusters: ${groups.length}, sizes ${groups.slice(0, 14).map((g) => g.length).join(' ')}`);
  if (showDigits) {
    // A couple past the named ones, so the picture also shows what was left
    // out and whether leaving it out was right.
    const sheet = digitSheet(groups.slice(0, DIGITS.length + 2), rasters);
    const to = join(ROOT, 'digits.png');
    writeFileSync(to, encodePng(sheet.width, sheet.height, sheet.pixels));
    console.log(`${to}: the cluster means, in DIGITS order`);
  }
  const { digitAt, unread } = readGlyphs(rasters, groups);
  console.log(`read ${digitAt.size} glyphs as digits, ${unread} too unlike any of the ten`);

  // Lines by baseline proximity, not by rounding to a grid: a line that
  // straddles a rounding boundary comes apart, and that cost 89 numbers.
  const marked = glyphs
    .map((g, i) => ({ d: digitAt.get(i), x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y1 }))
    .filter((g) => g.d !== undefined)
    .sort((a, b) => b.y0 - a.y0);
  let line = -1;
  let top = Infinity;
  for (const g of marked) {
    if (top - g.y0 > 0.5) { line += 1; top = g.y0; }
    g.line = line;
  }
  marked.sort((a, b) => a.line - b.line || a.x0 - b.x0);

  const runs = [];
  let run = null;
  for (const g of marked) {
    if (run && g.line === run.line && g.x0 - run.lastX0 < 4) {
      run.text += g.d;
      run.advances.push(g.x0 - run.lastX0);
      run.at.push(g.x0);
      run.lastX0 = g.x0;
      run.x1 = g.x1;
    } else {
      if (run) runs.push(run);
      run = { text: g.d, x0: g.x0, x1: g.x1, y: (g.y0 + g.y1) / 2, lastX0: g.x0, advances: [], at: [g.x0], line: g.line };
    }
  }
  if (run) runs.push(run);

  const cut = (r) => {
    if (r.text.length <= 4) return [r];
    let where = 3;
    let widest = -Infinity;
    for (let i = 3; i <= 4 && r.text.length - i >= 3; i += 1) {
      if (r.advances[i - 1] > widest) { widest = r.advances[i - 1]; where = i; }
    }
    const left = { ...r, text: r.text.slice(0, where), x0: r.at[0], x1: r.at[where - 1] + 2.6, at: r.at.slice(0, where), advances: r.advances.slice(0, where - 1) };
    const right = { ...r, text: r.text.slice(where), x0: r.at[where], at: r.at.slice(where), advances: r.advances.slice(where) };
    return [left, ...cut(right)];
  };
  // A booth number is at least three digits. Anything shorter is a stray
  // glyph — a letter from a label that happened to be the same height, or one
  // digit of a number whose neighbours were filtered out — and it would only
  // ever match a booth that does not exist.
  const numbers = runs.flatMap(cut).filter((n) => n.text.length >= 3);
  const lengths = new Map();
  for (const n of numbers) lengths.set(n.text.length, (lengths.get(n.text.length) ?? 0) + 1);
  console.log(`numbers: ${numbers.length}, by length ${[...lengths].sort().map(([l, n]) => `${l}:${n}`).join(' ')}`);

  // Each number takes the stand rectangle it sits in or nearest to, and BOTH
  // positions are kept, because they are answers to different questions.
  //
  // The number says *which* stand: it is printed at the booth's own position
  // along its aisle, and it is what makes the aisles come out straight when
  // `fit-booths.mjs` lays a hall down. The rectangle says *what the stand is*:
  // its outline, which for a 2x9 island runs twelve metres from the number
  // printed on it. Fit on the first and draw the second — using the rectangle
  // to fit costs half the aisle correlation, and using the number to draw puts
  // a ninety-foot stand's outline in the wrong place.
  const walls = wallsOf(shapes, glyphs);
  const shapesOfStand = footprints(numbers, walls);
  let moved = 0;
  const booths = numbers.map((n, i) => {
    const cx = (n.x0 + n.x1) / 2;
    const own = shapesOfStand[i];
    moved = Math.max(moved, Math.hypot(own.rx - cx, own.ry - n.y));
    return {
      booth: n.text,
      x: NUM(cx),
      y: NUM(n.y),
      rx: own.rx,
      ry: own.ry,
      across: own.across,
      along: own.along,
    };
  });
  console.log(`the furthest a number sits from the middle of its own stand: ${moved.toFixed(1)} pt (${(moved * 3.048 / MODULE).toFixed(1)} m)`);

  const sizes = new Map();
  for (const b of booths) sizes.set(`${b.across}x${b.along}`, (sizes.get(`${b.across}x${b.along}`) ?? 0) + 1);
  console.log(`stand sizes: ${[...sizes].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, n]) => `${s}:${n}`).join(' ')}`);

  booths.sort((a, b) => Number(a.booth) - Number(b.booth));

  // The answer sheet, and the reason this refuses rather than reports.
  //
  // A misread does not look like a failure. Get `DIGITS` out of order — which
  // is what happens when the clustering shifts under it — and every number is
  // still three or four digits, still on a stand, still plausible. That went
  // out as a file once, 26% right and silent about it, so agreement with the
  // independently-pulled list is checked here and a bad reading is not written
  // at all.
  const listed = new Set(
    readFileSync(join(ROOT, 'src/data/exhibitors.ts'), 'utf8')
      .matchAll(/\bbooth: '([^']+)'/g),
  );
  const known = new Set([...listed].map((m) => m[1]));
  const agreed = booths.filter((b) => known.has(b.booth)).length;
  const rate = agreed / booths.length;
  console.log(`${agreed}/${booths.length} = ${(rate * 100).toFixed(1)}% are booths exhibitors.ts lists`);
  if (rate < 0.95) {
    throw new Error(
      `only ${(rate * 100).toFixed(1)}% of the numbers read are booths anyone has taken, so this reading is wrong `
      + 'and has not been written. The usual cause is DIGITS being out of order after the clustering shifted: '
      + 're-run with --digits and read the picture again.',
    );
  }

  const source = `/**
 * Every stand on Gen Con's printed exhibit-hall map.
 *
 * Generated by scripts/read-booth-map.mjs — do not edit by hand. That script
 * carries the method and the checking; this is only its answer.
 *
 * The map has no text on it: the booth numbers are outlines, and these were
 * read by clustering ${glyphs.length.toLocaleString('en')} glyph shapes into ten digits. ${(rate * 100).toFixed(1)}% of what
 * came out is a booth number \`exhibitors.ts\` independently lists, which is
 * what makes the reading believable.
 *
 * \`x\` and \`y\` are PAGE POINTS, and the page is drawn to scale: 12 points is
 * a ten-foot booth everywhere on it, and the whole exhibit floor is one
 * to-scale plan — the carpet outline is 282.2 m across against the building's
 * 282.5 m. So these do turn into coordinates, and \`fit-booths.mjs\` turns them
 * with a single rigid transform. They are still page points here because
 * reading the sheet and placing it are separate jobs.
 *
 * \`across\` and \`along\` are the stand's size in ten-foot booths, so 1×1 is a
 * single booth and 2×4 is an eight-booth island.
 */

export interface PlannedBooth {
  /** As printed. Matches \`Exhibitor.booth\` where the stand is let. */
  booth: string;
  /** Where the number is printed. Page points, NOT a position on the ground. */
  x: number;
  y: number;
  /** The middle of the stand's own rectangle, which is not where its number is. */
  rx: number;
  ry: number;
  /** The stand's size in ten-foot booths. 0 where no rectangle was near it. */
  across: number;
  along: number;
}

export const PLANNED_BOOTHS: ReadonlyArray<PlannedBooth> = [
${booths.map((b) => `  { booth: '${b.booth}', x: ${b.x}, y: ${b.y}, rx: ${b.rx}, ry: ${b.ry}, across: ${b.across}, along: ${b.along} },`).join('\n')}
];

/**
 * The carpet: the exhibit floor's own outline, in the same page points.
 *
 * The single filled polygon the sheet draws the floor as. It is ${describe(carpet).replace(/\s+/g, ' ')}
 * points, which at the printed module is ${((Math.max(...carpet.map((p) => p[0])) - Math.min(...carpet.map((p) => p[0]))) * 3.048 / MODULE).toFixed(1)} m across, and the six
 * halls together measure ${'282.5'} m. That agreement is why the whole sheet can be
 * laid down as one piece.
 */
export const PLAN_FLOOR: ReadonlyArray<readonly [number, number]> = [
${carpet.map(([x, y]) => `  [${NUM(x)}, ${NUM(y)}],`).join('\n')}
];

/**
 * The five ways on to the floor, each pushed from its label on to the wall it
 * names. Page points. These are what the placement is lined up by.
 */
export const PLAN_ENTRANCES: ReadonlyArray<{ x: number; y: number }> = [
${entrances.map((e) => `  { x: ${e.x}, y: ${e.y} },`).join('\n')}
];
`;
  writeFileSync(OUT, source);
  console.log(`${OUT}: ${booths.length} stands, ${(source.length / 1024) | 0} KB`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
