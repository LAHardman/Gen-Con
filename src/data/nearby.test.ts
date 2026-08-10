/**
 * The table, and the two ways it can lie.
 *
 * It can be *stale* — a room moved or was added and nobody re-ran the build —
 * which no amount of internal consistency would show, so a sample of it is
 * re-routed here for real and compared. And it can be *misread* — a packing
 * bug, a wrong index, the bytes taken in the wrong order — which would give
 * plausible-looking numbers for the wrong pairs. Both are checked against the
 * router itself rather than against another copy of the table's own arithmetic.
 */

import { describe, expect, it } from 'vitest';
import { ROOMS } from './venues';
import { routeBetween } from './navigation';
import { hallForBooth } from './booths';
import { DISTANCE_ROOMS } from './distances';
import {
  formatRough,
  metresBetweenRooms,
  nearestDoorway,
  roomDoorway,
  roughMetres,
  roughMinutes,
} from './nearby';

/** Two rooms far enough apart that the walk is a real one, and two that are not. */
const FAR = ['hall-a', 'westin-grand-ballroom'] as const;
const NEAR = ['hall-a', 'hall-b'] as const;

describe('the table against the router', () => {
  it('holds every room the app can route to', () => {
    // The staleness that nothing else would catch: a room added to venues.ts
    // and the build never re-run. Its row would simply be absent, and every
    // estimate involving it would quietly say nothing at all.
    const missing = ROOMS.map((room) => room.id).filter((id) => !DISTANCE_ROOMS.includes(id));
    expect(missing).toEqual([]);
    expect(DISTANCE_ROOMS.length).toBe(ROOMS.length);
  });

  it('gives the same metres a real route does', () => {
    // The other half of staleness: a room that MOVED rather than appeared, so
    // its row is present and wrong. Only a sample can catch that here — the
    // build checks 27 pairs and this checks eight, spread over every kind of
    // walk on the campus, because each one costs a real route.
    const pairs: Array<[string, string]> = [
      ['hall-a', 'hall-k'],
      ['hall-i', 'westin-grand-ballroom'],
      ['crowne-illinois-ballroom', 'marriott-ballroom'],
      ['rooms-101-117', 'ballroom-500'],
      ['sagamore-ballroom', 'union-grand-hall'],
      ['jw-grand-ballroom', 'hyatt-regency-ballroom'],
      ['omni-severin-ballroom', 'lucas-oil-exhibit-halls'],
      ['embassy-ambassador', 'hilton-victory-ballroom'],
    ];
    for (const [a, b] of pairs) {
      const real = routeBetween({ kind: 'room', roomId: a }, { kind: 'room', roomId: b }, null);
      expect(real?.metres).toBeDefined();
      // To within half a step: the table holds 16-metre steps, which is seven
      // seconds' walking under an answer printed in whole minutes.
      expect(Math.abs(metresBetweenRooms(a, b)! - real!.metres)).toBeLessThanOrEqual(8);
    }
  });

  it('reads the same walk in either direction', () => {
    for (const [a, b] of [FAR, NEAR]) {
      expect(metresBetweenRooms(a, b)).toBe(metresBetweenRooms(b, a));
    }
  });

  it('gives each pair its own answer rather than one number for all of them', () => {
    // A packing bug that read the same cell every time would pass everything
    // above this line. Hall A to Hall B is a walk across a floor; Hall A to the
    // Westin is a walk across the campus.
    expect(metresBetweenRooms(...NEAR)!).toBeLessThan(metresBetweenRooms(...FAR)!);
    expect(metresBetweenRooms(...FAR)!).toBeGreaterThan(300);
  });

  it('holds nothing absurd anywhere in it', () => {
    // The bytes taken in the wrong order turn 200 m into 51,200 m, which is the
    // kind of wrong that shows up as a plausible number in one cell and a
    // ridiculous one in another.
    for (let i = 0; i < DISTANCE_ROOMS.length; i += 1) {
      for (let j = i + 1; j < DISTANCE_ROOMS.length; j += 1) {
        const metres = metresBetweenRooms(DISTANCE_ROOMS[i], DISTANCE_ROOMS[j]);
        if (metres === null) continue;
        expect(metres).toBeGreaterThan(0);
        expect(metres).toBeLessThan(4_000);
      }
    }
  });
});

