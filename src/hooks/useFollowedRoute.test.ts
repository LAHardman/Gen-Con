/**
 * Holding a route steady while somebody walks it, and giving up when they
 * clearly have not.
 *
 * This is the behaviour nobody can check by using the app: it needs a position
 * that moves, indoors, on a campus none of us is standing on. Both failure
 * directions are bad and neither is visible in development — a route that
 * redraws under somebody walking it correctly, and a route that never redraws
 * for somebody who has gone the wrong way down a four-hundred-metre building.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFollowedRoute } from './useFollowedRoute';

const EAST = 0.001167; // ~100 m of longitude here
const HERE = { lat: 39.7635, lng: -86.164 };

const walk = {
  legs: [{ kind: 'walk' as const, points: [HERE, { lat: HERE.lat, lng: HERE.lng + EAST }], metres: 100, text: 'along' }],
  metres: 100,
  minutes: 2,
  indoors: true,
  viaStairs: false,
};

/**
 * A stand-in for the router, counting how often it is asked.
 *
 * The count is the assertion in most of these: "did the route change" is the
 * question, and asking the router at all is what changes it.
 */
const routed = vi.fn();
vi.mock('../data/navigation', async (real) => ({
  ...(await real<typeof import('../data/navigation')>()),
  routeBetween: (...args: unknown[]) => {
    routed(...args);
    return { walk, metres: 100, minutes: 2, straightMetres: 100, arrived: false } as never;
  },
}));

const from = { kind: 'device' } as never;
const to = { kind: 'room', room: { id: 'hall-f' } } as never;
const fixAt = (lng: number, accuracy = 5) => ({ position: { lat: HERE.lat, lng }, accuracy });

afterEach(() => routed.mockClear());

describe('walking the route', () => {
  it('computes it once and holds it while somebody follows it', () => {
    // The defect this replaced: recomputing on every fix, so the line
    // rearranges under a person who is doing everything right.
    const { rerender } = renderHook(({ fix }) => useFollowedRoute(from, to, fix), {
      initialProps: { fix: fixAt(HERE.lng) },
    });
    expect(routed).toHaveBeenCalledTimes(1);
    for (const part of [0.2, 0.4, 0.6, 0.8]) rerender({ fix: fixAt(HERE.lng + EAST * part) });
    expect(routed).toHaveBeenCalledTimes(1);
  });

  it('counts down what is left as they go', () => {
    const { result, rerender } = renderHook(({ fix }) => useFollowedRoute(from, to, fix), {
      initialProps: { fix: fixAt(HERE.lng) },
    });
    const start = result.current.progress!.remainingMetres;
    rerender({ fix: fixAt(HERE.lng + EAST * 0.7) });
    expect(result.current.progress!.remainingMetres).toBeLessThan(start - 50);
    expect(result.current.progress!.onRoute).toBe(true);
  });
});

describe('wandering off', () => {
  const off = (accuracy = 5) => ({ position: { lat: HERE.lat + 0.0009, lng: HERE.lng }, accuracy });

  it('does not re-route on a single bad fix', () => {
    // A phone that briefly thinks you are across the street corrects itself on
    // the next reading. A route that redrew in between has done damage the
    // correction cannot undo.
    const { rerender } = renderHook(({ fix }) => useFollowedRoute(from, to, fix), {
      initialProps: { fix: fixAt(HERE.lng) },
    });
    rerender({ fix: off() });
    rerender({ fix: fixAt(HERE.lng + EAST * 0.3) });
    expect(routed).toHaveBeenCalledTimes(1);
  });

  it('re-routes once somebody is off it and stays off it', () => {
    const { rerender } = renderHook(({ fix }) => useFollowedRoute(from, to, fix), {
      initialProps: { fix: fixAt(HERE.lng) },
    });
    rerender({ fix: off() });
    rerender({ fix: off() });
    expect(routed).toHaveBeenCalledTimes(2);
  });

  it('does not re-route when the phone admits it is unsure', () => {
    // The important one. Indoors a fix can be tens of metres out and the
    // browser reports that; re-routing on it is re-routing on noise, and it
    // would happen most in exactly the building this app is for.
    const { rerender } = renderHook(({ fix }) => useFollowedRoute(from, to, fix), {
      initialProps: { fix: fixAt(HERE.lng) },
    });
    rerender({ fix: off(150) });
    rerender({ fix: off(150) });
    expect(routed).toHaveBeenCalledTimes(1);
  });

  it('starts counting again after getting back on', () => {
    // One stray, back on, one stray is not two strays in a row.
    const { rerender } = renderHook(({ fix }) => useFollowedRoute(from, to, fix), {
      initialProps: { fix: fixAt(HERE.lng) },
    });
    rerender({ fix: off() });
    rerender({ fix: fixAt(HERE.lng + EAST * 0.2) });
    rerender({ fix: off() });
    expect(routed).toHaveBeenCalledTimes(1);
  });
});

describe('changing where you are going', () => {
  it('computes a new route when the destination changes', () => {
    const other = { kind: 'room', room: { id: 'hall-k' } } as never;
    const { rerender } = renderHook(({ dest }) => useFollowedRoute(from, dest, fixAt(HERE.lng)), {
      initialProps: { dest: to },
    });
    expect(routed).toHaveBeenCalledTimes(1);
    rerender({ dest: other });
    expect(routed).toHaveBeenCalledTimes(2);
  });

  it('has nothing to say without both ends', () => {
    const { result } = renderHook(() => useFollowedRoute(from, null, fixAt(HERE.lng)));
    expect(result.current.route).toBeNull();
    expect(result.current.progress).toBeNull();
    expect(routed).not.toHaveBeenCalled();
  });
});
