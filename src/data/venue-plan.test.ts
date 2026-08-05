/**
 * The hallways and room outlines read out of the hotels' own plans.
 *
 * `venue-plans.mjs` writes this file from fifteen sheets of pixels, and both
 * halves of it are keyed by strings — a floor by `venueId/level`, a room by its
 * id. A key that names nothing draws nothing, silently: the floor keeps the
 * blank interior it had before, which is exactly what an unread sheet looks
 * like. So the keys are what these check.
 */

import { describe, expect, it } from 'vitest';
import { VENUE_HALLS, VENUE_ROOM_SHAPES } from './venue-plan';
import { ROOMS_BY_ID, VENUES_BY_ID, VENUE_LEVELS } from './venues';

describe('VENUE_HALLS', () => {
  it('covers the fifteen floors the plans were read for', () => {
    expect(Object.keys(VENUE_HALLS)).toHaveLength(15);
  });

  it('keys every floor to a building and a floor that building has', () => {
    for (const key of Object.keys(VENUE_HALLS)) {
      const at = key.indexOf('/');
      const [venueId, level] = [key.slice(0, at), key.slice(at + 1)];
      expect(VENUES_BY_ID[venueId], key).toBeDefined();
      expect(VENUE_LEVELS[venueId] ?? [], key).toContain(level);
    }
  });

  it('draws each hall as a closed ring of downtown coordinates', () => {
    for (const [key, halls] of Object.entries(VENUE_HALLS)) {
      expect(halls.length, key).toBeGreaterThan(0);
      for (const hall of halls) {
        // A hall is a polygon with holes: the outside first, then any rooms it
        // runs around. Every ring of it needs enough points to be an area.
        for (const ring of hall) {
          expect(ring.length, key).toBeGreaterThanOrEqual(3);
          for (const [lat, lng] of ring) {
            expect(lat, key).toBeGreaterThan(39.7);
            expect(lat, key).toBeLessThan(39.8);
            expect(lng, key).toBeGreaterThan(-86.2);
            expect(lng, key).toBeLessThan(-86.1);
          }
        }
      }
    }
  });
});

describe('VENUE_ROOM_SHAPES', () => {
  it('keys every outline to a room that exists', () => {
    for (const roomId of Object.keys(VENUE_ROOM_SHAPES)) {
      expect(ROOMS_BY_ID[roomId], roomId).toBeDefined();
    }
  });

  it('only replaces rectangles in buildings whose plans were read', () => {
    // A traced outline belongs to the floor its sheet was read from; one keyed
    // to a room on a floor with no sheet could not have come from anywhere.
    for (const roomId of Object.keys(VENUE_ROOM_SHAPES)) {
      const room = ROOMS_BY_ID[roomId];
      expect(VENUE_HALLS[`${room.venueId}/${room.level}`], roomId).toBeDefined();
    }
  });

  it('takes only the few that earned the swap', () => {
    // Feeding all of them in put thirteen rooms through a wall and seven onto
    // their neighbours; a traced shape is taken only where it is no worse than
    // the rectangle. If this number climbs, that bar has been lowered — run
    // `npm run check:geometry`, which is what it was lowered past.
    const count = Object.keys(VENUE_ROOM_SHAPES).length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(30);
  });
});
