/**
 * Loading the schedule, and reaching for the mirror only when there is nothing
 * else left.
 *
 * The mirror is the one part of this app that talks to a host outside the
 * deploy, so the thing worth pinning down is how rarely it does: an ordinary
 * load must not touch it, an offline phone must not be made to wait on it, and
 * a build with no mirror configured must behave exactly as it did before the
 * fallback existed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useEventFeed } from './useEventFeed';

const feed = (n = 3) => ({
  source: { name: 'x', url: 'y' },
  year: 2026,
  events: Array.from({ length: n }, (_, i) => ({
    id: `E${i}`,
    title: `Event ${i}`,
    locationText: 'ICC',
    start: '2026-07-30T10:00:00-04:00',
  })),
});

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.restoreAllMocks());

describe('the ordinary path', () => {
  it('loads the bundled feed and never asks anywhere else', async () => {
    const fetcher = vi.fn(async (_url: string) => ok(feed(3)));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useEventFeed('./events.json', 'https://mirror.example/events.json'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.feed?.events).toHaveLength(3);
    // The mirror costs nothing when the primary answers, which is always.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('./events.json');
  });

  it('treats a missing feed as a normal state rather than an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const { result } = renderHook(() => useEventFeed('./events.json', ''));
    await waitFor(() => expect(result.current.status).toBe('absent'));
  });
});

describe('when the host it came from is gone', () => {
  it('falls back to the mirror', async () => {
    // The narrow case this exists for: a device that has never opened the app,
    // so no cache can help it, and the site it would have come from is down.
    const fetcher = vi.fn(async (url: string) => {
      if (url === './events.json') throw new TypeError('Failed to fetch');
      return ok(feed(27));
    });
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useEventFeed('./events.json', 'https://mirror.example/events.json'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.feed?.events).toHaveLength(27);
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(['./events.json', 'https://mirror.example/events.json']);
  });

  it('does not reach for a mirror that was never configured', async () => {
    // Which is the default. Without this the app would be quietly making a
    // request to an empty URL on every failed load.
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useEventFeed('./events.json', ''));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports an error rather than hanging when the mirror is down too', async () => {
    // An offline phone: both hosts unreachable. It has to settle, because a
    // status stuck on "loading" is a spinner that never stops.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const { result } = renderHook(() => useEventFeed('./events.json', 'https://mirror.example/events.json'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toContain('Failed to fetch');
  });

  it('goes to the mirror when the host answers 500, not just when it is gone', async () => {
    // A broken host and an absent one are different failures, and only one of
    // them throws. Without this the fallback would miss half of what it is for.
    const fetcher = vi.fn(async (url: string) =>
      (url === './events.json' ? new Response('nope', { status: 500 }) : ok(feed(9))));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useEventFeed('./events.json', 'https://mirror.example/events.json'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.feed?.events).toHaveLength(9);
  });
});

describe('a schedule the device imported for itself', () => {
  /** Put a feed in the store the way `runDeviceImport` would have. */
  const stored = (fetchedAt: string, events = 5) => {
    const held = new Map<string, string>([
      ['events.json', JSON.stringify({ ...feed(events), source: { name: 'own', url: 'y', fetchedAt } })],
    ]);
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async (key: string) => {
          const body = held.get(key);
          return body ? new Response(body, { headers: { 'content-type': 'application/json' } }) : undefined;
        },
        put: async () => undefined,
      }),
    });
  };

  afterEach(() => vi.unstubAllGlobals());

  it('wins when it is newer than what the host served', async () => {
    // The state this exists for: hosting stopped answering months ago, the
    // app imported the catalogue itself, and the file it shipped with is
    // the older of the two.
    stored('2026-08-01T00:00:00Z', 5);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok({ ...feed(3), source: { name: 'host', url: 'y', fetchedAt: '2026-01-01T00:00:00Z' } })),
    );
    const { result } = renderHook(() => useEventFeed());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.index?.total).toBe(5);
  });

  it('gives way when the host has something newer, rather than living on itself for ever', async () => {
    stored('2026-01-01T00:00:00Z', 5);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok({ ...feed(3), source: { name: 'host', url: 'y', fetchedAt: '2026-08-01T00:00:00Z' } })),
    );
    const { result } = renderHook(() => useEventFeed());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.index?.total).toBe(3);
  });

  it('answers alone when every host is gone', async () => {
    // No deploy, no mirror, nothing. A copy holding its own import must show
    // that schedule rather than an error over the top of it.
    stored('2026-08-01T00:00:00Z', 5);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('gone'))));
    const { result } = renderHook(() => useEventFeed());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.index?.total).toBe(5);
  });
});
