/**
 * Re-reading Gen Con to see whether a room's events are still in that room.
 *
 * This had no tests at all, and then its source changed underneath it: it used
 * to scrape a table out of a third-party HTML page and now reads Gen Con's own
 * JSON. Both halves of that are worth pinning down, because the failure is
 * quiet in a particularly bad direction — a parse that returns nothing reads as
 * "this event has no location", which is indistinguishable from "this event has
 * moved", and the dialog would tell somebody their game had been relocated when
 * it had not.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLocationCheck } from './useLocationCheck';
import type { ConEvent } from '../data/events';

const NOW = Date.parse('2026-07-30T09:00:00-04:00');

const event = (over: Partial<ConEvent> = {}): ConEvent => ({
  id: 'BGM26ND306429',
  title: '12 Rivers',
  locationText: 'ICC',
  roomText: 'Hall F',
  start: '2026-07-30T20:00:00-04:00',
  end: '2026-07-30T22:00:00-04:00',
  ...over,
});

/** What Gen Con's search returns, as the proxy hands it back. */
const answer = (records: Array<Record<string, unknown>>) =>
  new Response(JSON.stringify({ records: records.map((_source) => ({ _source })) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => vi.restoreAllMocks());

const run = (events: ConEvent[]) => renderHook(() => useLocationCheck('hall-f', events, NOW));

describe('confirming a room', () => {
  it('says confirmed when the source still agrees', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      answer([{ game_code: 'BGM26ND306429', location: 'ICC', room_name: 'Hall F' }])));
    const { result } = run([event()]);
    await waitFor(() => expect(result.current.status).toBe('confirmed'));
    expect(result.current.checked).toBe(1);
    expect(result.current.moved).toEqual([]);
  });

  it('ignores differences that are only spacing or case', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      answer([{ game_code: 'BGM26ND306429', location: '  icc ', room_name: 'HALL  F' }])));
    const { result } = run([event()]);
    await waitFor(() => expect(result.current.status).toBe('confirmed'));
  });

  it('goes through the same-origin path, since Gen Con cannot be asked directly', async () => {
    const fetcher = vi.fn(async (_url: string) => answer([{ game_code: 'BGM26ND306429', location: 'ICC', room_name: 'Hall F' }]));
    vi.stubGlobal('fetch', fetcher);
    const { result } = run([event()]);
    await waitFor(() => expect(result.current.status).toBe('confirmed'));
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/gencon/api/event_search');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('BGM26ND306429');
  });
});

describe('noticing a move', () => {
  it('reports the event and where it went', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      answer([{ game_code: 'BGM26ND306429', location: 'JW', room_name: 'White River A' }])));
    const { result } = run([event()]);
    await waitFor(() => expect(result.current.status).toBe('moved'));
    expect(result.current.moved[0].locationText).toBe('JW');
    expect(result.current.moved[0].roomText).toBe('White River A');
  });

  it('reads the record with this event\'s code, not whichever came back first', async () => {
    // A game code is just a string to a search engine, so a search for one can
    // return others. Trusting the first would report a move whenever anything
    // else sorted above it.
    vi.stubGlobal('fetch', vi.fn(async () => answer([
      { game_code: 'RPG26ND999999', location: 'Stadium', room_name: 'Field' },
      { game_code: 'BGM26ND306429', location: 'ICC', room_name: 'Hall F' },
    ])));
    const { result } = run([event()]);
    await waitFor(() => expect(result.current.status).toBe('confirmed'));
  });
});

describe('not knowing, and saying so', () => {
  it('reports unavailable where the proxy is not configured', async () => {
    // A plain static host with no way to proxy. The honest answer is that
    // nothing was confirmed, not that all is well.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const { result } = run([event()]);
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.moved).toEqual([]);
  });

  it('reports unavailable when nothing can be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const { result } = run([event()]);
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
  });

  it('does not call an unreadable answer a move', async () => {
    // The dangerous one. A record with neither field is a parse that failed,
    // and counting it as "no location" would tell somebody their game had been
    // relocated when nothing had happened at all.
    vi.stubGlobal('fetch', vi.fn(async () => answer([{ game_code: 'BGM26ND306429' }])));
    const { result } = run([event()]);
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.moved).toEqual([]);
  });

  it('leaves events that are already over alone', async () => {
    const fetcher = vi.fn(async () => answer([]));
    vi.stubGlobal('fetch', fetcher);
    const { result } = run([event({ start: '2026-07-29T10:00:00-04:00', end: '2026-07-29T12:00:00-04:00' })]);
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(fetcher).not.toHaveBeenCalled();
  });
});
