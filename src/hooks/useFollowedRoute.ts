/**
 * A route that follows you without redrawing itself under your feet.
 *
 * WHAT THIS REPLACED. The route was recomputed on every position fix. That
 * reads like following somebody and behaves like the opposite: two fixes a few
 * metres apart can find different shortest paths through a building with more
 * than one staircase, so the line rearranges while somebody walks it correctly,
 * with nothing to explain why. And it happens most where fixes are worst, which
 * indoors is everywhere.
 *
 * WHAT IT DOES INSTEAD. The route is computed once and then held. Every fix is
 * measured against it — how far along, how far off — so the distance and the
 * time count down without the path changing at all. It is only recomputed when
 * somebody is genuinely somewhere else.
 *
 * "GENUINELY" IS TWO THINGS, and both are needed:
 *
 *   - Further off than the phone's own uncertainty. A fix indoors can be
 *     tens of metres out and the browser says so; re-routing on that is
 *     re-routing on noise. `routeProgress` handles this.
 *   - Off for more than one fix. A single wild reading is common — a phone
 *     that briefly thinks you are across the street will correct itself on the
 *     next one, and a route that had already redrawn by then has done damage a
 *     correction cannot undo.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not announce anything, and it does
 * not re-route on arrival at a waypoint, because there are no waypoints — this
 * is a map that follows you, not turn-by-turn navigation, and pretending
 * otherwise on a fix good to thirty metres would be a lie about what is known.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { routeBetween, type DeviceFix, type NavPlace, type RouteSummary } from '../data/navigation';
import { routeProgress, type Progress } from '../data/progress';

export interface FollowedRoute {
  route: RouteSummary | null;
  /** Where along it the device is, when there is a device and a walk. */
  progress: Progress | null;
  /** How many fixes in a row have been off the route. Zero while on it. */
  strayed: number;
}

/**
 * Fixes off the route before it is worth recomputing.
 *
 * Two rather than one because a single bad reading is normal and self-
 * correcting; two rather than five because somebody who has actually turned
 * the wrong way wants to be told before they have walked the length of a hall.
 */
const STRAY_FIXES = 2;

export function useFollowedRoute(
  from: NavPlace | null | undefined,
  to: NavPlace | null | undefined,
  fix: DeviceFix | null,
): FollowedRoute {
  const [strayed, setStrayed] = useState(0);
  // Bumped to force a recompute when somebody has genuinely wandered off. It is
  // the only thing besides the two ends that can change the route.
  const [reroutes, setReroutes] = useState(0);

  // The latest fix, readable without depending on it. A route is computed
  // *from* where somebody is, but must not be recomputed *because* that moved —
  // which is the entire point of this hook, and is why this is a ref.
  const latest = useRef(fix);
  latest.current = fix;

  const route = useMemo(
    () => (from && to ? routeBetween(from, to, latest.current) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [from, to, reroutes],
  );

  const progress = useMemo(
    () => routeProgress(route?.walk ?? null, fix?.position ?? null, fix?.accuracy ?? 0),
    [route, fix],
  );

  useEffect(() => {
    if (!progress) {
      if (strayed !== 0) setStrayed(0);
      return;
    }
    if (progress.onRoute) {
      if (strayed !== 0) setStrayed(0);
      return;
    }
    const next = strayed + 1;
    setStrayed(next);
    if (next >= STRAY_FIXES) {
      setStrayed(0);
      setReroutes((n) => n + 1);
    }
    // Keyed on the fix rather than on `progress`, so one fix counts once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix]);

  // Ends changed: forget how lost somebody was on the last route.
  useEffect(() => setStrayed(0), [from, to]);

  return { route, progress, strayed };
}
