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
import { VENUE_HALLS, VENUE_ROOM_SHAPES, VENUE_VERTICAL } from './venue-plan';
import { ROOMS_BY_ID, VENUES_BY_ID, VENUE_LEVELS, venueBounds } from './venues';

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

describe('VENUE_VERTICAL', () => {
  it('keys every stair to a building and a floor that building has', () => {
    for (const key of Object.keys(VENUE_VERTICAL)) {
      const at = key.indexOf('/');
      const [venueId, level] = [key.slice(0, at), key.slice(at + 1)];
      expect(VENUES_BY_ID[venueId], key).toBeDefined();
      expect(VENUE_LEVELS[venueId] ?? [], key).toContain(level);
    }
  });

  it('puts every mark inside the building it belongs to', () => {
    // These are read off a sheet by colour and placed by a fit, and the one
    // failure mode that matters is a fit gone wrong — which shows up as a
    // staircase out in the street rather than as an exception.
    for (const [key, marks] of Object.entries(VENUE_VERTICAL)) {
      const venue = VENUES_BY_ID[key.slice(0, key.indexOf('/'))];
      const [nw, se] = venueBounds(venue);
      for (const [lat, lng] of marks) {
        expect(lat, key).toBeLessThanOrEqual(nw.lat + 0.0005);
        expect(lat, key).toBeGreaterThanOrEqual(se.lat - 0.0005);
        expect(lng, key).toBeGreaterThanOrEqual(nw.lng - 0.0005);
        expect(lng, key).toBeLessThanOrEqual(se.lng + 0.0005);
      }
    }
  });

  it('reads the convention centre from the campus sheets', () => {
    // The building with the most floor-changing on it, and for a while the one
    // this could not read: its own plans are the architect's and key five kinds
    // of space, none of them vertical. Gen Con's campus sheets draw the
    // escalators and letter them UP TO 2ND FLOOR, and a georeference rather
    // than a fit is what finally placed those sheets.
    //
    // If this fails with the entries missing, the likely cause is a rebuild
    // run without `plans/campus` — which is gitignored. `npm run plans:campus`
    // fetches it, and the script warns when it is absent.
    expect(VENUE_VERTICAL['icc/Level 1']?.length).toBeGreaterThan(0);
    expect(VENUE_VERTICAL['icc/Level 2']?.length).toBeGreaterThan(0);
  });
});
