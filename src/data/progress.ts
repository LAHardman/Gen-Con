/**
 * Where along a route somebody has got to, and whether they are still on it.
 *
 * WHY THIS EXISTS. The route already recomputed on every position fix, which
 * sounds like following somebody and is not: it means the line can silently
 * rearrange under a person who is walking it correctly. Two fixes a few metres
 * apart can find different shortest paths through a building with more than one
 * staircase, and the map redraws with no explanation. Worse, it does that most
 * where the fixes are worst, which indoors is everywhere.
 *
 * So the route is held, and this says whether holding it is still honest.
 *
 * THE TOLERANCE IS THE DEVICE'S OWN. Indoors a phone will happily report a
 * position thirty metres through a wall, and it says so — `accuracy` is the
 * radius it believes itself to within, and it is already drawn on the map as
 * the halo round the dot. Re-routing somebody because their own phone is unsure
 * is the failure to avoid, so the threshold is that radius, floored at a value
 * that means "further away than a corridor is wide".
 *
 * NOTHING HERE RE-ROUTES. It measures; `useFollowedRoute` decides. Keeping the
 * measuring pure is what makes it testable, and this is not code anybody can
 * check by walking around with a phone in a convention centre in August.
 */

import { distanceMetres, type LatLng } from '../utils/geo';
import type { Walk } from './route';

export interface Progress {
  /** Metres from the position to the nearest point on the route. */
  offMetres: number;
  /** Metres from the start of the route to that nearest point. */
  alongMetres: number;
  /** What is left to walk from there. Never negative. */
  remainingMetres: number;
  /** Whether the position is near enough to the line to still be on it. */
  onRoute: boolean;
}

/**
 * Below this, a position is on the route however good the fix claims to be.
 *
 * A corridor is a few metres wide and a route is drawn down the middle of one,
 * so being four metres off it is being on it. This is also the floor under the
 * device's own accuracy: a phone claiming one-metre accuracy indoors is wrong,
 * and taking it at its word would re-route somebody standing still.
 */
const NEAR_ENOUGH = 20;

/** The nearest point on a segment to `at`, and how far along it that is. */
function ontoSegment(at: LatLng, a: LatLng, b: LatLng) {
  const span = distanceMetres(a, b);
  if (span === 0) return { along: 0, off: distanceMetres(at, a), span };
  // In degrees, projected, then measured back in metres — the segments here are
  // tens of metres, over which the flat-earth error is far below the accuracy of
  // any fix this is comparing against.
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  const t = Math.max(
    0,
    Math.min(1, ((at.lat - a.lat) * dLat + (at.lng - a.lng) * dLng) / (dLat * dLat + dLng * dLng)),
  );
  const on = { lat: a.lat + dLat * t, lng: a.lng + dLng * t };
  return { along: span * t, off: distanceMetres(at, on), span };
}

/**
 * How far along `walk` the position is, and how far off it.
 *
 * The nearest point on the whole route wins, rather than the first point within
 * some radius — a route that doubles back past its own start would otherwise
 * report somebody as barely started when they are nearly finished.
 */
export function routeProgress(walk: Walk | null, at: LatLng | null, accuracy = 0): Progress | null {
  if (!walk || !at || !walk.legs.length) return null;

  let travelled = 0;
  let best: { off: number; along: number } | null = null;

  for (const leg of walk.legs) {
    const points = leg.points;
    if (points.length < 2) {
      // A floor change is drawn as two points in the same place. It still costs
      // its metres, so it still has to advance the count.
      travelled += leg.metres;
      continue;
    }
    // Legs carry their own metres, which for a floor change is a charge rather
    // than a length; scaling by the drawn length keeps `alongMetres` in step
    // with `walk.metres` so the two can be subtracted from each other.
    let drawn = 0;
    for (let i = 1; i < points.length; i += 1) drawn += distanceMetres(points[i - 1], points[i]);
    const scale = drawn > 0 ? leg.metres / drawn : 1;

    let within = 0;
    for (let i = 1; i < points.length; i += 1) {
      const { along, off, span } = ontoSegment(at, points[i - 1], points[i]);
      if (!best || off < best.off) best = { off, along: travelled + (within + along) * scale };
      within += span;
    }
    travelled += leg.metres;
  }

  if (!best) return null;
  const onRoute = best.off <= Math.max(NEAR_ENOUGH, accuracy);
  return {
    offMetres: best.off,
    alongMetres: best.along,
    remainingMetres: Math.max(0, walk.metres - best.along),
    onRoute,
  };
}
