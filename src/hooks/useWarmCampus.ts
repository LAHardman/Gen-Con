import { useEffect } from 'react';
import { warmCampus } from '../data/route';

/**
 * Build the campus graph while nobody is waiting for it.
 *
 * The router's static graph — every door, staircase and skywalk landing, and
 * the walk between each pair of them on a floor — is built once and then every
 * route costs 5 ms. Building it costs **1,642 ms**, and until this hook existed
 * that second and a half was spent inside the first tap on "Directions", on the
 * main thread, with nothing on screen to say why the app had stopped.
 *
 * Nothing about it needs to happen then. It depends only on the plans, which
 * ship with the page, so it can be done at any point after the map is up — and
 * the browser will say when it is not busy. `warmCampus` takes a step at a
 * time and asks before each one, so what this hook does is hand over whatever
 * idle time is going and give the rest back.
 *
 * A route arriving mid-way is not a wasted warm-up: the part-built graph is
 * kept, and the route carries on from wherever the warming stopped.
 */

/** How long to keep going when the browser will not say. Milliseconds. */
const SLICE = 8;

/**
 * How long to wait for genuine idle before insisting.
 *
 * A page that never goes idle would otherwise never warm, and be back to
 * paying the whole cost on the tap. Two seconds is long after the map is up.
 */
const AT_THE_LATEST = 2_000;

export function useWarmCampus(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let handle: number | null = null;

    const step = (deadline?: IdleDeadline) => {
      handle = null;
      if (stopped) return;
      const until = Date.now() + SLICE;
      // At least one step per call, whatever the deadline says. Without this a
      // callback that fired because it *timed out* reports no time remaining,
      // does nothing, and asks to be scheduled again — for ever.
      let first = true;
      const more = () => {
        if (first) {
          first = false;
          return true;
        }
        return deadline ? deadline.timeRemaining() > 1 : Date.now() < until;
      };
      // A step is not interruptible, and the longest is the 150 ms it takes to
      // grid the convention centre's Level 1. So this overruns the deadline by
      // that much at worst, sixteen times out of nine hundred.
      if (warmCampus(more)) return;
      schedule();
    };

    const schedule = () => {
      handle = window.requestIdleCallback
        ? window.requestIdleCallback(step, { timeout: AT_THE_LATEST })
        : window.setTimeout(step, SLICE);
    };

    schedule();

    return () => {
      stopped = true;
      if (handle === null) return;
      if (window.cancelIdleCallback) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [enabled]);
}
