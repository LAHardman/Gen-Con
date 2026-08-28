/**
 * Every generated table, held to the two promises the pack makes of it.
 *
 * FIRST, THAT NOTHING IS LOST ON THE WAY THROUGH JSON. The build lifts
 * these constants out of the compiled modules and serialises them; anything
 * JSON cannot carry — an `undefined` in an array, a Map, a NaN — comes back
 * different, or does not come back at all. That failure is silent and it is
 * shaped exactly like the ones this project keeps guarding against: the app
 * still runs, the table is still a table, and a floor plan quietly has a
 * hole in it. So each one is round-tripped and compared whole.
 *
 * SECOND, THAT AN OVERRIDE ACTUALLY LANDS. A pack that downloads, verifies
 * and stores perfectly is worth nothing if the module goes on reading its
 * compiled copy — which is the one way this whole architecture could be
 * quietly inert. So the overlay is driven on the real modules, in both
 * directions: a good table replaces, a malformed one does not.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { stashPack } from './pack-runtime';

/** The same map `scripts/build-pack.mjs` extracts by. */
const TABLES: Record<string, string[]> = {
  'venue-plan': ['VENUE_HALLS', 'VENUE_VERTICAL', 'VENUE_ROOM_SHAPES'],
  'plan-geometry': ['PLAN_SHAPES', 'PLAN_DETAIL', 'PLAN_LEVELS', 'PLAN_OUTLINE'],
  lodging: ['LODGING', 'PULLED'],
  rates: ['RATES', 'REFRESHED', 'STAY', 'WALK_FLOOR'],
  listings: ['LISTINGS', 'FOUND'],
  'booth-place': ['PLACED_BOOTHS'],
  'booth-plan': ['PLANNED_BOOTHS', 'PLAN_FLOOR', 'PLAN_ENTRANCES'],
  eateries: ['EATERIES', 'PULLED'],
  pavements: ['PAVEMENT_NODES', 'PAVEMENT_EDGES'],
  addresses: ['ADDRESSES'],
  footprints: ['VENUE_FOOTPRINTS'],
  booths: ['HALL_DIVIDES', 'ACROSS_THE_AISLES'],
};

const load = (name: string) => import(`./${name}.ts`);

afterEach(() => {
  stashPack({});
  vi.resetModules();
});

describe('what the build lifts into the pack', () => {
  it.each(Object.entries(TABLES))('%s survives the round trip through JSON', async (name, constants) => {
    const module = (await load(name)) as Record<string, unknown>;
    for (const constant of constants) {
      // Present at all: the build throws on a renamed export, and this is
      // the same check from the other side.
      expect(module[constant], `${name}.${constant}`).toBeDefined();
      const there = JSON.parse(JSON.stringify(module[constant]));
      expect(there, `${name}.${constant} changed shape through JSON`).toEqual(module[constant]);
    }
  });

  it('carries real data rather than empty shells', async () => {
    // A table that serialises to `[]` would round-trip perfectly and mean
    // nothing, so the sizes are asserted too — loosely, since they grow.
    const { PLACED_BOOTHS } = await load('booth-place');
    const { ADDRESSES } = await load('addresses');
    const { PAVEMENT_NODES } = await load('pavements');
    expect((PLACED_BOOTHS as unknown[]).length).toBeGreaterThan(400);
    expect((ADDRESSES as unknown[]).length).toBeGreaterThan(500);
    expect((PAVEMENT_NODES as unknown[]).length).toBeGreaterThan(100);
  });
});

describe('an override arriving in the pack', () => {
  it('replaces the compiled constant', async () => {
    stashPack({ footprints: { VENUE_FOOTPRINTS: { 'made-up': [[1, 2]] } } });
    const { VENUE_FOOTPRINTS } = (await load('footprints')) as Record<string, unknown>;
    expect(VENUE_FOOTPRINTS).toEqual({ 'made-up': [[1, 2]] });
  });

  it('replaces one constant and leaves its neighbours alone', async () => {
    // The reason the overlay is per key: these are independent constants
    // that happen to share a file, and a refresh may carry only one.
    const before = (await load('eateries')) as Record<string, unknown>;
    const eateries = before.EATERIES;
    vi.resetModules();
    stashPack({ eateries: { PULLED: '2030-01-01' } });
    const after = (await load('eateries')) as Record<string, unknown>;
    expect(after.PULLED).toBe('2030-01-01');
    expect(after.EATERIES).toEqual(eateries);
  });

  it('keeps the compiled value when the shape is wrong', async () => {
    // An array where an object belongs. The compiled table stands, and the
    // app draws the campus it shipped with rather than nothing at all.
    stashPack({ footprints: { VENUE_FOOTPRINTS: ['not an object'] } });
    const { VENUE_FOOTPRINTS } = (await load('footprints')) as Record<string, Record<string, unknown>>;
    expect(Array.isArray(VENUE_FOOTPRINTS)).toBe(false);
    expect(Object.keys(VENUE_FOOTPRINTS).length).toBeGreaterThan(5);
  });

  it('recomputes what was derived from an overridden table', async () => {
    // `WALKABLE` is filtered out of `LODGING` at load. If the overlay ran
    // after that, a refreshed hotel list would draw the old walk ring —
    // right data, wrong derivation, and nothing to see.
    stashPack({
      lodging: {
        LODGING: [
          { id: 'a', name: 'Near', kind: 'hotel', metres: 100, ring: 'walk', lat: 0, lon: 0 },
          { id: 'b', name: 'Far', kind: 'hotel', metres: 20000, ring: 'drive', lat: 0, lon: 0 },
        ],
      },
    });
    const { LODGING, WALKABLE } = (await load('lodging')) as Record<string, unknown[]>;
    expect(LODGING).toHaveLength(2);
    expect(WALKABLE).toHaveLength(1);
    expect((WALKABLE[0] as { id: string }).id).toBe('a');
  });
});
