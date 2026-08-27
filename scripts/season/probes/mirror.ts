/**
 * Is the events mirror alive, and how old is what it holds?
 *
 * The Worker exists for the device that has never opened the app when the
 * main host is gone — which means a dead or stale mirror is invisible until
 * the one moment it was for. It has had a `/health` route all along; this
 * is the thing that finally calls it.
 */

import type { Probe, ProbeResult } from '../lib';
import { withNetwork } from '../lib';

export const probe: Probe = {
  id: 'mirror',
  title: 'Events mirror',
  run: (ctx) => {
    const configured = (process.env.SEASON_MIRROR ?? process.env.VITE_EVENTS_MIRROR ?? '').trim();
    if (!configured) {
      return Promise.resolve({
        status: 'skip',
        summary: 'no mirror is configured',
        instructions: [
          'Optional: deploy `worker/` (see `worker/wrangler.toml`) and set the repository variable `VITE_EVENTS_MIRROR` to `https://<name>.workers.dev/events.json` — the deploy then keeps it fed and this probe starts watching it.',
        ],
      } satisfies ProbeResult);
    }
    const health = configured.replace(/\/events\.json$/, '/health');
    return withNetwork(
      async () => {
        const { status, body } = await ctx.json(health);
        if (status !== 200) {
          return {
            status: 'fail',
            summary: `the mirror's /health answered HTTP ${status}`,
            instructions: [
              'The Worker may be undeployed or renamed: `npx wrangler deploy` from `worker/` restores it, and `worker/wrangler.toml` documents the KV binding and secret it needs.',
              'If it is gone for good, unset `VITE_EVENTS_MIRROR` so builds stop advertising a fallback that is not there.',
            ],
          };
        }
        const held = body as { holding?: string | null; storedAt?: string | null; ageHours?: number | null } | null;
        if (!held?.holding) {
          return {
            status: 'warn',
            summary: 'the mirror answers but holds no snapshot at all',
            details: [JSON.stringify(held)],
            instructions: [
              'The deploy PUTs a snapshot on every run — an empty mirror means that PUT has never succeeded: check the shared secret and the mirror step in the deploy log.',
            ],
          };
        }
        const ageDays =
          typeof held.ageHours === 'number'
            ? Math.floor(held.ageHours / 24)
            : held.storedAt
              ? Math.floor((ctx.now.getTime() - new Date(held.storedAt).getTime()) / 86_400_000)
              : null;
        if (ageDays !== null && ageDays > 30) {
          return {
            status: 'warn',
            summary: `the mirror answers but its snapshot is ${ageDays} days old`,
            details: [JSON.stringify(held)],
            instructions: [
              'The deploy PUTs a fresh snapshot on every run — a stale mirror with a working deploy means the PUT is failing: check the shared secret and the deploy log\'s mirror step.',
            ],
          };
        }
        return {
          status: 'ok',
          summary: ageDays === null ? 'the mirror answers' : `the mirror answers with a ${ageDays}-day-old snapshot`,
          details: [JSON.stringify(held)],
        };
      },
      {
        summary: `${health} was unreachable from here`,
        instructions: ['Re-run `npm run season:check` somewhere with open network access.'],
      },
    );
  },
};
