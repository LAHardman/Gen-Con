/**
 * The two store obligations with real dates on them.
 *
 * Nothing on any network can discover when the Apple Developer membership
 * renews or when Google Play's target-API ratchet next bites this app —
 * they are facts about accounts only their owner can see. So they live in
 * a file a person maintains, and the probe's whole job is to be the
 * calendar: quiet a year, then insistent for the sixty days that matter,
 * because the failure mode of an annual obligation is nobody remembering.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Deadline, Probe, ProbeResult } from '../lib';
import { readDeadline } from '../lib';

const FILE = 'scripts/season/store-dates.json';

export const probe: Probe = {
  id: 'store-dates',
  title: 'Store account deadlines',
  run(ctx): Promise<ProbeResult> {
    let deadlines: Deadline[];
    try {
      const parsed = JSON.parse(readFileSync(join(ctx.root, FILE), 'utf8')) as { deadlines?: Deadline[] };
      deadlines = parsed.deadlines ?? [];
    } catch (error) {
      return Promise.resolve({
        status: 'fail',
        summary: `${FILE} could not be read`,
        details: [String(error)],
        instructions: [`Restore ${FILE} — it holds the store renewal dates nothing else can know. \`git log -- ${FILE}\` has its history.`],
      } satisfies ProbeResult);
    }
    if (!deadlines.length) {
      return Promise.resolve({
        status: 'warn',
        summary: `${FILE} lists no deadlines`,
        instructions: [`Add the store obligations to ${FILE}; the file's _readme says the shape.`],
      } satisfies ProbeResult);
    }

    const readings = deadlines.map((deadline) => readDeadline(deadline, ctx.now));
    const worst: ProbeResult['status'] = readings.some((r) => r.status === 'fail')
      ? 'fail'
      : readings.some((r) => r.status === 'warn')
        ? 'warn'
        : 'ok';
    return Promise.resolve({
      status: worst,
      summary: readings.map((r) => r.summary).join('; '),
      instructions: worst === 'ok' ? undefined : readings.flatMap((r) => r.instructions ?? []),
    } satisfies ProbeResult);
  },
};
