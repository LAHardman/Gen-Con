/**
 * The plan surviving the things that end a session.
 *
 * There is no server, so `localStorage` is the whole of the persistence and
 * every one of its failure modes lands here: a key holding something else, a
 * half-written value, a quota that is full, and Safari's private window whose
 * `localStorage` exists and refuses every write. None of them may take the map
 * down with them — losing the ability to plan is survivable, and losing the
 * ability to open the app at a convention is not.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPlan, usePlan } from './usePlan';
import type { PlanEntry } from '../data/plan';

const KEY = 'genCon.plan';

const entry = (id: string, over: Partial<PlanEntry> = {}): PlanEntry => ({
  id,
  title: `Event ${id}`,
  start: '2026-07-30T09:00:00-04:00',
  where: 'Exhibit Hall A · Convention Center',
  roomId: 'hall-a',
  ...over,
});

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('keeping a plan', () => {
  it('holds what was added and reads it back on the next visit', () => {
    const { result, unmount } = renderHook(() => usePlan());
    act(() => result.current.add(entry('a')));
    expect(result.current.entries.map((held) => held.id)).toEqual(['a']);
    unmount();

    // A new session, reading what the last one left.
    const { result: later } = renderHook(() => usePlan());
    expect(later.current.entries.map((held) => held.id)).toEqual(['a']);
    expect(later.current.planned('a')).toBe(true);
    expect(later.current.planned('b')).toBe(false);
  });

  it('takes the newer copy rather than a second one', () => {
    // Adding an event again is what happens when its room or time has changed
    // since it was planned. Two rows for one session would be wrong twice over.
    const { result } = renderHook(() => usePlan());
    act(() => result.current.add(entry('a', { where: 'Exhibit Hall A' })));
    act(() => result.current.add(entry('a', { where: 'Wabash Ballroom', roomId: 'wabash-ballroom' })));
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].roomId).toBe('wabash-ballroom');
  });

  it('takes one out again', () => {
    const { result } = renderHook(() => usePlan());
    act(() => result.current.add(entry('a')));
    act(() => result.current.add(entry('b')));
    act(() => result.current.remove('a'));
    expect(result.current.entries.map((held) => held.id)).toEqual(['b']);
  });

  it('toggles, for the button that is both', () => {
    const { result } = renderHook(() => usePlan());
    act(() => result.current.toggle(entry('a')));
    expect(result.current.planned('a')).toBe(true);
    act(() => result.current.toggle(entry('a')));
    expect(result.current.planned('a')).toBe(false);
  });
});

describe('what was left under the key', () => {
  it('ignores something that is not a plan at all', () => {
    window.localStorage.setItem(KEY, 'not json {');
    expect(readPlan()).toEqual([]);
    window.localStorage.setItem(KEY, JSON.stringify({ hello: 'world' }));
    expect(readPlan()).toEqual([]);
  });

  it('drops a plan written by a version that meant something else by it', () => {
    // A dozen entries somebody can rebuild in a minute, against a Saturday that
    // quietly says the wrong room. Dropping is the safe direction.
    window.localStorage.setItem(KEY, JSON.stringify({ version: 0, entries: [entry('a')] }));
    expect(readPlan()).toEqual([]);
  });

  it('keeps the entries that survive and discards the ones that do not', () => {
    // A half-written value, or one entry corrupted: the rest of somebody's
    // Saturday should still be there.
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        entries: [entry('a'), { id: 'b' }, null, { ...entry('c'), start: 'whenever' }, entry('d')],
      }),
    );
    expect(readPlan().map((held) => held.id)).toEqual(['a', 'd']);
  });
});

describe('when storage refuses', () => {
  it('carries on when it cannot be read', () => {
    // Reading throws where storage is blocked outright by site settings.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied');
    });
    expect(() => readPlan()).not.toThrow();
    expect(readPlan()).toEqual([]);
  });

  it('carries on when it cannot be written', () => {
    // Safari's private window has a localStorage that is present and refuses
    // every write, and quota exceeded looks the same. The plan has to work for
    // the session either way — it just will not outlive it.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    const { result } = renderHook(() => usePlan());
    expect(() => act(() => result.current.add(entry('a')))).not.toThrow();
    expect(result.current.planned('a')).toBe(true);
  });
});
