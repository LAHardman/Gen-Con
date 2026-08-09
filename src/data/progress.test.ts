/**
 * Following somebody along a route without pulling it out from under them.
 *
 * None of this can be checked by using the app: it needs a position that moves,
 * indoors, on a campus nobody testing this is standing on. So the measuring is
 * a pure function and these are the walk somebody actually takes — down the
 * line, off the line, round a corner, and standing still with a bad fix.
 */

import { describe, expect, it } from 'vitest';
import { routeProgress } from './progress';
import type { Walk } from './route';

/** A hundred metres due east, in two fifty-metre legs. */
const EAST = 0.001167; // ~100 m of longitude at this latitude
const walk = (over: Partial<Walk> = {}): Walk => ({
  legs: [
    {
      kind: 'walk',
      points: [{ lat: 39.7635, lng: -86.1640 }, { lat: 39.7635, lng: -86.1640 + EAST / 2 }],
      metres: 50,
      text: 'first',
    },
    {
      kind: 'walk',
      points: [{ lat: 39.7635, lng: -86.1640 + EAST / 2 }, { lat: 39.7635, lng: -86.1640 + EAST }],
      metres: 50,
      text: 'second',
    },
  ],
  metres: 100,
  minutes: 2,
  indoors: true,
  viaStairs: false,
  ...over,
});

describe('how far along', () => {
  it('reports nothing walked at the start', () => {
    const at = { lat: 39.7635, lng: -86.1640 };
    const progress = routeProgress(walk(), at)!;
    expect(progress.alongMetres).toBeLessThan(2);
    expect(progress.remainingMetres).toBeGreaterThan(98);
    expect(progress.onRoute).toBe(true);
  });

  it('counts down as somebody walks it', () => {
    // The whole point: the time left has to shrink while they move, and it can
    // only do that if the distance left does.
    const seen = [0, 0.25, 0.5, 0.75, 1].map(
      (part) => routeProgress(walk(), { lat: 39.7635, lng: -86.1640 + EAST * part })!.remainingMetres,
    );
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeLessThan(seen[i - 1]);
    expect(seen[0]).toBeGreaterThan(95);
    expect(seen[4]).toBeLessThan(5);
  });

  it('crosses a leg boundary without jumping', () => {
    const before = routeProgress(walk(), { lat: 39.7635, lng: -86.1640 + EAST * 0.49 })!;
    const after = routeProgress(walk(), { lat: 39.7635, lng: -86.1640 + EAST * 0.51 })!;
    expect(after.alongMetres - before.alongMetres).toBeLessThan(6);
    expect(after.alongMetres).toBeGreaterThan(before.alongMetres);
  });

  it('measures against the whole route, not the first bit of it near you', () => {
    // A route that doubles back passes its own start. Taking the first segment
    // within some radius would call somebody nearly finished barely started.
    const there = { lat: 39.7635, lng: -86.1640 + EAST };
    const back = walk({
      legs: [
        { kind: 'walk', points: [{ lat: 39.7635, lng: -86.1640 }, there], metres: 100, text: 'out' },
        { kind: 'walk', points: [there, { lat: 39.7635, lng: -86.1640 }], metres: 100, text: 'back' },
      ],
      metres: 200,
    });
    // Standing at the far end, having walked out but not back.
    const progress = routeProgress(back, there)!;
    expect(progress.offMetres).toBeLessThan(2);
    // Either 100 (out) or 100 (start of back) — both are 100 along, and what
    // matters is that it is not reported as 0 or 200.
    expect(progress.alongMetres).toBeGreaterThan(90);
    expect(progress.alongMetres).toBeLessThan(110);
  });
});

describe('on the route, or off it', () => {
  it('counts a few metres to the side as still on it', () => {
    // A corridor is wider than the line drawn down the middle of it.
    const beside = { lat: 39.7635 + 0.00005, lng: -86.1640 + EAST / 2 }; // ~5 m north
    const progress = routeProgress(walk(), beside)!;
    expect(progress.offMetres).toBeLessThan(10);
    expect(progress.onRoute).toBe(true);
  });

  it('calls a walk into the next building off the route', () => {
    const away = { lat: 39.7635 + 0.0009, lng: -86.1640 }; // ~100 m north
    const progress = routeProgress(walk(), away)!;
    expect(progress.offMetres).toBeGreaterThan(80);
    expect(progress.onRoute).toBe(false);
  });

  it('trusts the phone when the phone says it is unsure', () => {
    // The failure this is really for. Indoors a fix can be tens of metres out
    // and the browser says so. Re-routing somebody because their own phone is
    // uncertain is worse than showing them a route they are notionally off.
    const away = { lat: 39.7635 + 0.0004, lng: -86.1640 }; // ~45 m north
    expect(routeProgress(walk(), away, 0)!.onRoute).toBe(false);
    expect(routeProgress(walk(), away, 60)!.onRoute).toBe(true);
  });

  it('does not let a confident phone override the corridor floor', () => {
    // A phone claiming one-metre accuracy indoors is wrong. Being three metres
    // off a line drawn down a corridor is being in the corridor.
    const beside = { lat: 39.7635 + 0.00003, lng: -86.1640 + EAST / 2 };
    expect(routeProgress(walk(), beside, 1)!.onRoute).toBe(true);
  });
});

describe('when there is nothing to measure against', () => {
  it('says nothing rather than guessing', () => {
    expect(routeProgress(null, { lat: 39.7635, lng: -86.164 })).toBeNull();
    expect(routeProgress(walk(), null)).toBeNull();
    expect(routeProgress(walk({ legs: [] }), { lat: 39.7635, lng: -86.164 })).toBeNull();
  });

  it('still advances through a floor change, which is drawn as one point', () => {
    // Stairs are two points in the same place carrying 25 m of cost. Skipping
    // their metres would make everything after them read as closer than it is.
    const here = { lat: 39.7635, lng: -86.1640 };
    const stairs = walk({
      legs: [
        { kind: 'walk', points: [here, { lat: 39.7635, lng: -86.1640 + EAST / 2 }], metres: 50, text: 'to the stairs' },
        { kind: 'stairs', points: [{ lat: 39.7635, lng: -86.1640 + EAST / 2 }], metres: 25, text: 'up' },
        { kind: 'walk', points: [{ lat: 39.7635, lng: -86.1640 + EAST / 2 }, { lat: 39.7635, lng: -86.1640 + EAST }], metres: 50, text: 'on' },
      ],
      metres: 125,
    });
    const atTop = routeProgress(stairs, { lat: 39.7635, lng: -86.1640 + EAST * 0.75 })!;
    expect(atTop.alongMetres).toBeGreaterThan(75);
    expect(atTop.remainingMetres).toBeLessThan(50);
  });
});
