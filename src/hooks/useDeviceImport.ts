import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ageInDays,
  lastAttempt,
  runDeviceImport,
  type DeviceImportResult,
} from '../data/schedule-import';
import type { EventFeed } from '../data/events';

/**
 * The device's own import of the catalogue: when it runs, and what it says
 * while it does.
 *
 * It runs itself once per launch, and almost always decides not to — the
 * published feed is one request against about 1,100, so going direct is the
 * insurance rather than the routine. `shouldDeviceImport` holds that
 * judgement and is tested case by case; this hook only gathers the
 * circumstances and reports what happened.
 *
 * IT REPORTS PROGRESS BECAUSE IT HAS TO. This takes minutes, and minutes of
 * a phone doing something invisible is indistinguishable from a phone that
 * has hung. A background window would be worse rather than better: iOS
 * grants seconds at unpredictable times, so a paged import would be killed
 * part-way, every time, for ever.
 */

export interface DeviceImportState {
  /** True while a run is in flight. */
  running: boolean;
  /** How far along, when running. */
  got: number;
  expected: number;
  /** What the last run decided or did. */
  last: DeviceImportResult | null;
  /** Ask for one regardless of the routine rules — short of the impossible. */
  start: () => void;
}

/** False on a metered connection, where nine megabytes is somebody's allowance. */
function unmetered(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; type?: string; effectiveType?: string };
    }
  ).connection;
  if (!connection) return true; // Nothing said; do not invent a restriction.
  if (connection.saveData) return false;
  return connection.type !== 'cellular';
}

export function useDeviceImport(feed: EventFeed | null): DeviceImportState {
  const [state, setState] = useState<{
    running: boolean;
    got: number;
    expected: number;
    last: DeviceImportResult | null;
  }>({ running: false, got: 0, expected: 0, last: null });
  // One run at a time, and one automatic attempt per launch: React may run
  // an effect twice in development, and this one costs 1,100 requests.
  const busy = useRef(false);
  const triedThisLaunch = useRef(false);

  const run = useCallback(
    async (asked: boolean) => {
      if (busy.current) return;
      busy.current = true;
      setState((held) => ({ ...held, running: true, got: 0, expected: 0 }));
      const nowMs = Date.now();
      const result = await runDeviceImport({
        circumstances: {
          online: navigator.onLine !== false,
          feedAgeDays: ageInDays(feed?.source?.fetchedAt, nowMs),
          sinceLastAttemptDays: ageInDays(await lastAttempt(), nowMs),
          unmetered: unmetered(),
          asked,
        },
        onProgress: ({ got, expected }) => setState((held) => ({ ...held, got, expected })),
        nowMs,
      });
      busy.current = false;
      setState((held) => ({ ...held, running: false, last: result }));
    },
    [feed],
  );

  useEffect(() => {
    // Waits for the feed to have loaded (or failed to), because its age is
    // half the decision — asking before it lands would read as "no schedule
    // at all" and spend a metered connection on a copy that has one.
    if (triedThisLaunch.current || feed === undefined) return;
    triedThisLaunch.current = true;
    void run(false);
  }, [feed, run]);

  return { ...state, start: () => void run(true) };
}
