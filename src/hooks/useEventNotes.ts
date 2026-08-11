/**
 * The event's own description, fetched for one event when somebody asks for it.
 *
 * WHY IT IS NOT IN THE FEED. Gen Con's records carry a `long_description` that
 * runs to a paragraph or more. Across 27,467 events that is several megabytes,
 * on a file a phone has to fetch before it can show a single session — so the
 * importer drops it, and the app is 2.17 MB instead. That is the right trade
 * for a feed and the wrong one for a dialog somebody has deliberately opened,
 * where the description is most of what they wanted.
 *
 * SO IT IS ASKED FOR RATHER THAN ASSUMED. Nothing is fetched until the button
 * is pressed. Opening a dialog on a phone in an exhibit hall should not spend a
 * request on a paragraph nobody has asked to read, and on the show floor the
 * request is as likely to hang as to answer.
 *
 * ONE EVENT, THROUGH THE SAME SAME-ORIGIN PATH `useLocationCheck` uses — Gen
 * Con sends no CORS headers, so a browser cannot ask them directly. Where that
 * path is not configured, or there is no network, this reports `unavailable`
 * and the dialog says so rather than pretending. Nothing here is load-bearing.
 */

import { useEffect, useState } from 'react';

/** Kept in step with `useLocationCheck`, `vite.config.ts` and the Pages function. */
const PROXY = '/gencon';

export interface EventNotes {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'offline';
  description: string | null;
  /** The programme an event belongs to, where it belongs to one. */
  program: string | null;
}

const NOTHING: EventNotes = { status: 'idle', description: null, program: null };

/**
 * One event's notes, for anything that wants them without a component.
 *
 * The archive that keeps a planned event readable offline uses this too — the
 * request and the reading of it must be the same in both places, or a
 * description saved for offline would be parsed by different rules from one
 * shown live.
 */
export async function fetchEventNotes(
  eventId: string,
): Promise<{ description: string | null; program: string | null } | null> {
  try {
    const response = await fetch(`${PROXY}/api/event_search?search=${encodeURIComponent(eventId)}`);
    if (!response.ok) return null;
    return read(await response.json(), eventId);
  } catch {
    return null;
  }
}

/** Picks this event out of a search that can match more than one record. */
function read(body: unknown, id: string) {
  const records = (body as { records?: Array<{ _source?: Record<string, unknown> }> })?.records;
  if (!Array.isArray(records)) return null;
  const found = records
    .map((record) => record?._source)
    .find((source) => source && (source.game_code === id || String(source.id) === id.replace(/^\D+/, '')));
  if (!found) return null;
  const description = String(found.long_description ?? '').trim();
  const program = String(found.program ?? '').trim();
  return { description: description || null, program: program || null };
}

/**
 * Fetches when `wanted` turns true, and not before.
 *
 * `navigator.onLine` is checked because it is the one thing the browser will
 * tell you for free, and a button that says "no connection" beats a spinner
 * that times out after thirty seconds. It is only ever a *negative* signal —
 * online does not mean reachable — so a failed fetch still lands in
 * `unavailable`.
 */
export function useEventNotes(eventId: string | null, wanted: boolean): EventNotes {
  const [notes, setNotes] = useState<EventNotes>(NOTHING);

  useEffect(() => {
    if (!eventId || !wanted) {
      setNotes(NOTHING);
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setNotes({ status: 'offline', description: null, program: null });
      return;
    }
    let cancelled = false;
    setNotes({ status: 'loading', description: null, program: null });

    (async () => {
      const found = await fetchEventNotes(eventId);
      if (cancelled) return;
      // No proxy, no network, or a record that did not parse. All three come to
      // the same thing, and the dialog says so rather than showing a blank.
      setNotes(
        found
          ? { status: 'ready', description: found.description, program: found.program }
          : { status: 'unavailable', description: null, program: null },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, wanted]);

  return notes;
}
