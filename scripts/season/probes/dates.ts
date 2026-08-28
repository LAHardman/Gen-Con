/**
 * Do the derived key dates still agree with Gen Con's own?
 *
 * `key-dates.ts` reproduces every dated milestone from a rule — days before
 * the convention's Wednesday — and the tests hold that rule against recorded
 * API answers. This holds it against the *live* answer, because the year Gen
 * Con breaks its own pattern is precisely the year the recordings stop being
 * evidence. The API is authoritative, so the self-repair here is complete:
 * the discrepancy arrives with the correct value attached.
 */

import type { Probe } from '../lib';
import { withNetwork } from '../lib';
import { MILESTONES, conventionWednesday, milestoneAt, planningYear } from '../../../src/data/key-dates';

const API = 'https://www.gencon.com/api/v1/conventions';

/** The API's field for each milestone the rule derives. */
const FIELD_TO_MILESTONE: Record<string, string> = {
  event_submission_start: 'event-submission',
  badge_registration_start: 'badges',
  view_events_start: 'catalogue',
  event_registration_start: 'event-registration',
};

interface Convention {
  start?: string;
  [field: string]: unknown;
}

export const probe: Probe = {
  id: 'dates',
  title: 'Key dates vs the API',
  run: (ctx) =>
    withNetwork(
      async () => {
        const { status, body } = await ctx.json(API);
        // The list arrives wrapped: `{data: {conventions: [...]}}`.
        const conventions = (body as { data?: { conventions?: Convention[] } })?.data?.conventions;
        if (status !== 200 || !Array.isArray(conventions)) {
          return {
            status: 'fail',
            summary: `the conventions API answered HTTP ${status}${status === 200 ? ' but not in the wrapped shape this reads' : ''}`,
            instructions: [
              'If it has moved, `src/data/key-dates.ts` still answers offline from the rule — nothing is broken today.',
              'Find where gencon.com now publishes registration dates (its /events and /attend pages state them in prose) and update this probe and the tests in `src/data/key-dates.test.ts`.',
            ],
          };
        }

        const year = planningYear(ctx.now.getTime());
        const mismatches: string[] = [];
        const checked: string[] = [];

        for (const raw of conventions) {
          const startYear = typeof raw.start === 'string' ? Number(raw.start.slice(0, 4)) : NaN;
          if (!Number.isFinite(startYear) || startYear < year) continue;

          const wednesday = conventionWednesday(startYear);
          if (typeof raw.start === 'string' && raw.start !== wednesday.toISOString().slice(0, 10)) {
            mismatches.push(
              `${startYear}: the API starts the convention on ${raw.start}; the first-Saturday rule says ${wednesday.toISOString().slice(0, 10)}.`,
            );
          }

          for (const [field, id] of Object.entries(FIELD_TO_MILESTONE)) {
            const published = raw[field];
            if (typeof published !== 'string' || !published) continue;
            const milestone = MILESTONES.find((m) => m.id === id);
            if (!milestone) continue;
            const derived = milestoneAt(milestone, startYear);
            checked.push(`${startYear} ${id}`);
            if (derived && derived.getTime() !== new Date(published).getTime()) {
              mismatches.push(
                `${startYear} ${id}: Gen Con says ${published}; the rule derives ${derived.toISOString()}.`,
              );
            }
          }
        }

        if (!mismatches.length) {
          return {
            status: 'ok',
            summary: checked.length
              ? `the rule reproduces all ${checked.length} published milestones for ${year} on, to the instant`
              : `the API publishes no milestones for ${year} yet, and the rule stands ready`,
          };
        }
        return {
          status: 'fail',
          summary: `${mismatches.length} published date${mismatches.length === 1 ? '' : 's'} disagree with the derivation`,
          repair: [
            'Gen Con is authoritative here — the corrected values are in the lines above, read from the live API.',
            ...mismatches,
          ],
          instructions: [
            'Adjust the offsets (or add a per-year exception) in `src/data/key-dates.ts`, and record the new API answer in `src/data/key-dates.test.ts` so the tests hold the corrected rule.',
            'To the instant matters: February is standard time, May is summer time, and an hour out on a queue that empties in ten minutes is the whole thing.',
          ],
        };
      },
      {
        summary: 'gencon.com was unreachable from here; the rule answers offline in the meantime',
        instructions: ['Re-run `npm run season:check` somewhere with network access to gencon.com.'],
      },
    ),
};
