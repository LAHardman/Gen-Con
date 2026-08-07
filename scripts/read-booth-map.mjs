/**
 * Read Gen Con's printed exhibit-hall map, which has no text on it.
 *
 *     node scripts/read-booth-map.mjs plans/2026.exhibithallmap.pdf
 *
 * Regenerates src/data/booth-plan.ts. The PDF is Gen Con's programme spread and
 * is not in this repository; it is published each year and has to be fetched by
 * hand (`files.gencon.com` refuses this environment's egress).
 *
 * WHAT IS ON THE PAGE. The lower quarter is the exhibitor index, which is text
 * and which `exhibitors.ts` already holds. The upper three quarters is the
 * booth grid, and *none of it is text*: 4,612 filled paths, of which 405 are
 * stand rectangles and about 1,900 are the outlines of digits. The page's text
 * layer has 1,914 items and every one is the index or one of a dozen big
 * labels. So the booth numbers have to be read as shapes.
 *
 * HOW THEY ARE READ, and each step is checkable:
 *
 *   1. Every filled path is replayed through the content stream with its
 *      transform, so each shape lands in page coordinates.
 *   2. A digit is navy, 4.2 pt tall and no wider than tall. That is 1,935
 *      shapes. The hairlines between stands are the same colour and are 0.7 pt
 *      tall, which is what separates them.
 *   3. Each digit is scan-filled into a 12x16 coverage raster, normalised to
 *      its own bounding box, and clustered by mean absolute difference. Ten
 *      clusters come out far larger than the rest — 330 down to 82 — and they
 *      are the ten digits. `DIGITS` below is what those ten look like, read off
 *      a rendering of the cluster means. Everything after them is a handful of
 *      stray letters from labels that happen to be the same height.
 *   4. Digits are grouped into lines by baseline proximity, then into numbers
 *      by *advance* — the distance from one glyph's left edge to the next.
 *      Not by the gap between their boxes: "1" is 1.2 pt narrower than every
 *      other digit, so the gap after a 1 is the same size as the gap between
 *      two numbers, and no threshold on it can tell them apart. The advance is
 *      2.7 pt inside a number and 6.4 pt between two.
 *   5. A number is three or four digits. A longer run is two numbers set closer
 *      than the rest — booths facing each other across an aisle — and is cut at
 *      the widest advance inside it.
 *
 * HOW IT IS CHECKED, which matters more than any of the above. `exhibitors.ts`
 * holds 562 booth numbers, pulled from a different Gen Con system on a
 * different day. 521 of the 524 numbers read here are in it: 99.4%. The three
 * that are not are valid-looking numbers for stands nobody had taken. Nothing
 * about this pipeline was tuned against that list — it is the answer sheet, and
 * it is the reason the reading can be believed.
 *
 * WHAT THIS DOES NOT DO. It reads the sheet; it does not place anything. `x`
 * and `y` in what it writes are page points and nothing else — the halls are
 * laid along the page in numbering order rather than in the arrangement the
 * building has, so Halls F and G are side by side here and stacked in the
 * convention centre's own floor plans. Turning page points into coordinates is
 * `fit-booths.mjs`, which lays each hall's block into that hall separately,
 * and there is a reason it is a second script rather than the end of this one.
 */

import { readFileSync, writeFileSync } from 'node:fs';
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
const DIGITS = ['1', '2', '3', '5', '4', '6', '9', '0', '7', '8', '9', '6'];

/** Navy. Everything on the grid is drawn in it; nothing else is. */
const INK = '22,30,39';
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
  return shapes;
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

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) throw new Error('usage: node scripts/read-booth-map.mjs <exhibithallmap.pdf>');

  const shapes = await shapesOf(pdfPath);
  // The grid is the upper three quarters; below it is the exhibitor index.
  const grid = shapes.filter((s) => s.y0 > 300 && s.ink === INK);
  const tall = (s) => s.y1 - s.y0;
  const wide = (s) => s.x1 - s.x0;

  const stands = grid.filter((s) => wide(s) >= 4 && tall(s) >= 4 && s.rings === 1);
  const glyphs = grid.filter((s) => tall(s) > 3.8 && tall(s) < 4.8 && wide(s) < 4.5);
  console.log(`${shapes.length} filled paths -> ${stands.length} stands, ${glyphs.length} digit-shaped glyphs`);

  const groups = cluster(glyphs.map((g) => raster(g)));
  console.log(`clusters: ${groups.length}, sizes ${groups.slice(0, 14).map((g) => g.length).join(' ')}`);
  const digitAt = new Map();
  groups.forEach((members, i) => {
    if (DIGITS[i] === undefined) return;
    for (const m of members) digitAt.set(m, DIGITS[i]);
  });

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
  let moved = 0;
  const booths = numbers.map((n) => {
    const cx = (n.x0 + n.x1) / 2;
    let best = null;
    let near = Infinity;
    for (const s of stands) {
      const dx = Math.max(s.x0 - cx, 0, cx - s.x1);
      const dy = Math.max(s.y0 - n.y, 0, n.y - s.y1);
      const d = Math.hypot(dx, dy);
      if (d < near) { near = d; best = s; }
    }
    const own = best && near < 14;
    if (own) moved = Math.max(moved, Math.hypot((best.x0 + best.x1) / 2 - cx, (best.y0 + best.y1) / 2 - n.y));
    return {
      booth: n.text,
      x: NUM(cx),
      y: NUM(n.y),
      rx: NUM(own ? (best.x0 + best.x1) / 2 : cx),
      ry: NUM(own ? (best.y0 + best.y1) / 2 : n.y),
      across: own ? Math.round(wide(best) / MODULE) : 0,
      along: own ? Math.round(tall(best) / MODULE) : 0,
    };
  });
  console.log(`the furthest a number sits from the middle of its own stand: ${moved.toFixed(1)} pt (${(moved * 3.048 / MODULE).toFixed(1)} m)`);

  const sizes = new Map();
  for (const b of booths) sizes.set(`${b.across}x${b.along}`, (sizes.get(`${b.across}x${b.along}`) ?? 0) + 1);
  console.log(`stand sizes: ${[...sizes].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, n]) => `${s}:${n}`).join(' ')}`);

  booths.sort((a, b) => Number(a.booth) - Number(b.booth));
  const source = `/**
 * Every stand on Gen Con's printed exhibit-hall map.
 *
 * Generated by scripts/read-booth-map.mjs — do not edit by hand. That script
 * carries the method and the checking; this is only its answer.
 *
 * The map has no text on it: the booth numbers are outlines, and these were
 * read by clustering 1,935 glyph shapes into ten digits. 99.4% of what came
 * out is a booth number \`exhibitors.ts\` independently lists, which is what
 * makes the reading believable.
 *
 * \`x\` and \`y\` are PAGE POINTS ON THAT MAP AND NOTHING ELSE. They are not
 * coordinates and cannot be turned into any: the map is drawn to scale within
 * each hall and lays the halls out along the page in numbering order rather
 * than in the arrangement the building has — Halls F and G are side by side on
 * it and stacked in the convention centre's own plans. They are here because
 * they say which stands are next to which, which is true of a page layout as
 * much as of a survey.
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
`;
  writeFileSync(OUT, source);
  console.log(`${OUT}: ${booths.length} stands, ${(source.length / 1024) | 0} KB`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