describe('the minute on top', () => {
  it('adds exactly one to what the route would say', () => {
    const real = routeBetween(
      { kind: 'room', roomId: FAR[0] },
      { kind: 'room', roomId: FAR[1] },
      null,
    );
    expect(roughMinutes({ roomId: FAR[0] }, { roomId: FAR[1] })).toBe(real!.minutes! + 1);
  });

  it('does not add it to a walk that is not one', () => {
    // "You are here, in about a minute" is the one case anybody can check by
    // looking up, and getting it wrong would discredit every other number.
    expect(roughMinutes({ roomId: 'hall-a' }, { roomId: 'hall-a' })).toBe(0);
    expect(formatRough(0)).toBe('you are here');
  });
});

describe('a spot that is not a room', () => {
  const door = roomDoorway('hall-a')!;

  it('answers from where the phone says you are', () => {
    const real = routeBetween(
      { kind: 'room', roomId: 'hall-a' },
      { kind: 'room', roomId: 'westin-grand-ballroom' },
      null,
    );
    const rough = roughMinutes({ at: door }, { roomId: 'westin-grand-ballroom' })!;
    // Measured across 528 room pairs: standing on a doorway this is the
    // padding and nothing else, and 21 m off it stays inside two minutes.
    expect(Math.abs(rough - real!.minutes!)).toBeLessThanOrEqual(2);
  });

  it('picks the doorway you are standing on, not one across the street', () => {
    expect(nearestDoorway(door)!.roomId).toBe('hall-a');
    expect(nearestDoorway(door)!.metres).toBeLessThan(1);
  });

  it('charges the walk to the doorway as well as the walk from it', () => {
    // Somebody a hundred metres from the nearest way in has a hundred metres
    // more to walk than somebody standing in it, and an estimate that ignored
    // that would read short for everybody outdoors.
    const away = { lat: door.lat + 0.0009, lng: door.lng }; // ~100 m north
    const snap = nearestDoorway(away)!;
    const gap = roughMetres({ at: away }, { roomId: 'westin-grand-ballroom' })!
      - metresBetweenRooms(snap.roomId, 'westin-grand-ballroom')!;
    // Charged at more than the straight line, because downtown is a grid you
    // cannot walk a diagonal across — and charged at all, which is the half of
    // this that an estimate ignoring the gap would fail.
    expect(gap).toBeGreaterThan(snap.metres);
    expect(gap).toBeLessThan(snap.metres * 1.5);
  });

  it('does not call two ends of one hall the same place', () => {
    // Both ends are the same room, so the table has nothing to say about the
    // pair — but the exhibit halls are the size of a street, and reporting no
    // walk at all between two stands in Hall A would be wrong by the length of
    // one. Where both ends know where they are, the line between them is what
    // is left to measure.
    const far = { lat: door.lat, lng: door.lng - 0.0018 }; // ~150 m into the hall
    const across = roughMetres({ roomId: 'hall-a', at: door }, { roomId: 'hall-a', at: far })!;
    expect(across).toBeGreaterThan(150);
    expect(roughMinutes({ roomId: 'hall-a', at: door }, { roomId: 'hall-a', at: far })).toBeGreaterThan(1);
  });

  it('calls the room you are in no walk at all', () => {
    // The other half of the same branch: only one end knows where it is, so
    // there is nothing left to measure and it really is zero.
    expect(roughMetres({ at: door }, { roomId: 'hall-a' })).toBe(0);
  });

  it('prefers the room it was given over the position it was given', () => {
    // A search result knows its room exactly; the fix beside it is a guess at
    // the same thing, and the exact answer should win.
    const inTheWestin = roomDoorway('westin-grand-ballroom')!;
    expect(roughMetres({ roomId: 'hall-a', at: inTheWestin }, { roomId: 'hall-b' })).toBe(
      roughMetres({ roomId: 'hall-a' }, { roomId: 'hall-b' }),
    );
  });
});

describe('a booth is its hall', () => {
  it('estimates to the hall the stand is in', () => {
    // There is no row for stand 1229 and there should not be: the halls are one
    // open floor and the walk is to the hall.
    const hall = hallForBooth('1229')!;
    expect(hall).toBe('hall-i');
    expect(roughMinutes({ roomId: 'westin-grand-ballroom' }, { roomId: hall })).toBe(
      roughMinutes({ roomId: 'westin-grand-ballroom' }, { roomId: 'hall-i' }),
    );
  });
});

describe('when there is nothing to say', () => {
  it('says nothing rather than guessing', () => {
    expect(metresBetweenRooms('hall-a', 'no-such-room')).toBeNull();
    expect(roughMinutes({ roomId: 'no-such-room' }, { roomId: 'hall-a' })).toBeNull();
    expect(roughMinutes({}, { roomId: 'hall-a' })).toBeNull();
    expect(roomDoorway('no-such-room')).toBeNull();
  });
});
