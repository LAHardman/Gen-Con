/**
 * Assembles the data pack: the tables a running copy can refresh itself from.
 *
 *     node scripts/build-pack.mjs
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
 * Every table in the pack. Adding one is one line here once its data lives
 * as JSON under `src/data/` — the recipe is in docs/mobile.md §3.
 */
const TABLES = ['config', 'exhibitors', 'partners'];

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
for (const name of TABLES) {
  const body = readFileSync(join(ROOT, `src/data/${name}.json`));
  writeFileSync(join(OUT, `${name}.json`), body);
  manifest.tables[name] = {
    hash: createHash('sha256').update(body).digest('hex').slice(0, 16),
    bytes: body.length,
  };
}
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `public/pack: ${TABLES.length} tables, ` +
    `${Object.values(manifest.tables)
      .reduce((sum, table) => sum + table.bytes, 0)
      .toLocaleString()} bytes, schema ${SCHEMA}`,
);
