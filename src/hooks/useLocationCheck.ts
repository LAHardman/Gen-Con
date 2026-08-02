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

/** Kept in step with `EVENT_DB_PROXY` in vite.config.ts. */
const PROXY = '/eventdb';

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
function readLocation(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const found: Record<string, string> = {};

  for (const row of doc.querySelectorAll('tr')) {
    const cells = row.querySelectorAll('td, th');
    if (cells.length < 2) continue;
    const label = (cells[0].textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const value = (cells[1].textContent ?? '').replace(/\s+/g, ' ').trim();
    if (label === 'location' || label === 'room') found[label] = value;
  }

  // A page that yielded neither label didn't parse; treat that as unreadable
  // rather than as an event with no location, which would read as a move.
  if (!('location' in found) && !('room' in found)) return null;
  return { locationText: found.location ?? '', roomText: found.room ?? '' };
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
          const response = await fetch(`${PROXY}/event.php?GameCode=${encodeURIComponent(event.id)}`);
          if (!response.ok) throw new Error(String(response.status));
          const live = readLocation(await response.text());
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
