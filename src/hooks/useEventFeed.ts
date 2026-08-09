import { useEffect, useMemo, useState } from 'react';
import { indexEvents, type EventFeed, type EventIndex } from '../data/events';

export type FeedStatus = 'loading' | 'ready' | 'absent' | 'error';

export interface EventFeedState {
  status: FeedStatus;
  feed: EventFeed | null;
  index: EventIndex | null;
  error: string | null;
}

const EMPTY_INDEX: EventIndex = {
  byRoom: new Map(),
  byPin: new Map(),
  unmatched: [],
  days: [],
  total: 0,
};

/**
 * A second place to get the schedule, if one has been configured.
 *
 * Empty unless `VITE_EVENTS_MIRROR` was set at build time, so the whole
 * fallback is inert by default and no third-party URL is baked into a build
 * that has not asked for one. `worker/` is what serves it.
 */
const MIRROR = (import.meta.env.VITE_EVENTS_MIRROR ?? '').trim();

/**
 * Loads the generated event feed.
 *
 * A missing file is a normal state, not an error: the app is useful as a map
 * before anyone has run `npm run fetch:events`, so it reports "absent" and the
 * UI explains how to populate it.
 *
 * THE MIRROR IS A FALLBACK, NOT A RACE. The bundled copy is tried first and
 * alone; the mirror is only reached for when that fails outright, which means
 * the ordinary path costs exactly what it did before and a phone with no signal
 * does not sit waiting on a second host that is equally unreachable.
 *
 * It is worth having for one narrow case, and it is worth being clear that it
 * is narrow: a device that has *never* opened the app cannot be helped by any
 * cache, and if the site it would have come from is gone, this is the only
 * thing left that can hand it a schedule.
 */
export function useEventFeed(url = './events.json', mirror = MIRROR): EventFeedState {
  const [state, setState] = useState<{
    status: FeedStatus;
    feed: EventFeed | null;
    error: string | null;
  }>({ status: 'loading', feed: null, error: null });

  useEffect(() => {
    let cancelled = false;

    const load = async (from: string) => {
      const response = await fetch(from, { cache: 'no-cache' });
      if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
      return response;
    };

    (async () => {
      try {
        let response: Response;
        try {
          response = await load(url);
        } catch (reason) {
          // The bundled copy could not be fetched at all — the host is down, or
          // gone. Anybody who has opened the app before is being served from
          // cache and never reaches here; this is for the device that has not.
          if (!mirror) throw reason;
          response = await load(mirror);
        }
        if (response.status === 404) {
          if (!cancelled) setState({ status: 'absent', feed: null, error: null });
          return;
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('json')) {
          // A dev server that rewrites unknown paths to index.html will answer
          // 200 with HTML; treat that as "no feed" rather than a parse crash.
          if (!cancelled) setState({ status: 'absent', feed: null, error: null });
          return;
        }

        const feed = (await response.json()) as EventFeed;
        if (!Array.isArray(feed?.events)) throw new Error('feed has no events array');
        if (!cancelled) setState({ status: 'ready', feed, error: null });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            feed: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, mirror]);

  const index = useMemo(
    () => (state.feed ? indexEvents(state.feed.events) : null),
    [state.feed],
  );

  // Locations the feed uses that no room on the map claims. Reported once per
  // load because it's the signal that a room's `aliases` need extending to
  // match how the source actually names things.
  useEffect(() => {
    if (!index || index.unmatched.length === 0) return;
    // Both halves, because the source splits them: the location names the
    // building and the room names the space, and either one can be what the
    // map doesn't recognise.
    const names = [
      ...new Set(
        index.unmatched.map((event) =>
          [event.locationText, event.roomText].filter(Boolean).join(' : '),
        ),
      ),
    ].sort();
    console.info(
      `[gen-con] ${index.unmatched.length} of ${index.total} events did not match a room on the map. ` +
        `Unrecognised locations (${names.length}): ${names.slice(0, 25).join(' | ')}` +
        (names.length > 25 ? ' …' : '') +
        '\nAdd the building to a venue\'s `aliases`, or the room to a room\'s, in src/data/venues.ts.',
    );
  }, [index]);

  return {
    status: state.status,
    feed: state.feed,
    index: index ?? (state.status === 'ready' ? EMPTY_INDEX : null),
    error: state.error,
  };
}
