/**
 * Assembles the data pack: the tables a running copy can refresh itself from.
 *
 *     npm run build:pack
 *
 * Writes `public/pack/` — each table copied verbatim from `src/data/`, plus a
 * `manifest.json` naming every table with its hash and size. Vite copies
 * `public/` into the build, so the pack publishes with the site at
 * `<site>/pack/`, and a copy of the app checks the manifest (a few hundred
 * bytes) to learn whether anything moved before fetching a byte of table.
 *
 * The tables are the same JSON files the bundle compiles in as its snapshot
 * — one source, two consumers — so the pack can never disagree with the app
 * that shipped alongside it. `src/data/pack.ts` is the other half: the
 * reader, the schema gate, and the rule for what a copy does when the pack
 * stops being reachable (keeps its snapshot, for ever).
 *
 * Not committed (`public/pack/` is gitignored): it is assembled by `npm run
 * build` from files that are.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/pack');

/**
 * Tables whose source of truth is already JSON under `src/data/`. These are
 * the ones CI refreshes on a schedule, where a one-row-per-line diff is
 * worth having and the generator writes the file directly.
 */
const JSON_TABLES = ['config', 'exhibitors', 'partners'];

/**
 * Tables extracted from the compiled modules, by constant name.
 *
 * These are big generated literals with derivations built on top of them —
 * floor plans, booth grids, pavements. Moving each to a JSON source would
 * mean rewriting its generator, and every one of those generators has
 * properties worth not disturbing. So the literal stays the source of truth
 * and the snapshot in the binary, this lifts a copy into the pack, and
 * `fromPack` lays it back over at runtime. Derived constants are never
 * listed: they are recomputed from whatever the overlay produced.
 */
const MODULE_TABLES = {
  'venue-plan': ['VENUE_HALLS', 'VENUE_VERTICAL', 'VENUE_ROOM_SHAPES'],
  'plan-geometry': ['PLAN_SHAPES', 'PLAN_DETAIL', 'PLAN_LEVELS', 'PLAN_OUTLINE'],
  lodging: ['LODGING', 'PULLED'],
  rates: ['RATES', 'REFRESHED', 'STAY', 'WALK_FLOOR'],
  listings: ['LISTINGS', 'FOUND'],
  'booth-place': ['PLACED_BOOTHS'],
  'booth-plan': ['PLANNED_BOOTHS', 'PLAN_FLOOR', 'PLAN_ENTRANCES'],
  eateries: ['EATERIES', 'PULLED'],
  pavements: ['PAVEMENT_NODES', 'PAVEMENT_EDGES'],
  addresses: ['ADDRESSES'],
  footprints: ['VENUE_FOOTPRINTS'],
  booths: ['HALL_DIVIDES', 'ACROSS_THE_AISLES'],
  // Not a generated literal like the rest — six numbers off a web page — but
  // here for the same reason and more urgently: badge and parking prices are
  // the figures that change every year, on pages anybody can read, and a
  // phone that can no longer be updated through a store can still take them
  // from a pack refresh.
  'badge-prices': [
    'BADGE_CENTS',
    'BADGE_PRICE_YEAR',
    'BADGE_PRICES_CHECKED',
    'ADMISSIONS_TAX',
    'SHIPPING_CENTS',
  ],
  parking: ['GARAGES', 'CHECKED'],
};

/**
 * The schema a reader must share to apply these tables. Bump it ONLY for a
 * change an old reader would misread — a renamed field, a re-keyed table.
 * Additive changes never bump it: every reader ignores what it doesn't
 * know, and installed copies that can never update again are the ones that
 * pay for a bump, by keeping their snapshot instead of refreshing.
 */
const SCHEMA = 1;

mkdirSync(OUT, { recursive: true });

const manifest = { schema: SCHEMA, generatedAt: new Date().toISOString(), tables: {} };

/** One table into the pack, and into the manifest that describes it. */
function put(name, body) {
  writeFileSync(join(OUT, `${name}.json`), body);
  manifest.tables[name] = {
    hash: createHash('sha256').update(body).digest('hex').slice(0, 16),
    bytes: body.length,
  };
}

for (const name of JSON_TABLES) {
  put(name, readFileSync(join(ROOT, `src/data/${name}.json`)));
}

for (const [name, constants] of Object.entries(MODULE_TABLES)) {
  const module = await import(join(ROOT, `src/data/${name}.ts`));
  const table = {};
  for (const constant of constants) {
    if (module[constant] === undefined) {
      throw new Error(`${name}.ts no longer exports ${constant}; the pack would ship it empty`);
    }
    table[constant] = module[constant];
  }
  // Compact rather than pretty: nothing reads these by eye, and a phone
  // downloads them. Key order follows the module, so an unchanged module
  // hashes the same and installed copies do not re-fetch it.
  put(name, Buffer.from(`${JSON.stringify(table)}\n`));
}
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `public/pack: ${Object.keys(manifest.tables).length} tables, ` +
    `${Object.values(manifest.tables)
      .reduce((sum, table) => sum + table.bytes, 0)
      .toLocaleString()} bytes, schema ${SCHEMA}`,
);
