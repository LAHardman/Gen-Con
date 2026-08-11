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
/**
 * What is being asked about.
 *
 * An event and an exhibitor are two different records on two different
 * endpoints, and both have a description the feed cannot carry. Keeping them
 * one type means the button, the offline archive and every failure path are
 * written once.
 */
export type NotesSubject =
  | { kind: 'event'; id: string }
  | { kind: 'vendor'; id: number };

export async function fetchEventNotes(
  subject: NotesSubject | string,
): Promise<{ description: string | null; program: string | null } | null> {
  // A bare string is an event id — the plan's archive holds those and nothing
  // else, and rewriting its call sites to say so would say it twice.
  const asked: NotesSubject = typeof subject === 'string' ? { kind: 'event', id: subject } : subject;
  const url =
    asked.kind === 'event'
      ? `${PROXY}/api/event_search?search=${encodeURIComponent(asked.id)}`
      : `${PROXY}/api/v1/exhibitor_profiles/${asked.id}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const body = await response.json();
    return asked.kind === 'event' ? read(body, asked.id) : readVendor(body, asked.id);
  } catch {
    return null;
  }
}

/**
 * An exhibitor's own record, which answers with itself rather than a search.
 *
 * The id is still checked. A proxy that is not there answers 200 with the app's
 * own HTML, and a mis-shaped record is not this vendor whatever it contains.
 */
function readVendor(body: unknown, id: number) {
  const record = body as { id?: unknown; description?: unknown } | null;
  if (!record || record.id !== id) return null;
  const description = String(record.description ?? '').trim();
  return { description: description || null, program: null };
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
export function useEventNotes(subject: NotesSubject | null, wanted: boolean): EventNotes {
  const [notes, setNotes] = useState<EventNotes>(NOTHING);
  // Its identity, so the effect re-runs on a different subject and not on a
  // new object holding the same one.
  const key = subject ? `${subject.kind}:${subject.id}` : null;

  useEffect(() => {
    if (!subject || !wanted) {
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
      const found = await fetchEventNotes(subject);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, wanted]);

  return notes;
}
