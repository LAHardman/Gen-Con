/**
 * Building the router's graph before somebody waits for it.
 *
 * Two things have to hold, and both fail quietly:
 *
 *   The warm-up must **finish**. It runs on idle callbacks, and a callback that
 *   fires because it timed out reports no time remaining — so a build that only
 *   works when told it has time does nothing, asks to be scheduled again, and
 *   loops for ever while the app looks fine and every route still costs the
 *   full second and a half.
 *
 *   A part-built graph must be **kept**. A route arriving mid-warm-up that
 *   started over would be slower than never warming at all, and would give the
 *   same answer either way, so nothing would say so.
 *
 * `route.test.ts` covers what the finished graph must contain. This covers the
 * building of it, which is why the module is re-imported per test rather than
 * shared: the graph is memoised, so a second test in the same registry would be
 * warming something already warm and could not fail.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The grid search, counted.
 *
 * Whether a build was resumed or started again is not visible in its answer —
 * both give the same route, one of them twice as slowly — so the only honest
 * way to assert it is to count the work. Every edge of the static graph is one
 * `pathBetween`, so that is the meter.
 */
const searches = vi.hoisted(() => ({ count: 0 }));

vi.mock('../data/walkable', async (original) => {
  const real = await original<typeof import('../data/walkable')>();
  return {
    ...real,
    pathBetween: (...args: Parameters<typeof real.pathBetween>) => {
      searches.count += 1;
      return real.pathBetween(...args);
    },
  };
});

type Route = typeof import('../data/route');

/** A fresh copy of the router, with nothing built yet. */
async function freshRouter(): Promise<Route> {
  vi.resetModules();
  return import('../data/route');
}

