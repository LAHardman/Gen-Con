/**
 * Ask what a room costs, within the month's free allowances.
 *
 *     node scripts/fetch-rates.mjs --dry     # plan only, no requests, no writes
 *     node scripts/fetch-rates.mjs
 *
 * Reads `src/data/rate-store.json`, spends what quota there is, writes it back.
 * The ledger of what has been spent lives in that same file, because a
 * repository is the only store this app has and adding a database for a counter
 * would be the largest dependency in the project.
 *
 * RUN `--dry` FIRST, AND AGAIN AFTER ANY SERVICE CHANGES ITS API. None of the
 * four request shapes in `sources.mjs` has ever been run against the live
 * service — every one of those hosts was unreachable from the machine this was
 * written on. A dry run prints who would be asked, in what order, and what it
 * would cost, without spending anything.
 *
 * CREDENTIALS come from the environment and none are required: a source with no
 * key takes itself out of the running, and the run proceeds with the rest. That
 * is the same path as a source being down, which is deliberate — there is only
 * one degraded mode to reason about, and it is exercised every time somebody
 * runs this without a key.
 *
 *   SERPAPI_KEY, AMADEUS_KEY + AMADEUS_SECRET, APIFY_TOKEN + APIFY_ACTOR
 *   RATES_QUOTA_<SOURCE>=n   correct an allowance
 *   RATES_OFF_<SOURCE>=1     switch one off
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { planRun } from './lib/rates/plan.mjs';
import { budget, ledgerFor, SOURCES } from './lib/rates/quota.mjs';
import { runOnce } from './lib/rates/run.mjs';
import { ALL } from './lib/rates/sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = join(ROOT, 'src/data/rate-store.json');
const OUT = join(ROOT, 'src/data/rates.ts');

const dry = process.argv.includes('--dry');
const now = Date.now();
const env = process.env;

/**
 * Reading the inventory out of TypeScript without a compiler.
 *
 * Node cannot import a `.ts` module and this script must run under bare `node`
 * in a workflow, so the generated file is parsed rather than imported. That is
 * only safe because `fetch-lodging.mjs` writes it in exactly one shape — and it
 * throws rather than proceeding on an empty parse, so a change to that shape
 * stops the run instead of quietly pricing nothing.
 */
function readLodging() {
  const source = readFileSync(join(ROOT, 'src/data/lodging.ts'), 'utf8');
  const rows = [];
  const shape =
    /\{ id: '([^']+)', name: (".*?"), kind: '([^']+)', metres: (\d+), ring: '(walk|drive)', lat: ([-\d.]+), lng: ([-\d.]+)(.*?) \},/g;
  let found;
  while ((found = shape.exec(source))) {
    const [, id, name, kind, metres, ring, lat, lng, tail] = found;
    rows.push({
      id,
      name: JSON.parse(name),
      kind,
      metres: Number(metres),
      ring,
      lat: Number(lat),
      lng: Number(lng),
      brand: tail.match(/brand: (".*?")/)?.[1] ? JSON.parse(tail.match(/brand: (".*?")/)[1]) : '',
      stars: tail.match(/stars: '([^']*)'/)?.[1] ?? '',
      city: tail.match(/city: (".*?")/)?.[1] ? JSON.parse(tail.match(/city: (".*?")/)[1]) : '',
    });
  }
  if (rows.length === 0) throw new Error('no lodging parsed — run scripts/fetch-lodging.mjs first');
  return rows;
}

/**
 * The hotels Gen Con publishes a rate for, read out of the generated file.
 *
 * Never worth a request: Gen Con's own page is free, official, and better than
 * anything a rate API would sell. With the block covering two thirds of the
 * walk ring, this is the single biggest saving available.
 */
function readBlockIds() {
  const source = readFileSync(join(ROOT, 'src/data/partners.ts'), 'utf8');
  const ids = new Set([...source.matchAll(/placeId: '([^']+)'/g)].map((one) => one[1]));
  const suspected = source.match(/SUSPECTED_IN_BLOCK[^=]*= new Set\((\[[^\]]*\])\)/s)?.[1];
  if (suspected) for (const id of JSON.parse(suspected)) ids.add(id);
  return ids;
}

const places = readLodging();
const inBlock = readBlockIds();

let store = { quotes: [], ledger: null, keys: {} };
try {
  store = { ...store, ...JSON.parse(readFileSync(STORE, 'utf8')) };
} catch {
  console.error('no store yet — starting one');
}

const ledger = ledgerFor(store.ledger, now);
const budgets = budget(ledger, env);

