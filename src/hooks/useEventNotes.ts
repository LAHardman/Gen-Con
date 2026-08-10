/**
 * The event's own description, fetched only when somebody opens it.
 *
 * WHY IT IS NOT IN THE FEED. Gen Con's records carry a `long_description` that
 * runs to a paragraph or more. Across 27,467 events that is several megabytes,
 * on a file a phone has to fetch before it can show a single session — so the
 * importer drops it, and the app is 2.17 MB instead. That is the right trade
 * for a feed and the wrong one for a dialog somebody has deliberately opened,
 * where the description is most of what they wanted.
 *
 * So it is fetched for one event, when that event is opened, through the same
 * same-origin path `useLocationCheck` uses — Gen Con sends no CORS headers, so
 * a browser cannot ask them directly. Where that path is not configured, or
 * there is no network, this reports nothing and the dialog simply shows what
 * the feed already had. Nothing here is load-bearing: an event with no
 * description reads exactly like an event whose description has not arrived,
 * which is the honest thing for it to do.
 */

import { useEffect, useState } from 'react';

/** Kept in step with `useLocationCheck`, `vite.config.ts` and the Pages function. */
const PROXY = '/gencon';

export interface EventNotes {
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  description: string | null;
  /** The programme an event belongs to, where it belongs to one. */
  program: string | null;
}

const NOTHING: EventNotes = { status: 'idle', description: null, program: null };

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

export function useEventNotes(eventId: string | null): EventNotes {
  const [notes, setNotes] = useState<EventNotes>(NOTHING);

  useEffect(() => {
    if (!eventId) {
      setNotes(NOTHING);
      return;
    }
    let cancelled = false;
    setNotes({ status: 'loading', description: null, program: null });

    (async () => {
      try {
        const response = await fetch(`${PROXY}/api/event_search?search=${encodeURIComponent(eventId)}`);
        if (!response.ok) throw new Error(String(response.status));
        const found = read(await response.json(), eventId);
        if (cancelled) return;
        setNotes(
          found
            ? { status: 'ready', description: found.description, program: found.program }
            : { status: 'unavailable', description: null, program: null },
        );
      } catch {
        // No proxy, no network, or a record that did not parse. All three come
        // to the same thing: show what the feed had and say nothing about it.
        if (!cancelled) setNotes({ status: 'unavailable', description: null, program: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return notes;
}
