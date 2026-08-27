/**
 * Do this year's booth numbers still agree with the map's reading of them?
 *
 * The exhibit floor is renumbered every year, and nothing here can re-read
 * the printed map on its own — that is the one genuinely human moment of
 * the season. What *can* be watched is the agreement rate the tests hold:
 * `booth-plan.test.ts` compares the live stand list against the placed
 * grid, and a new year drops it through the floor. This probe runs exactly
 * that test, so the weekly report says the roll-over happened within a
 * week of Gen Con doing it, instead of whenever somebody next looks.
 */

import { spawnSync } from 'node:child_process';
import type { Probe, ProbeResult } from '../lib';

export const probe: Probe = {
  id: 'booth-agreement',
  title: 'Booth grid agreement',
  run(ctx): Promise<ProbeResult> {
    const run = spawnSync('npx', ['vitest', 'run', 'src/data/booth-plan.test.ts', 'src/data/booths.test.ts', '--reporter=dot'], {
      cwd: ctx.root,
      encoding: 'utf8',
      timeout: 300_000,
      env: { ...process.env, CI: 'true' },
    });
    if (run.status === 0) {
      return Promise.resolve({
        status: 'ok',
        summary: 'the stand list, the placed grid and the hall divides all still agree',
      } satisfies ProbeResult);
    }
    const tail = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim().split('\n').slice(-25);
    return Promise.resolve({
      status: 'fail',
      summary: 'the booth tests fail — the usual cause is Gen Con renumbering the floor for a new year',
      details: tail,
      instructions: [
        'This is the yearly re-read of the printed exhibit-hall map: `docs/next-steps.md` §9 holds the two commands (`scripts/read-booth-map.mjs`, then `scripts/fit-booths.mjs`), fed by the new PDF fetched by hand.',
        'The hall divides in `src/data/booths.ts` then need this year\'s five sentences from somebody who has walked the hall — the file\'s header says exactly which walls and how they are checked against the schedule.',
        'Do not lower the agreement floor in the test to get green; the floor is the alarm, and this is it going off.',
      ],
    } satisfies ProbeResult);
  },
};
