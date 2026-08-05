/**
 * What a route between two places may claim.
 *
 * The interesting cases here are all about restraint: the module's job is to
 * say how far apart two points are without implying it knows the way, and
 * every assertion below pins one of the places it deliberately stops short —
 * no walking time across a state, no "you have arrived" through a ceiling, no
 * detail line about a fix that hasn't arrived.
 */

import { describe, expect, it } from 'vitest';
import {
  formatDistance,
  placeDetail,
  placeKey,
  placeLabel,
  placePosition,
  roomPlace,
  routeBetween,
  type DeviceFix,
  type NavPlace,
} from './navigation';
import { ROOMS_BY_ID, roomBounds } from './venues';
import { distanceMetres } from '../utils/geo';

/* Real rooms, so the geometry under these is the geometry the app draws. */
const HALL_B: NavPlace = { kind: 'room', roomId: 'hall-b' };
const SAGAMORE: NavPlace = { kind: 'room', roomId: 'sagamore-ballroom' }; // icc, Level 2
const WABASH: NavPlace = { kind: 'room', roomId: 'wabash-ballroom' }; // icc, Level 1
const JW_GRAND: NavPlace = { kind: 'room', roomId: 'jw-grand-ballroom' }; // another building

const centre = (roomId: string) => {
  const [nw, se] = roomBounds(ROOMS_BY_ID[roomId]);
  return { lat: (nw.lat + se.lat) / 2, lng: (nw.lng + se.lng) / 2 };
};

const fixAt = (lat: number, lng: number, accuracy = 20): DeviceFix => ({
  position: { lat, lng },
  accuracy,
});

describe('placePosition', () => {
  it('puts a room at its door rather than under its label', () => {
    // The label goes in the middle; the door is on the corridor. For a room the
    // size of the Sagamore those are tens of metres apart, and a route measured
    // to the middle is a route drawn through the wall.
    const at = placePosition(SAGAMORE, null)!;
    const middle = centre('sagamore-ballroom');
    expect(at).not.toEqual(middle);
    expect(distanceMetres(at, middle)).toBeGreaterThan(10);
  });

  it('falls back to the centre where no corridor was drawn to be near', () => {
    // Lucas Oil has rooms and no plan of its circulation, so there is nothing
    // for a door to be nearest to.
    const field = { kind: 'room' as const, roomId: 'lucas-oil-field' };
    expect(placePosition(field, null)).toEqual(centre('lucas-oil-field'));
  });

  it('reads the device live rather than from the place itself', () => {
    // The point of storing the device as a marker with no coordinate: the same
    // place resolves to wherever the device is now.
    expect(placePosition({ kind: 'device' }, fixAt(39.5, -86.1))).toEqual({ lat: 39.5, lng: -86.1 });
    expect(placePosition({ kind: 'device' }, fixAt(39.9, -86.2))).toEqual({ lat: 39.9, lng: -86.2 });
  });

  it('has no position for the device until a fix arrives', () => {
    expect(placePosition({ kind: 'device' }, null)).toBeNull();
  });

  it('has no position for a room that does not exist', () => {
    expect(placePosition({ kind: 'room', roomId: 'not-a-room' }, null)).toBeNull();
  });

  it('gives a tapped point back unchanged', () => {
    const position = { lat: 39.7, lng: -86.16 };
    expect(placePosition({ kind: 'point', position }, null)).toEqual(position);
  });
});

describe('placeLabel and placeDetail', () => {
  it('names a room and says which building and floor it is on', () => {
    expect(placeLabel(SAGAMORE)).toBe('Sagamore Ballroom');
    expect(placeDetail(SAGAMORE, null)).toBe('Convention Center · Level 2');
  });

  it('reports the accuracy the device claims, rounded', () => {
    expect(placeDetail({ kind: 'device' }, fixAt(39.7, -86.1, 28.4))).toBe(
      'Accurate to about 28 m',
    );
  });

  it('says nothing about the device while there is no fix', () => {
    // Whether one is still coming or was refused is the panel's note to make;
    // this line has nothing true to say, so it says nothing.
    expect(placeDetail({ kind: 'device' }, null)).toBe('');
  });

  it('gives a tapped point its coordinates, since it has no name', () => {
    expect(placeLabel({ kind: 'point', position: { lat: 39.7, lng: -86.1 } })).toBe(
      'Point on the map',
    );
    expect(placeDetail({ kind: 'point', position: { lat: 39.76802, lng: -86.15292 } }, null)).toBe(
      '39.76802, -86.15292',
    );
  });
});

describe('placeKey', () => {
  it('is stable for the device however far it moves', () => {
    // This is what stops the map refitting itself every few seconds while
    // somebody walks across the campus holding the phone.
    expect(placeKey({ kind: 'device' })).toBe(placeKey({ kind: 'device' }));
  });

  it('separates rooms, points and nothing at all', () => {
    expect(placeKey(SAGAMORE)).not.toBe(placeKey(WABASH));
    expect(placeKey({ kind: 'point', position: { lat: 39.7, lng: -86.1 } })).not.toBe(
      placeKey({ kind: 'point', position: { lat: 39.8, lng: -86.1 } }),
    );
    expect(placeKey(null)).toBe('none');
  });
});