console.error(
  `\n${places.length} places (${places.filter((one) => one.ring === 'walk').length} walkable), ` +
    `${inBlock.size} of them published by Gen Con and never asked about`,
);
console.error(`month ${ledger.month}, allowances left:`);
for (const [name, left] of Object.entries(budgets)) {
  const source = ALL.find((one) => one.name === name);
  const why = !source?.ready(env) ? ' — not configured, will be skipped' : '';
  console.error(`  ${name.padEnd(8)} ${String(left).padStart(5)} ${SOURCES[name].unit}s${why}`);
}

if (dry) {
  const plan = planRun({
    places,
    quotes: store.quotes,
    budgets,
    whenMs: now,
    tried: ledger.tried,
    inBlock,
  });
  console.error(`\nwould ask about ${plan.tasks.length} — ${plan.reason}`);
  for (const task of plan.tasks.slice(0, 25)) {
    console.error(`  ${task.why.padEnd(16)} ${task.place.metres.toString().padStart(6)} m  ${task.place.name}`);
  }
  if (plan.tasks.length > 25) console.error(`  … and ${plan.tasks.length - 25} more`);
  console.error('\ndry run: nothing was requested and nothing was written');
  process.exit(0);
}

const result = await runOnce({
  places,
  quotes: store.quotes,
  ledger,
  keys: store.keys,
  env,
  whenMs: now,
  inBlock,
  log: (line) => console.error(line),
});

writeFileSync(
  STORE,
  `${JSON.stringify({ quotes: result.quotes, ledger: result.ledger, keys: store.keys }, null, 1)}\n`,
  'utf8',
);

/*
 * The app reads a generated module rather than the JSON, for the same reason
 * every other dataset here is a module: it is type-checked, it is in the bundle,
 * and it works with no network on a convention floor.
 */
const byPlace = new Map();
for (const quote of result.quotes) {
  if (!byPlace.has(quote.placeId)) byPlace.set(quote.placeId, []);
  byPlace.get(quote.placeId).push(quote);
}

const rows = [...byPlace.entries()]
  .map(([placeId, quotes]) => {
    const cheapest = quotes.reduce((low, one) => (one.nightly < low.nightly ? one : low));
    const newest = quotes.reduce((late, one) => (Date.parse(one.at) > Date.parse(late.at) ? one : late));
    return {
      placeId,
      nightly: cheapest.nightly,
      currency: cheapest.currency ?? 'USD',
      sources: [...new Set(quotes.map((one) => one.source))].sort(),
      at: newest.at.slice(0, 10),
      spread:
        quotes.length > 1
          ? Math.round(Math.max(...quotes.map((one) => one.nightly)) - cheapest.nightly)
          : 0,
    };
  })
  .sort((a, b) => a.nightly - b.nightly);

writeFileSync(
  OUT,
  `/**
 * What a room costs, generated by \`scripts/fetch-rates.mjs\`.
 *
 * DO NOT EDIT BY HAND — re-run the script.
 *
 * One row per place, carrying the **cheapest** quote anybody had and the date of
 * the newest. \`sources\` is who was asked, because a price is worth as much as
 * its provenance, and \`spread\` is the gap between the dearest and cheapest
 * quotes for the same place — the honest width of the number.
 *
 * These are indicative nightly rates for a sample night, gathered on free tiers
 * of commercial services. **They are not the Gen Con block rate**, which is
 * behind a badge purchase and a login and cannot be fetched at all.
 */

export interface Rate {
  placeId: string;
  /** The cheapest anybody quoted, per night. */
  nightly: number;
  currency: string;
  /** Who answered. More than one is a stronger number than one. */
  sources: string[];
  /** The newest quote's date, so the page can say how old this is. */
  at: string;
  /** Dearest minus cheapest across sources. Zero when only one answered. */
  spread: number;
}

/** When this file was last written, whether or not anything changed. */
export const REFRESHED = '${new Date(now).toISOString().slice(0, 10)}';

/** The cheapest walkable rate — the cap the drive ring was gathered under. */
export const WALK_FLOOR: number | null = ${result.floor ?? 'null'};

/** Cheapest first. */
export const RATES: ReadonlyArray<Rate> = [
${rows.map((row) => `  ${JSON.stringify(row)},`).join('\n')}
];

const BY_PLACE = new Map(RATES.map((rate) => [rate.placeId, rate]));

export const rateFor = (placeId: string): Rate | null => BY_PLACE.get(placeId) ?? null;
`,
  'utf8',
);

console.error(`\nwrote ${rows.length} rates to ${OUT}`);
if (Object.keys(result.down).length) {
  console.error(`down this run: ${Object.entries(result.down).map(([n, why]) => `${n} (${why})`).join(', ')}`);
}
