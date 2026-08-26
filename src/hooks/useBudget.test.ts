/**
 * What the budget writes down, as opposed to what it shows.
 *
 * The page has its own tests. What only exists here is what survives a reload:
 * whether removing somebody leaves their name behind on the lines they were on,
 * and whether whatever else is under the key can take the page down with it.
 *
 * The first of those is invisible on screen — `bearersOf` falls back to
 * everybody when the only person named has gone, so a line that still carries a
 * departed id renders exactly like one that does not. The difference is only in
 * the store, which is the reason this file exists.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readBudget, useBudget } from './useBudget';

const KEY = 'genCon.budget';

afterEach(() => window.localStorage.clear());

const saved = () => JSON.parse(window.localStorage.getItem(KEY)!);

describe('what a reload gets back', () => {
  it('writes the party, the lines and the badges', () => {
    const { result } = renderHook(() => useBudget());
    act(() => result.current.addPerson('Anna'));
    act(() => result.current.addLine({ category: 'badge', label: 'Badge', cents: 13_000, times: 1, who: [] }));
    act(() => result.current.setBadge(result.current.party[0].id, 'four-day'));

    const store = saved();
    expect(store.version).toBe(1);
    expect(store.party[0].name).toBe('Anna');
    expect(store.lines[0].cents).toBe(13_000);
    expect(store.badges[0].kind).toBe('four-day');
  });

  it('trims a name rather than saving the spaces round it', () => {
    const { result } = renderHook(() => useBudget());
    act(() => result.current.addPerson('  Ben  '));
    expect(result.current.party[0].name).toBe('Ben');
  });

  it('refuses to add nobody', () => {
    // An empty box and a pressed button is a slip, not a person.
    const { result } = renderHook(() => useBudget());
    act(() => result.current.addPerson('   '));
    expect(result.current.party).toEqual([]);
  });

  it('gives two people added in the same tick different ids', () => {
    /*
     * They would otherwise share a column, and assigning a cost to one would
     * assign it to both. Ids come from a counter rather than a clock for
     * exactly this: two calls in the same millisecond are ordinary.
     */
    const { result } = renderHook(() => useBudget());
    act(() => {
      result.current.addPerson('Anna');
      result.current.addPerson('Ben');
    });
    expect(result.current.party).toHaveLength(2);
    expect(result.current.party[0].id).not.toBe(result.current.party[1].id);
  });
});

describe('somebody leaving the trip', () => {
  it('takes their name off every line they were on', () => {
    /*
     * Invisible on the page — `bearersOf` drops an unknown id on the way past,
     * so the line renders the same either way. What is wrong is the *record*:
     * the next reader of this store, months later, would find a line pinned to
     * a person who is not on the trip and have to work out which of the two
     * rules applied.
     */
    const { result } = renderHook(() => useBudget());
    act(() => result.current.addPerson('Anna'));
    act(() => result.current.addPerson('Ben'));
    const [anna, ben] = result.current.party;
    act(() =>
      result.current.addLine({
        category: 'hotel',
        label: 'Room',
        cents: 10_000,
        times: 1,
        who: [anna.id, ben.id],
      }),
    );

    act(() => result.current.removePerson(ben.id));
    expect(result.current.lines[0].who).toEqual([anna.id]);
    expect(saved().lines[0].who).toEqual([anna.id]);
  });

  it('takes their name off the events they were assigned to', () => {
    const { result } = renderHook(() => useBudget());
    act(() => result.current.addPerson('Anna'));
    const [anna] = result.current.party;
    act(() => result.current.assignEvent('RPG27ND1', [anna.id]));
    act(() => result.current.removePerson(anna.id));
    expect(result.current.assigned.RPG27ND1).toEqual([]);
  });

  it('takes their badge with them', () => {
    // Otherwise the clash check speaks about somebody who is not going.
    const { result } = renderHook(() => useBudget());
    act(() => result.current.addPerson('Anna'));
    const [anna] = result.current.party;
    act(() => result.current.setBadge(anna.id, 'four-day'));
    act(() => result.current.removePerson(anna.id));
    expect(result.current.badges).toEqual([]);
  });

  it('leaves everybody else alone', () => {
    const { result } = renderHook(() => useBudget());
    act(() => result.current.addPerson('Anna'));
    act(() => result.current.addPerson('Ben'));
    const [anna, ben] = result.current.party;
    act(() => result.current.setBadge(anna.id, 'four-day'));
    act(() => result.current.setBadge(ben.id, 'saturday'));
    act(() => result.current.removePerson(ben.id));
    expect(result.current.party.map((one) => one.name)).toEqual(['Anna']);
    expect(result.current.badgeOf(anna.id)).toBe('four-day');
  });
});

