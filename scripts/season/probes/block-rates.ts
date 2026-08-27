/**
 * Is the hotel block a year behind, and has Gen Con published the new one?
 *
 * `partners.ts` carries `BLOCK_YEAR`, and every figure on the Hotels page is
 * either that year's fact or arithmetic carried forward from it — including
 * `BLOCK_GROWTH`, which does more work each year it goes unmeasured. The
 * repair is one command, so with `--fix` this probe runs it; without, it
 * first *checks the page*, because "the block is old" and "the new block is
 * up" are different findings and only the second is actionable.
 */

import { execFileSync } from 'node:child_process';
import type { Probe } from '../lib';
import { withNetwork } from '../lib';
import { BLOCK_YEAR, SOURCE } from '../../../src/data/partners';
import { planningYear } from '../../../src/data/key-dates';

const INSTRUCTIONS = [
  'Run `npm run fetch:block-rates` — it re-reads the hotel map page into `src/data/partners.ts`, recomputing `BLOCK_YEAR` and `BLOCK_GROWTH` as it goes.',
  'Then `npm run check`: the pairing tests hold the block against the map ids, and a hotel Gen Con added is the usual thing they catch.',
  'If the script itself fails, the page has been restyled — `scripts/fetch-block-rates.mjs` documents the row shape it reads; open the live page beside that comment and adjust `readBlock()` to the new markup.',
];

export const probe: Probe = {
  id: 'block-rates',
  title: 'Hotel block year',
  run: (ctx) => {
    const wanted = planningYear(ctx.now.getTime());
    if (BLOCK_YEAR >= wanted) {
      return Promise.resolve({
        status: 'ok' as const,
        summary: `the block on file is ${BLOCK_YEAR}'s, which is the year being planned`,
      });
    }
    return withNetwork(
      async () => {
        const { status, body } = await ctx.text(SOURCE);
        if (status !== 200) {
          return {
            status: 'fail',
            summary: `the block on file is ${BLOCK_YEAR}'s and the hotel map page answered HTTP ${status}`,
            instructions: [
              `The page at ${SOURCE} may have moved — find where gencon.com now lists block hotels and update \`MAP\` in \`scripts/fetch-block-rates.mjs\`.`,
              ...INSTRUCTIONS,
            ],
          };
        }
        // The page names its own block year in the heading the fetcher also
        // reads: `Gen Con 20XX - Housing Block`. A bare mention of the new
        // year elsewhere on the page proves nothing — navigation gets there
        // months before the block does.
        const pageYear = Number(body.match(/Gen Con (20\d\d)\s*-\s*Housing Block/i)?.[1]);
        if (!pageYear) {
          return {
            status: 'fail',
            summary: `the block on file is ${BLOCK_YEAR}'s and the hotel map page no longer carries its "Gen Con 20XX - Housing Block" heading`,
            instructions: [
              'The page has been restyled, which will also break `npm run fetch:block-rates` — its `readBlock()` documents the row shape it reads; adjust it against the live page.',
              ...INSTRUCTIONS,
            ],
          };
        }
        if (pageYear <= BLOCK_YEAR) {
          return {
            status: 'ok',
            summary: `the block on file is ${BLOCK_YEAR}'s, which is still the one Gen Con publishes — ${wanted}'s usually appears when housing opens, 157 days before the show`,
          };
        }
        if (ctx.fix) {
          execFileSync('node', ['scripts/fetch-block-rates.mjs'], { cwd: ctx.root, stdio: 'inherit' });
          return {
            status: 'warn',
            summary: `${pageYear}'s block is published and \`fetch:block-rates\` has been run — review and commit the diff to src/data/partners.ts`,
            instructions: ['`git diff src/data/partners.ts`, then `npm run check`, then commit.'],
          };
        }
        return {
          status: 'fail',
          summary: `the block on file is ${BLOCK_YEAR}'s and the hotel map page now carries ${pageYear}'s`,
          repair: [
            `The page's own heading says "Gen Con ${pageYear} - Housing Block" — the new rates are there to be read, and \`npm run season:check -- --probe block-rates --fix\` will read them.`,
          ],
          instructions: INSTRUCTIONS,
        };
      },
      {
        summary: `the block on file is ${BLOCK_YEAR}'s and gencon.com was unreachable from here`,
        instructions: INSTRUCTIONS,
      },
    );
  },
};
