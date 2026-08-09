/**
 * Re-reads the source to confirm that a room's events are still in that room.
 *
 * The importer can only find out that an event has moved by pulling its page
 * again, and the source's change log doesn't help: it publishes a change set
 * only when an event is added, deleted, or has tickets go back on sale, so a
 * room edit changes the data without appearing in one. Between full re-pulls
 * — every seven days — a move is invisible. This closes that window for the
 * events you are actually looking at.
 *
 * Two things bound it. It only checks events that are on now or coming up,
 * because a room's whole schedule can run to hundreds and the ones already
 * over cannot be walked to. And it goes through a same-origin path rather
 * than calling the source directly, because the source sends no CORS headers;
 * where that path isn't configured the check reports `unavailable` and the
 * dialog says so instead of pretending everything is confirmed.
 */

import { useEffect, useMemo, useState } from 'react';
import { eventEndMs, type ConEvent } from '../data/events';

/**
 * Gen Con's API on this app's own origin. Kept in step with `GENCON_PROXY` in
 * vite.config.ts, which serves the same path in development, and with
 * `functions/gencon/[[path]].js`, which serves it on Cloudflare Pages.
 *
 * A same-origin path, because Gen Con sends no CORS headers and a browser
 * therefore cannot ask them directly. Where the path is not configured — a
 * plain static host with no way to proxy — the check reports `unavailable` and
 * the dialog says so, rather than pretending everything was confirmed.
 */
const PROXY = '/gencon';

/** Enough to notice a room being emptied, few enough to be a polite request. */
const MAX_CHECKS = 6;

/** Spacing between requests, matching the importer's default courtesy delay. */
const DELAY_MS = 150;

export interface LocationCheck {
  status: 'idle' | 'checking' | 'confirmed' | 'moved' | 'unavailable';
  /** How many events were actually read back from the source. */
  checked: number;
  /** Events whose location no longer matches what the app has. */
  moved: Array<{ event: ConEvent; locationText: string; roomText: string }>;
}

const IDLE: LocationCheck = { status: 'idle', checked: 0, moved: [] };

/**
 * Pulls `Location` and `Room` back out of an event page.
 *
 * The page holds its record as a two-column table of label/value rows, so the
 * labels are what identify a field — the same approach, and the same two
 * labels, as `FIELD_PATTERNS` in `scripts/lib/parse-events.mjs`. This is a
 * deliberately small reading of that: only the two fields the check compares,
 * using the browser's own parser rather than pulling a DOM library into the
 * bundle for it.
 */
function readLocation(body: unknown, id: string) {
  // Searching a game code can match more than one record — a code is a string
  // like any other to a search engine — so the one with this exact code is
  // picked rather than the first that came back.
  const records = (body as { records?: Array<{ _source?: Record<string, unknown> }> })?.records;
  if (!Array.isArray(records)) return null;
  const found = records
    .map((record) => record?._source)
    .find((source) => source && (source.game_code === id || String(source.id) === id.replace(/^\D+/, '')));
  if (!found) return null;
  // An event with neither field did not parse. Treating that as "no location"
  // would report every checked event as having moved.
  if (found.location === undefined && found.room_name === undefined) return null;
  return {
    locationText: String(found.location ?? ''),
    roomText: String(found.room_name ?? ''),
  };
}

/** Trailing/leading space and case differ between pulls without meaning anything. */
const same = (a: string | undefined, b: string | undefined) =>
  (a ?? '').replace(/\s+/g, ' ').trim().toLowerCase() ===
  (b ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function useLocationCheck(roomId: string, events: ConEvent[], nowMs: number) {
  const [result, setResult] = useState<LocationCheck>(IDLE);

  // Anything already finished can't be walked to, so it isn't worth a request.
  // Held in a memo keyed by what it depends on rather than by the events array
  // itself: the caller hands a fresh empty array to a room with no events, and
  // the clock ticks every few seconds, neither of which should re-run a crawl.
  const upcoming = useMemo(
    () =>
      events
        .filter((event) => eventEndMs(event) >= nowMs)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
        .slice(0, MAX_CHECKS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roomId],
  );
  const checkKey = upcoming.map((event) => event.id).join(',');

  useEffect(() => {
    if (!upcoming.length) {
      setResult(IDLE);
      return;
    }

    let cancelled = false;
    setResult({ status: 'checking', checked: 0, moved: [] });

    (async () => {
      const moved: LocationCheck['moved'] = [];
      let checked = 0;

      for (const event of upcoming) {
        if (cancelled) return;
        try {
          const response = await fetch(`${PROXY}/api/event_search?search=${encodeURIComponent(event.id)}`);
          if (!response.ok) throw new Error(String(response.status));
          const live = readLocation(await response.json(), event.id);
          if (!live) continue;
          checked += 1;
          if (!same(live.locationText, event.locationText) || !same(live.roomText, event.roomText)) {
            moved.push({ event, ...live });
          }
        } catch {
          // No proxy on this host, or the source is unreachable. Either way the
          // honest answer is that nothing was confirmed, not that all is well.
          if (!cancelled) setResult({ status: 'unavailable', checked, moved });
          return;
        }
        await new Promise((done) => setTimeout(done, DELAY_MS));
      }

      if (cancelled) return;
      if (!checked) setResult({ status: 'unavailable', checked: 0, moved: [] });
      else setResult({ status: moved.length ? 'moved' : 'confirmed', checked, moved });
    })();

    return () => {
      cancelled = true;
    };
    // Re-runs when you open a different room, not as the clock ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);

  return result;
}
