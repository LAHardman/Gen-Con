/**
 * Keeps a planned event readable when there is no signal.
 *
 * THE PROBLEM THIS SOLVES IS A PLACE, not a feature. The schedule is what you
 * read *at* the convention, and an exhibit hall with sixty thousand people in
 * it is the worst signal on the campus. A description that has to be fetched
 * when you open it is a description you cannot read exactly where you wanted
 * it — so the ones for events somebody has actually committed to are fetched
 * ahead of time, once, and kept.
 *
 * WHY IT IS AFFORDABLE. The feed cannot carry descriptions: a paragraph each
 * across 27,467 events is several megabytes in front of the first screen. A
 * dozen of them, for the dozen events somebody chose, is a few kilobytes — and
 * they are fetched one at a time with the same courtesy delay the importer
 * uses, because this is somebody else's server and a plan is not urgent.
 *
 * IT ONLY EVER ADDS. A failed fetch leaves the entry as it was and is retried
 * on the next visit; nothing is ever cleared, because the copy on the device is
 * worth more than being up to date with a paragraph that does not change.
 */

import { useEffect } from 'react';
import { fetchEventNotes } from './useEventNotes';
import type { Plan } from './usePlan';

/** Matches the importer's own courtesy delay between requests. */
const DELAY_MS = 400;

export function usePlanDescriptions(plan: Plan) {
  // Ids alone: the effect must re-run when something is added and NOT when a
  // description lands on an entry, which changes the array on every fetch.
  const missing = plan.entries
    .filter((entry) => entry.description === undefined)
    .map((entry) => entry.id)
    .join(',');

  useEffect(() => {
    if (!missing) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    let cancelled = false;
    (async () => {
      for (const id of missing.split(',')) {
        if (cancelled) return;
        const notes = await fetchEventNotes(id);
        if (cancelled) return;
        // An event with no description is stored as an empty one, so it is not
        // asked for again on every visit for the rest of the convention.
        if (notes) plan.describe(id, notes.description ?? '');
        await new Promise((done) => setTimeout(done, DELAY_MS));
      }
    })();

    return () => {
      cancelled = true;
    };
    // `plan.describe` is stable; `missing` is the whole of what this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);
}
