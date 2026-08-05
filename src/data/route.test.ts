/**
 * The router, over the real campus.
 *
 * These assert the properties a route must have rather than particular
 * distances: the metres shift whenever a plan is re-read, and a test that
 * pinned them would fail for a reason nobody cares about. What must not shift
 * is that every pair of buildings has an answer, that a measured route is never
 * passed over for a straight line, and that a straight line is never dressed up
 * as anything else.
 */

import { describe, expect, it } from 'vitest';
import { ROOMS, ROOMS_BY_ID, VENUES, VENUE_LEVELS, venueOutline } from './venues';
import { doorsOf, floorOf } from './walkable';
import { walkBetween } from './route';
import { placeAnchor, roomPlace } from './navigation';

/** One room per building, so the sample covers the campus rather than a corner. */
const perVenue = VENUES.map((venue) => ROOMS.find((room) => room.venueId === venue.id)!).filter(
  Boolean,
);

const routeBetweenRooms = (a: string, b: string) =>
  walkBetween(
    placeAnchor(roomPlace(ROOMS_BY_ID[a]), null)!,
    placeAnchor(roomPlace(ROOMS_BY_ID[b]), null)!,
  );

describe('every building can be reached from every other', () => {
  it('leaves no pair without a route', () => {
    // This is what door nodes exist for. Before them, two rooms in buildings no
    // skywalk joined got no edge at all — 18 of the 182 pairs — because an
    // outdoor edge was only ever drawn from a node that had no square to stand
    // on. The panel fell back to a bearing and nothing looked broken.
    const missing: string[] = [];
    for (const a of perVenue) {
      for (const b of perVenue) {
        if (a === b) continue;
        if (!routeBetweenRooms(a.id, b.id)) missing.push(`${a.venueId} -> ${b.venueId}`);
      }
    }
    expect(missing).toEqual([]);
  }, 60_000);

  it('reaches a building with no floor drawn at all', () => {
    // Lucas Oil has rooms and no circulation on any of its six floors, so the
    // only way to it is the straight line — which must still be offered.
    const walk = routeBetweenRooms('hall-b', 'lucas-oil-field')!;
    expect(walk).not.toBeNull();
    expect(walk.legs.some((leg) => leg.kind === 'outdoor')).toBe(true);
    expect(walk.indoors).toBe(false);
  });
});

describe('a measured route beats a guessed one', () => {
  it('keeps to the skywalks even when crossing the street is shorter', () => {
    // The whole point of the two-pass search. Door to door across Maryland St
    // is about 390 m against 500 m over the skywalks, so one search would take
    // the street every time — and that line goes through whatever stands
    // between the two doors.
    const walk = routeBetweenRooms('hall-b', 'marriott-ballroom')!;
    expect(walk.indoors).toBe(true);
    expect(walk.legs.some((leg) => leg.kind === 'skywalk')).toBe(true);
    expect(walk.legs.some((leg) => leg.kind === 'outdoor')).toBe(false);
  });

  it('stays on one floor when both ends are on it', () => {
    const walk = routeBetweenRooms('hall-a', 'hall-e')!;
    expect(walk.legs).toHaveLength(1);
    expect(walk.legs[0].kind).toBe('walk');
    expect(walk.indoors).toBe(true);
  });

  it('walks further than the straight line, because walls are in the way', () => {
    const walk = routeBetweenRooms('hall-a', 'hall-e')!;
    const from = placeAnchor(roomPlace(ROOMS_BY_ID['hall-a']), null)!.at;
    const to = placeAnchor(roomPlace(ROOMS_BY_ID['hall-e']), null)!.at;
    const straight = Math.hypot((from.lat - to.lat) * 111_320, (from.lng - to.lng) * 85_570);
    expect(walk.metres).toBeGreaterThan(straight);
  });
});

describe('what a leg says it is', () => {
  it('never calls an outdoor leg anything but outside', () => {
    const walk = routeBetweenRooms('hall-b', 'lucas-oil-field')!;
    for (const leg of walk.legs.filter((l) => l.kind === 'outdoor')) {
      expect(leg.text).toMatch(/^Outside/);
    }
  });

  it('sums its legs to the distance it reports', () => {
    // The panel prints both, and a total that disagreed with the steps under it
    // would be the sort of wrong that nobody notices for months.
    for (const [a, b] of [['hall-b', 'marriott-ballroom'], ['hall-b', 'lucas-oil-field']]) {
      const walk = routeBetweenRooms(a, b)!;
      const summed = walk.legs.reduce((total, leg) => total + leg.metres, 0);
      expect(Math.abs(summed - walk.metres), `${a} -> ${b}`).toBeLessThan(0.5);
    }
  });

  it('gives every leg at least two points to draw', () => {
    const walk = routeBetweenRooms('hall-b', 'marriott-ballroom')!;
    for (const leg of walk.legs) expect(leg.points.length).toBeGreaterThanOrEqual(2);
  });
});

describe('doors', () => {
  it('gives every piece of a floor its own way out', () => {
    // One door per floor was the first attempt, and it stranded everything
    // outside the piece the door happened to land in: the JW Marriott, whose
    // ground floor is drawn as several disconnected runs, became unreachable
    // from every building on the campus.
    for (const venue of VENUES) {
      for (const level of VENUE_LEVELS[venue.id] ?? []) {
        const floor = floorOf(venue.id, level);
        if (floor.empty) continue;
        expect(doorsOf(floor, venueOutline(venue)).length, venue.id).toBeGreaterThan(0);
        break;
      }
    }
  });

  it('puts the JW back on the map', () => {
    // The regression this whole guard exists for.
    const walk = routeBetweenRooms('hall-b', 'jw-white-river-abcd');
    expect(walk).not.toBeNull();
  });
});
