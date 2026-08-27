/**
 * Has Gen Con published a new generation of its floor-plan tiles?
 *
 * Nobody announces a v10 — the number just changes in the pyramid at
 * `<cdn>/maps/v9/`. The CDN itself is the reliable witness: a generation
 * that exists serves `floor-1/1/0/0.png` with a 200, and one that does not
 * answers 403 (verified against v9 and its absent neighbours). So this
 * asks for the pinned generation and the few above it, and the repair, when
 * a new one exists, is the new base URL — found, not guessed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Probe } from '../lib';
import { withNetwork } from '../lib';

/** A tile every generation so far has served: floor 1's single top tile. */
const PROBE_TILE = 'floor-1/1/0/0.png';

/** The host and version the fetcher is coded against, read from the script itself. */
export function pinnedBase(root: string): { host: string; version: number } | null {
  try {
    const source = readFileSync(join(root, 'scripts/gencon-tiles.mjs'), 'utf8');
    const match = source.match(/'(https:\/\/[^']+)\/maps\/v(\d+)'/);
    return match ? { host: match[1], version: Number(match[2]) } : null;
  } catch {
    return null;
  }
}

export const probe: Probe = {
  id: 'campus-tiles',
  title: 'Gen Con floor-plan tiles',
  run: (ctx) => {
    const pinned = pinnedBase(ctx.root);
    if (!pinned) {
      return Promise.resolve({
        status: 'warn' as const,
        summary: 'the pinned tile base could not be read out of scripts/gencon-tiles.mjs',
        instructions: ['`HOST` in that script should be an `https://.../maps/vN` literal; this probe reads the version from it.'],
      });
    }
    return withNetwork(
      async () => {
        const alive = async (version: number) =>
          (await ctx.head(`${pinned.host}/maps/v${version}/${PROBE_TILE}`)).status === 200;

        if (!(await alive(pinned.version))) {
          return {
            status: 'fail',
            summary: `the pinned generation maps/v${pinned.version} no longer serves its tiles`,
            instructions: [
              'The CDN or path has moved entirely. Open gencon.com/map with the browser network tab up, note the URL its floor-plan tiles load from, and put that base into `HOST` in `scripts/gencon-tiles.mjs` (or set `GENCON_TILES`).',
              'The committed floor plans keep working meanwhile — this only blocks the *next* re-read.',
            ],
          };
        }

        let newest = pinned.version;
        for (let candidate = pinned.version + 1; candidate <= pinned.version + 4; candidate += 1) {
          if (await alive(candidate)) newest = candidate;
        }

        if (newest === pinned.version) {
          return { status: 'ok', summary: `maps/v${pinned.version} is still the newest generation the CDN serves` };
        }
        return {
          status: 'fail',
          summary: `the CDN now serves maps/v${newest}; the fetcher is pinned to v${pinned.version} — Gen Con has redrawn its floor plans`,
          repair: [
            `The new base, verified serving: \`${pinned.host}/maps/v${newest}\`. Run against it without editing anything: \`GENCON_TILES=${pinned.host}/maps/v${newest} npm run plans:campus\`.`,
          ],
          instructions: [
            `Update \`HOST\` in \`scripts/gencon-tiles.mjs\` from v${pinned.version} to v${newest}.`,
            'Run `npm run plans:campus`, then `npm run plans:venues` — the second re-traces the floors from the new sheets and prints the fit it got (76–89% of footprint is the healthy range).',
            'Then `npm run check:geometry` and `npm run check`. A new drawing can move rooms; the geometry check is what catches one poking through a wall.',
          ],
        };
      },
      {
        summary: 'the tile CDN was unreachable from here',
        instructions: ['Re-run `npm run season:check` somewhere with open network access.'],
      },
    );
  },
};
