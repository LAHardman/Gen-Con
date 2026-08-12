/**
 * The Block Party's pitches, and how far they may be believed.
 *
 * These positions are derived rather than surveyed — Gen Con's numbering laid
 * evenly along the kerbs of a street OpenStreetMap measured — so what is worth
 * defending is not where any one truck is. It is that the row is the right
 * length, in the right order, on the right side, and on the street: the four
 * things that make "which end is Arepas at" answerable at all.
 */

import { describe, expect, it } from 'vitest';

import { PITCHES, TRUCK_PITCH_METRES } from './block-party';
import { EXHIBITORS } from './exhibitors';
import { VENUES_BY_ID } from './venues';

const street = VENUES_BY_ID['block-party'];

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

describe('the Block Party pitches', () => {
  it('has one for every trader Gen Con lists on the street', () => {
    const listed = EXHIBITORS.filter((one) => one.area === 'Block Party' && one.booth);
    expect(PITCHES).toHaveLength(listed.length);
    expect(new Set(PITCHES.map((one) => one.spot)).size).toBe(PITCHES.length);
  });

  it('puts every one of them on the street', () => {
    // The whole claim. A truck drawn on the pavement, or in the stadium car
    // park across the road, is worse than no truck drawn at all.
    const off = PITCHES.filter((one) => !inRing(street.footprint, one.lat, one.lng));
    expect(off.map((one) => one.spot)).toEqual([]);
  });

  it('runs the trucks up one side and the stands down the other', () => {
    const trucks = PITCHES.filter((one) => one.side === 'north');
    const stands = PITCHES.filter((one) => one.side === 'south');
    expect(trucks.every((one) => /Food Truck/.test(one.spot))).toBe(true);
    expect(stands.every((one) => /Booth BP/.test(one.spot))).toBe(true);
    /*
     * And on opposite sides of the middle of the street — measured as the
     * midpoint of its latitudes rather than the mean of its vertices, because
     * the north kerb is surveyed in twelve points and the south in five, so a
     * vertex mean sits well north of the centre line.
     */
    const lats = street.footprint.map((p) => p[0]);
    const middle = (Math.min(...lats) + Math.max(...lats)) / 2;
    expect(trucks.every((one) => one.lat > middle)).toBe(true);
    expect(stands.every((one) => one.lat < middle)).toBe(true);
  });

  it('runs both rows in Gen Con’s own order, west to east', () => {
    /*
     * The order is the only thing here that is Gen Con's rather than this
     * app's, so it is the one thing that has to survive exactly — and on both
     * kerbs, since the street ring is walked east to west down the south side
     * and the numbering is not.
     */
    for (const side of ['north', 'south'] as const) {
      const row = PITCHES.filter((one) => one.side === side);
      const number = (one: (typeof PITCHES)[number]) => Number(one.booth.replace(/\D/g, ''));
      const byNumber = [...row].sort((a, b) => number(a) - number(b));
      expect(byNumber.map((one) => one.spot), side).toEqual(row.map((one) => one.spot));
      for (let i = 1; i < byNumber.length; i += 1) {
        expect(byNumber[i].lng, `${side} ${byNumber[i].spot}`).toBeGreaterThan(
          byNumber[i - 1].lng,
        );
      }
    }
  });

  it('spaces them wide enough to park in', () => {
    // A food truck with its serving side is about nine metres. If a future
    // year's list no longer fits the street, the row is a fiction.
    expect(TRUCK_PITCH_METRES).toBeGreaterThanOrEqual(9);
  });
});
