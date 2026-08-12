/**
 * The trade floor as one room, and the halls that still exist underneath it.
 *
 * What is being defended is a pair of opposites. The reader must see one floor,
 * because during the convention the walls between Halls F and K are not there
 * and the aisles run straight through — six outlines with six names draws a
 * building nobody is standing in. And the halls must still be there underneath,
 * because a route goes to one, a search finds one, and every stand's address is
 * one. Merging the drawing must not cost any of that.
 */

import { describe, expect, it } from 'vitest';

import { TRADE_FLOOR, TRADE_FLOOR_NAME, TRADE_HALLS } from './exhibit-floor';
import { ROOMS_BY_ID, roomShapes } from './venues';
import { PLACED_BOOTHS } from './booth-place';

const METRES_PER_DEGREE_LAT = 111320;

/** Even-odd, on a [lat, lng] ring. */
const inRing = (ring: readonly (readonly [number, number])[], lat: number, lng: number) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, aj] = [ring[i], ring[j]];
    if (ai[1] > lng !== aj[1] > lng && lat < ((aj[0] - ai[0]) * (lng - ai[1])) / (aj[1] - ai[1]) + ai[0]) {
      hit = !hit;
    }
  }
  return hit;
};

/** Shoelace, in square metres. */
function area(ring: readonly (readonly [number, number])[]): number {
  const perLng = METRES_PER_DEGREE_LAT * Math.cos((ring[0][0] * Math.PI) / 180);
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum +=
      (ring[j][1] * perLng + ring[i][1] * perLng) *
      (ring[j][0] * METRES_PER_DEGREE_LAT - ring[i][0] * METRES_PER_DEGREE_LAT);
  }
  return Math.abs(sum / 2);
}

describe('the merged trade floor', () => {
  it('names the six halls Gen Con actually trades in', () => {
    expect([...TRADE_HALLS].sort()).toEqual([
      'hall-f',
      'hall-g',
      'hall-h',
      'hall-i',
      'hall-j',
      'hall-k',
    ]);
  });

  it('is one ring, not six', () => {
    expect(TRADE_FLOOR.length).toBeGreaterThan(20);
    expect(TRADE_FLOOR_NAME).toBe('Exhibit Hall');
  });

  it('covers the same floor the six halls did', () => {
    // The union is traced off them, so it must not have lost or gained a hall.
    // Six separate outlines share walls, so their areas sum to a shade more
    // than the merged one rather than exactly it.
    const halls = [...TRADE_HALLS]
      .flatMap((id) => roomShapes(ROOMS_BY_ID[id]))
      .reduce((sum, ring) => sum + area(ring as readonly (readonly [number, number])[]), 0);
    expect(area(TRADE_FLOOR)).toBeGreaterThan(halls * 0.97);
    expect(area(TRADE_FLOOR)).toBeLessThan(halls * 1.03);
  });

  it('contains every stand that was placed in those halls', () => {
    // The reason the merge is safe: a stand's hall is unchanged and a stand's
    // position is still inside the floor drawn over it.
    const outside = PLACED_BOOTHS.filter((stand) => !inRing(TRADE_FLOOR, stand.lat, stand.lng));
    expect(outside.map((one) => one.booth)).toEqual([]);
  });

  it('leaves the halls themselves alone', () => {
    // Still rooms, still shaped, still routable. Only the drawing merged.
    for (const id of TRADE_HALLS) {
      const room = ROOMS_BY_ID[id];
      expect(room, id).toBeDefined();
      expect(roomShapes(room).length, id).toBeGreaterThan(0);
    }
  });

  it('does not swallow the halls that are not the trade floor', () => {
    // A to E are publisher demo halls and keep their own outlines and names.
    for (const id of ['hall-a', 'hall-b', 'hall-c', 'hall-d', 'hall-e']) {
      expect(TRADE_HALLS.has(id), id).toBe(false);
    }
  });
});