describe('reading back whatever is under the key', () => {
  it('takes nothing from a key that is not there', () => {
    expect(readBudget()).toEqual({ party: [], lines: [], assigned: {}, badges: [] });
  });

  it('takes nothing from a key that is not JSON', () => {
    // Another app on the same origin, or a half-finished write. Throwing here
    // would take the whole page down, in the one place nobody can reinstall.
    window.localStorage.setItem(KEY, 'not json {');
    expect(readBudget().party).toEqual([]);
  });

  it('drops a store written by a version that no longer exists', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ version: 99, party: [{ id: 'p', name: 'X' }] }));
    expect(readBudget().party).toEqual([]);
  });

  it('keeps the usable lines and drops the rest', () => {
    /*
     * One bad row should not cost somebody their whole budget. The one that
     * matters is a price that is not a number: it would make the total `$NaN`,
     * which is a page people close.
     */
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        party: [{ id: 'p1', name: 'Anna' }, { id: 'p2' }, 'nobody'],
        lines: [
          { id: 'a', category: 'badge', label: 'Badge', cents: 13_000, times: 1, who: [] },
          { id: 'b', category: 'badge', label: 'Broken', cents: 'lots', times: 1, who: [] },
          { id: 'c', category: 'nonsense', label: 'Wrong heading', cents: 1, times: 1, who: [] },
          { id: 'd', category: 'food', label: 'No people', cents: 1, times: 1, who: 'everyone' },
        ],
        assigned: { good: ['p1'], bad: 'p1' },
        badges: [{ personId: 'p1', kind: 'four-day' }, { personId: 'p2', kind: 'platinum' }],
      }),
    );
    const store = readBudget();
    expect(store.party.map((one) => one.name)).toEqual(['Anna']);
    expect(store.lines.map((one) => one.id)).toEqual(['a']);
    expect(store.assigned).toEqual({ good: ['p1'] });
    expect(store.badges).toEqual([{ personId: 'p1', kind: 'four-day' }]);
  });

  it('drops an infinite price, which is a number and is not one', () => {
    /*
     * Written as raw JSON on purpose. `JSON.stringify({ cents: Infinity })`
     * gives `null`, so a fixture built the obvious way never produces the value
     * it claims to — it gets caught by the `typeof` check and the guard that
     * actually matters is never exercised. `JSON.parse` of the literal does
     * produce Infinity, and an infinite cost makes the total `Infinity`, which
     * is a page somebody closes.
     */
    const line = (over: string) =>
      `{"version":1,"party":[],"assigned":{},"badges":[],"lines":[{"id":"a","category":"badge","label":"B","who":[],${over}}]}`;

    window.localStorage.setItem(KEY, line('"cents":1e999,"times":1'));
    expect(readBudget().lines).toEqual([]);

    window.localStorage.setItem(KEY, line('"cents":1,"times":1e999'));
    expect(readBudget().lines).toEqual([]);

    window.localStorage.setItem(KEY, line('"cents":-1e999,"times":1'));
    expect(readBudget().lines).toEqual([]);

    // And the same line with real numbers still comes back, so the guard is
    // rejecting the value rather than the shape.
    window.localStorage.setItem(KEY, line('"cents":1,"times":1'));
    expect(readBudget().lines).toHaveLength(1);
  });
});