beforeEach(() => {
  searches.count = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('building the graph a step at a time', () => {
  it('finishes, and says when it has', async () => {
    const { warmCampus } = await freshRouter();
    let calls = 0;
    // One step per call, which is the worst a caller can do, and the case a
    // timed-out idle callback produces.
    while (!warmCampus(justOnce())) {
      calls += 1;
      expect(calls, 'warming never finished').toBeLessThan(10_000);
    }
    expect(calls).toBeGreaterThan(100);
    expect(warmCampus(() => false)).toBe(true);
  }, 60_000);

  it('gives the same route whether it was warmed or not', async () => {
    const warmed = await freshRouter();
    const ends = await bothEnds();
    while (!warmed.warmCampus(() => true));
    const afterWarming = warmed.walkBetween(ends[0], ends[1]);

    const cold = await freshRouter();
    const straightAt = cold.walkBetween(ends[0], ends[1]);

    expect(afterWarming).not.toBeNull();
    expect(afterWarming!.metres).toBeCloseTo(straightAt!.metres, 6);
    expect(afterWarming!.legs.map((leg) => leg.text)).toEqual(
      straightAt!.legs.map((leg) => leg.text),
    );
  }, 60_000);

  it('carries on from where the warming stopped rather than starting again', async () => {
    // The whole point of warming, and invisible in the answer: a route that
    // threw away a half-built graph and rebuilt it returns exactly the same
    // route, having taken twice as long to do it. So this counts the work.
    const cold = await freshRouter();
    const ends = await bothEnds();
    cold.walkBetween(ends[0], ends[1]);
    const whole = searches.count;
    expect(whole).toBeGreaterThan(100);

    const warm = await freshRouter();
    searches.count = 0;
    let steps = 0;
    while (steps < 400 && !warm.warmCampus(justOnce())) steps += 1;
    const beforeTheRoute = searches.count;
    expect(beforeTheRoute).toBeGreaterThan(0);
    warm.walkBetween(ends[0], ends[1]);

    // Every pair searched once between them, not once each.
    expect(searches.count).toBeLessThan(whole + beforeTheRoute * 0.5);
    expect(searches.count).toBeCloseTo(whole, -1);
  }, 60_000);

  it('grids the floors a step apart rather than in one lump', async () => {
    // Gridding is 565 ms of the 1,300, and the convention centre's Level 1
    // alone is 150 ms of that. Done in one step it is a third of a second the
    // browser cannot interrupt — which is the whole thing this was meant to
    // stop, and the build would still be correct and still finish, so nothing
    // else here would notice.
    const { warmCampus } = await freshRouter();
    const { VENUES, VENUE_LEVELS } = await import('../data/venues');
    const floors = VENUES.reduce((n, venue) => n + (VENUE_LEVELS[venue.id] ?? []).length, 0);

    // Every grid happens before the first search over one, so counting steps
    // up to that point counts the gridding.
    let steps = 0;
    while (searches.count === 0 && !warmCampus(justOnce())) steps += 1;
    expect(searches.count).toBeGreaterThan(0);
    expect(steps).toBeGreaterThanOrEqual(floors);
  }, 60_000);

  it('costs nothing once it is warm', async () => {
    const { warmCampus } = await freshRouter();
    while (!warmCampus(() => true));
    // Asked for no time at all, and still done — the memo is what every route
    // after the first is relying on.
    expect(warmCampus(() => false)).toBe(true);
  }, 60_000);
});

describe('the hook that drives it', () => {
  /** Renders the hook without pulling in a renderer for one effect. */
  async function run(hook: () => void) {
    const { renderHook } = await import('@testing-library/react');
    return renderHook(hook);
  }

  it('warms on an idle callback where the browser has one', async () => {
    const { warmCampus } = await freshRouter();
    while (!warmCampus(() => true));
    const idle = vi.fn((cb: (deadline: IdleDeadline) => void, options?: IdleRequestOptions) => {
      void options;
      cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 1;
    });
    vi.stubGlobal('requestIdleCallback', idle);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const { useWarmCampus } = await import('./useWarmCampus');
    await run(() => useWarmCampus());
    expect(idle).toHaveBeenCalled();
    // Asked for idle time rather than for a timer: on a busy page the timer
    // version competes with the thing keeping the page busy.
    expect(idle.mock.calls[0][1]).toEqual({ timeout: 2_000 });
  }, 60_000);

  it('still gets somewhere when the callback fires because it timed out', async () => {
    // The loop that looks like nothing at all. A page busy enough that the two
    // second timeout expires gets a deadline reporting no time remaining — and
    // a warm-up that only steps when told it has time does nothing, asks to be
    // scheduled again, and repeats for ever, while every route still costs the
    // full second and a half and the app looks perfectly healthy.
    const cold = await freshRouter();
    let whole = 0;
    while (!cold.warmCampus(justOnce())) whole += 1;

    const router = await freshRouter();
    const ROUNDS = 10;
    let scheduled = 0;
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((cb: (deadline: IdleDeadline) => void) => {
        if (scheduled < ROUNDS) {
          scheduled += 1;
          cb({ didTimeout: true, timeRemaining: () => 0 } as IdleDeadline);
        }
        return scheduled;
      }),
    );
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const { useWarmCampus } = await import('./useWarmCampus');
    await run(() => useWarmCampus());
    expect(scheduled).toBe(ROUNDS);

    // Counted rather than merely "something happened": one step per round is
    // exactly what the guarantee promises, and no steps is the bug.
    let left = 0;
    while (!router.warmCampus(justOnce())) left += 1;
    expect(left).toBe(whole - ROUNDS);
  }, 60_000);

  it('falls back to a timer where the browser has no idle callback', async () => {
    await freshRouter();
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.stubGlobal('cancelIdleCallback', undefined);
    const timer = vi.spyOn(window, 'setTimeout');
    const { useWarmCampus } = await import('./useWarmCampus');
    const view = await run(() => useWarmCampus());
    expect(timer).toHaveBeenCalled();
    view.unmount();
    timer.mockRestore();
  }, 60_000);

  it('does nothing at all when it is switched off', async () => {
    await freshRouter();
    const idle = vi.fn(() => 1);
    vi.stubGlobal('requestIdleCallback', idle);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const { useWarmCampus } = await import('./useWarmCampus');
    await run(() => useWarmCampus(false));
    expect(idle).not.toHaveBeenCalled();
  }, 60_000);

  it('stops when the page goes away mid-build', async () => {
    await freshRouter();
    const cancel = vi.fn();
    vi.stubGlobal('requestIdleCallback', vi.fn(() => 7));
    vi.stubGlobal('cancelIdleCallback', cancel);
    const { useWarmCampus } = await import('./useWarmCampus');
    const view = await run(() => useWarmCampus());
    view.unmount();
    expect(cancel).toHaveBeenCalledWith(7);
  }, 60_000);
});

/** A budget of exactly one step, however many times it is asked. */
function justOnce() {
  let first = true;
  return () => (first ? ((first = false), true) : false);
}

/** Two ends far enough apart that the route uses a good deal of the graph. */
async function bothEnds() {
  const { placeAnchor, roomPlace } = await import('../data/navigation');
  const { ROOMS_BY_ID } = await import('../data/venues');
  return ['hall-b', 'marriott-ballroom'].map(
    (id) => placeAnchor(roomPlace(ROOMS_BY_ID[id]), null)!,
  );
}
