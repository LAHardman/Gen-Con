/**
 * How old is everything read from OpenStreetMap?
 *
 * Five tables come from OSM and nothing schedules their scripts — they run
 * when somebody remembers, which is the failure this whole check exists
 * for. Each has its own honest shelf life: a restaurant changes hours and
 * owners without telling anybody, so eateries sour in a year; pavements and
 * building footprints are surveyed geometry and hold for two. `--fix` runs
 * the eateries refresh here and now (one Overpass query, with fallbacks);
 * the rest are printed as the commands they are, because a lodging or
 * pavement refresh moves files worth reviewing rather than auto-committing.
 */

import { execFileSync } from 'node:child_process';
import type { Probe, ProbeResult } from '../lib';
import { daysBetween, lastCommitDate } from '../lib';
import { PULLED } from '../../../src/data/eateries';

const TABLES: ReadonlyArray<{ file: string; refresh: string; shelfDays: number; what: string }> = [
  { file: 'src/data/eateries.ts', refresh: 'npm run fetch:eateries', shelfDays: 365, what: 'restaurants and their hours' },
  { file: 'src/data/lodging.ts', refresh: 'node scripts/fetch-lodging.mjs', shelfDays: 365, what: 'the hotel inventory' },
  { file: 'src/data/addresses.ts', refresh: 'node scripts/fetch-addresses.mjs', shelfDays: 540, what: 'street addresses' },
  { file: 'src/data/pavements.ts', refresh: 'npm run fetch:pavements', shelfDays: 730, what: 'pavements and crossings' },
  { file: 'src/data/footprints.ts', refresh: 're-run the Overpass query recorded in the file\'s own header', shelfDays: 730, what: 'building footprints' },
];

export const probe: Probe = {
  id: 'osm-age',
  title: 'OpenStreetMap table ages',
  async run(ctx): Promise<ProbeResult> {
    const stale: string[] = [];
    const details: string[] = [];
    const instructions: string[] = [];

    for (const table of TABLES) {
      // Eateries record their own pull date; everything else is dated by its
      // last commit, which overstates freshness only when a hand-edit touched
      // the file — an error in the direction that nags, not the one that hides.
      const dated = table.file.endsWith('eateries.ts') ? PULLED : lastCommitDate(ctx.root, table.file);
      if (!dated) {
        details.push(`${table.file}: no date could be established (not in a git checkout?)`);
        continue;
      }
      const age = daysBetween(new Date(`${dated}T12:00:00Z`), ctx.now);
      details.push(`${table.file}: ${dated}, ${age} days ago (shelf ${table.shelfDays})`);
      if (age > table.shelfDays) {
        stale.push(table.file);
        instructions.push(`\`${table.refresh}\` re-reads ${table.what}; review the diff and commit.`);
      }
    }

    if (!stale.length) {
      return { status: 'ok', summary: 'every OSM-sourced table is inside its shelf life', details };
    }

    if (ctx.fix && stale.includes('src/data/eateries.ts')) {
      execFileSync('node', ['scripts/fetch-eateries.mjs'], { cwd: ctx.root, stdio: 'inherit' });
      return {
        status: 'warn',
        summary: 'stale OSM tables found; eateries have been re-fetched — review and commit, and run the listed commands for the rest',
        details,
        instructions,
      };
    }

    return {
      status: 'warn',
      summary: `${stale.length} OSM-sourced table${stale.length === 1 ? '' : 's'} past shelf life: ${stale.join(', ')}`,
      details,
      repair: ['`npm run season:check -- --fix` will run the eateries refresh itself; the others move files worth reviewing, so they stay commands.'],
      instructions,
    };
  },
};
