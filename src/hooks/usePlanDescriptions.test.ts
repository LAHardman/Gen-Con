/**
 * Fetching the descriptions for a plan, ahead of needing them.
 *
 * The place this is for is an exhibit hall with sixty thousand people in it and
 * no signal, which is exactly where somebody opens their schedule. So what is
 * asserted is that the work happens *early*, happens *once*, and never happens
 * twice for the same event — because the alternative is a loop that hammers
 * somebody else's server for the length of a convention.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlanDescriptions } from './usePlanDescriptions';
import { usePlan } from './usePlan';
import type { PlanEntry } from '../data/plan';

const entry = (id: string, over: Partial<PlanEntry> = {}): PlanEntry => ({
  id,
  title: `Event ${id}`,
  start: '2026-07-30T09:00:00-04:00',
  where: 'Exhibit Hall A',
  ...over,
});

/** A source that answers with a description built from the id it was asked for. */
const answering = () =>
  vi.fn(async (url: string) => {
    const id = decodeURIComponent(url.split('search=')[1]);
    return new Response(
      JSON.stringify({ records: [{ _source: { game_code: id, long_description: `About ${id}.` } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

/** The plan and the archive together, the way the app runs them. */
function running() {
  return renderHook(() => {
    const plan = usePlan();
    usePlanDescriptions(plan);
    return plan;
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('filling in what is missing', () => {
  it('fetches a description for an entry that has none', async () => {
    vi.stubGlobal('fetch', answering());
    const { result } = running();
    act(() => result.current.add(entry('a')));
    await waitFor(() => expect(result.current.entries[0].description).toBe('About a.'));
  });

  it('works through several, one at a time', async () => {
    // Somebody else's server, and a plan is not urgent. All at once would be a
    // burst of a dozen requests the moment a page loads.
    vi.stubGlobal('fetch', answering());
    const { result } = running();
    act(() => {
      result.current.add(entry('a'));
      result.current.add(entry('b'));
    });
    await waitFor(() => {
      expect(result.current.entries.map((held) => held.description)).toEqual(['About a.', 'About b.']);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never asks twice for the same event', async () => {
    // The failure that would only show up as somebody else's rate limit: a
    // description landing changes the entries, which restarts the effect.
    vi.stubGlobal('fetch', answering());
    const { result } = running();
    act(() => result.current.add(entry('a')));
    await waitFor(() => expect(result.current.entries[0].description).toBe('About a.'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('remembers that an event simply has no description', async () => {
    // Stored as empty rather than left missing, so it is not asked for again on
    // every visit for the rest of the convention.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ records: [{ _source: { game_code: 'a', long_description: '' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const { result } = running();
    act(() => result.current.add(entry('a')));
    await waitFor(() => expect(result.current.entries[0].description).toBe(''));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('leaves an entry alone when the fetch fails, to try again next time', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    const { result } = running();
    act(() => result.current.add(entry('a')));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current.entries[0].description).toBeUndefined();
  });

  it('does not ask at all with no network', () => {
    vi.stubGlobal('fetch', answering());
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const { result } = running();
    act(() => result.current.add(entry('a')));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks for nothing when everything already has one', () => {
    vi.stubGlobal('fetch', answering());
    window.localStorage.setItem(
      'genCon.plan',
      JSON.stringify({ version: 1, entries: [entry('a', { description: 'Held.' })] }),
    );
    running();
    expect(fetch).not.toHaveBeenCalled();
  });
});
