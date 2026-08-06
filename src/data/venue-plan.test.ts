/**
 * The hallways and room outlines read out of Gen Con's plans.
 *
 * `venue-plans.mjs` writes this file from two kinds of pixels — fifteen
 * screenshots of single hotels, and Gen Con's campus tiles, which are one
 * drawing of a mile of downtown — and both halves of it are keyed by strings:
 * a floor by `venueId/level`, a room by its id. A key that names nothing draws
 * nothing, silently: the floor keeps the blank interior it had before, which is
 * exactly what an unread sheet looks like. So the keys are what these check.
 */

import { describe, expect, it } from 'vitest';
import { VENUE_HALLS, VENUE_ROOM_SHAPES, VENUE_VERTICAL } from './venue-plan';
import { ROOMS_BY_ID, VENUES_BY_ID, VENUE_LEVELS, venueBounds } from './venues';

describe('VENUE_HALLS', () => {
  it('covers every floor a sheet was read for, by name', () => {
    // Named rather than counted, because the failure being guarded against is
    // one sheet quietly dropping out — `plans/campus/` is not committed, so a
    // rebuild without it loses six of these and the file still looks healthy.
    // A count would also pass if one floor were swapped for another.
    expect(Object.keys(VENUE_HALLS).sort()).toEqual([
      'crowne-plaza/1st floor',
      'crowne-plaza/Mezzanine',
      // From the campus sheets: the Embassy's street entrance is its 2nd.
      'embassy-suites/2nd floor',
      'embassy-suites/5th floor',
      'hilton/1st floor',
      'hilton/2nd floor',
      'hilton/9th floor',
      'hyatt/1st floor',
      'hyatt/2nd floor',
      'hyatt/3rd floor',
      'jw-marriott/1st floor',
      'jw-marriott/2nd floor',
      'jw-marriott/3rd floor',
      'le-meridien/1st floor',
      'le-meridien/2nd floor',
      // The stadium has three storeys here, not the six it used to claim:
      // Gen Con's level 0 draws the halls, the meeting rooms and the field
      // together, because they are one floor.
      'lucas-oil/Concourse level',
      'lucas-oil/Event level',
      'lucas-oil/Lower Suite level',
      'marriott-downtown/1st floor',
      'marriott-downtown/2nd floor',
      'omni/1st floor',
      'omni/2nd floor',
      'westin/1st floor',
      'westin/2nd floor',
    ]);
  });

  it('keeps every floor inside the building it belongs to', () => {
    // The campus sheets are a mile of downtown, so a floor read off one is
    // clipped to its venue's footprint before anything is traced. Without that
    // clip the JW's 2nd floor came out as every cream corridor between Georgia
    // Street and the stadium — eighteen shapes spanning 1138 by 858 metres,
    // nine times the hotel, and 22,419 m² of "walkable" surface.
    //
    // Ten metres of slack, in metres rather than degrees so it means something:
    // the sheets of single hotels are *fitted* rather than georeferenced, and a
    // fit is a few metres out at the edges by its nature. That is far below
    // what this is looking for.
    const SLACK = 10;
    for (const [key, halls] of Object.entries(VENUE_HALLS)) {
      const [nw, se] = venueBounds(VENUES_BY_ID[key.slice(0, key.indexOf('/'))]);
      const perLng = 111_320 * Math.cos((nw.lat * Math.PI) / 180);
      for (const hall of halls) {
        for (const ring of hall) {
          for (const [lat, lng] of ring) {
            expect((lat - nw.lat) * 111_320, `${key} north of it`).toBeLessThan(SLACK);
            expect((se.lat - lat) * 111_320, `${key} south of it`).toBeLessThan(SLACK);
            expect((nw.lng - lng) * perLng, `${key} west of it`).toBeLessThan(SLACK);
            expect((lng - se.lng) * perLng, `${key} east of it`).toBeLessThan(SLACK);
          }
        }
      }
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
