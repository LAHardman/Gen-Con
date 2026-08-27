/**
 * The whole point of the pack, proven on the real modules: a stored table
 * stashed before boot replaces the compiled snapshot, and a malformed one
 * does not.
 *
 * These import `exhibitors.ts` *after* stashing, the way `main.tsx` does —
 * which is exactly the ordering the boot sequence exists to provide, and
 * exactly what a static import in the wrong place would silently break.
 * `vi.resetModules` stands in for a fresh launch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { stashPack } from './pack-runtime';

afterEach(() => {
  stashPack({});
  vi.resetModules();
});

describe('booting on a stored pack', () => {
  it('a held exhibitors table replaces the snapshot', async () => {
    stashPack({
      exhibitors: {
        tags: ['New Tag'],
        exhibitors: [{ name: 'Fresh Stand', kind: 'Exhibitors', area: 'Exhibit Hall', spot: 'Booth 1', booth: '1', tags: [0] }],
      },
    });
    const { EXHIBITORS, tagsOf } = await import('./exhibitors');
    expect(EXHIBITORS).toHaveLength(1);
    expect(EXHIBITORS[0].name).toBe('Fresh Stand');
    expect(tagsOf(EXHIBITORS[0])).toEqual(['New Tag']);
  });

  it('a malformed table falls back to the snapshot, which is never absent', async () => {
    // Parsed, hash-clean JSON of the wrong shape — the guard is the gate
    // that knows what the words mean, and its answer is the snapshot.
    stashPack({ exhibitors: { tags: 'oops', exhibitors: 'also oops' } });
    const { EXHIBITORS } = await import('./exhibitors');
    expect(EXHIBITORS.length).toBeGreaterThan(800);
  });

  it('the partners table follows the same rule', async () => {
    stashPack({
      partners: {
        year: 2030,
        growth: null,
        suspected: [],
        partners: [{ blockName: 'A Hotel', placeId: null, low: 100, high: null, region: 'downtown', skywalk: false, distance: '1 Block' }],
      },
    });
    const { BLOCK_YEAR, PARTNERS } = await import('./partners');
    expect(BLOCK_YEAR).toBe(2030);
    expect(PARTNERS).toHaveLength(1);
  });
});