describe('routeBetween', () => {
  it('has no route while an end is unknown', () => {
    expect(routeBetween({ kind: 'device' }, HALL_B, null)).toBeNull();
    expect(routeBetween(HALL_B, { kind: 'device' }, null)).toBeNull();
  });

  it('measures the straight line between the two doors', () => {
    const route = routeBetween(SAGAMORE, WABASH, null)!;
    expect(route.straightMetres).toBeCloseTo(distanceMetres(route.fromAt, route.toAt), 6);
    expect(route.fromAt).toEqual(placePosition(SAGAMORE, null));
    expect(route.toAt).toEqual(placePosition(WABASH, null));
  });

  it('walks further than the straight line, because walls are in the way', () => {
    const route = routeBetween(SAGAMORE, WABASH, null)!;
    expect(route.walk).not.toBeNull();
    expect(route.metres).toBeGreaterThan(route.straightMetres);
    // Every leg of a route inside one building is floor somebody drew.
    expect(route.walk!.indoors).toBe(true);
  });

  it('estimates a walk at the unhurried pace geo.ts sets', () => {
    const route = routeBetween(SAGAMORE, WABASH, null)!;
    expect(route.minutes).toBe(Math.max(1, Math.round(route.metres / 70)));
  });

  it('routes over the skywalks rather than through the wall between buildings', () => {
    const route = routeBetween(HALL_B, { kind: 'room', roomId: 'marriott-ballroom' }, null)!;
    expect(route.walk).not.toBeNull();
    const kinds = route.walk!.legs.map((leg) => leg.kind);
    expect(kinds).toContain('skywalk');
    // Nothing outdoors: the whole way across is under cover, which is the
    // reason anybody wants this route in August.
    expect(kinds).not.toContain('outdoor');
  });

  it('refuses to estimate a walk from beyond the campus', () => {
    // Somebody planning the trip from home. A walking time here would be a
    // joke rather than an estimate, so there isn't one.
    const route = routeBetween({ kind: 'device' }, HALL_B, fixAt(40.5, -83.0))!;
    expect(route.metres).toBeGreaterThan(3_000);
    expect(route.minutes).toBeNull();
    expect(route.arrived).toBe(false);
  });

  it('still estimates a walk just inside the limit', () => {
    // 3 km is the cut-off, so a route a little under it keeps its estimate.
    const from = centre('hall-b');
    const route = routeBetween({ kind: 'point', position: { lat: from.lat + 0.02, lng: from.lng } }, HALL_B, null)!;
    expect(route.metres).toBeLessThan(3_000);
    expect(route.minutes).not.toBeNull();
  });

  it('notes a floor change between two rooms in one building', () => {
    const route = routeBetween(SAGAMORE, WABASH, null)!;
    expect(route.floorChange).toEqual({ from: 'Level 2', to: 'Level 1' });
    expect(route.venueChange).toBeNull();
  });

  it('notes the buildings instead when the two are in different ones', () => {
    const route = routeBetween(SAGAMORE, JW_GRAND, null)!;
    expect(route.floorChange).toBeNull();
    expect(route.venueChange).toEqual({ from: 'Convention Center', to: 'JW Marriott' });
  });

  it('has neither note when an end is not a room', () => {
    const route = routeBetween({ kind: 'device' }, HALL_B, fixAt(39.766, -86.165))!;
    expect(route.floorChange).toBeNull();
    expect(route.venueChange).toBeNull();
  });

  it('says you have arrived when both ends are the same room', () => {
    expect(routeBetween(HALL_B, HALL_B, null)!.arrived).toBe(true);
  });

  it('says you have arrived from a point a few paces away', () => {
    const door = placePosition(HALL_B, null)!;
    // ~5 m north of the door, which is nearer than the arrival radius.
    const near = { kind: 'point' as const, position: { lat: door.lat + 0.000045, lng: door.lng } };
    const route = routeBetween(near, HALL_B, null)!;
    expect(route.straightMetres).toBeLessThan(12);
    expect(route.arrived).toBe(true);
  });

  it('never says you have arrived through a ceiling', () => {
    // The Hyatt's Theory is on the 2nd and its Vision is directly over it on
    // the 3rd: nothing apart on a flat map, and a staircase apart in the
    // building. Distance alone would call that an arrival; the floor change
    // vetoes it. Pick a pair that really does stack, or this asserts nothing —
    // the guard is only reached inside the arrival radius.
    const downstairs = ROOMS_BY_ID['hyatt-theory'];
    const upstairs = ROOMS_BY_ID['hyatt-vision'];
    expect(upstairs.venueId).toBe(downstairs.venueId);
    expect(upstairs.level).not.toBe(downstairs.level);

    const route = routeBetween(roomPlace(downstairs), roomPlace(upstairs), null)!;
    expect(route.straightMetres).toBeLessThan(12);
    expect(route.floorChange).toEqual({ from: '2nd floor', to: '3rd floor' });
    expect(route.arrived).toBe(false);
  });
});

describe('formatDistance', () => {
  it('rounds to ten metres up close', () => {
    expect(formatDistance(148)).toBe('150 m');
    expect(formatDistance(262)).toBe('260 m');
  });

  it('never claims better than ten metres, whatever the maths says', () => {
    // The ends are room centres, so a sub-10 m figure would be false precision.
    expect(formatDistance(3)).toBe('10 m');
    expect(formatDistance(0)).toBe('10 m');
  });

  it('switches to kilometres, with a decimal only where it means something', () => {
    expect(formatDistance(1_240)).toBe('1.2 km');
    expect(formatDistance(282_000)).toBe('282 km');
  });
});
