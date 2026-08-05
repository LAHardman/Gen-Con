/**
 * Which OpenStreetMap ways count as pavement, and which must not.
 *
 * Split out of `fetch-pavements.mjs` so it can be tested: the script takes a
 * network fetch on import, and this predicate is the load-bearing part of it.
 * Let a bridge through and the skywalk system arrives a second time as
 * ground-level footway, with no idea which storey it lands on — and a route
 * would cross one without ever going upstairs, looking more connected rather
 * than broken.
 */

/** Ways that carry people on foot. */
export const WALKABLE = /^(footway|path|pedestrian|steps|living_street)$/;

/**
 * Is this a pavement somebody could walk on at street level?
 *
 * The exclusions in order: the skywalks (`bridge`), the tunnel to the stadium
 * (`tunnel`), the covered walkways, anything a mapper put on a storey rather
 * than the ground (`level`, `layer`), and anything shut to the public.
 */
export function onTheGround(tags = {}) {
  if (!WALKABLE.test(tags.highway ?? '')) return false;
  if (tags.bridge && tags.bridge !== 'no') return false;
  if (tags.tunnel && tags.tunnel !== 'no') return false;
  if (tags.covered && tags.covered !== 'no') return false;
  if (tags.indoor && tags.indoor !== 'no') return false;
  if (tags.level !== undefined && tags.level !== '0') return false;
  if (tags.layer !== undefined && tags.layer !== '0') return false;
  if (tags.access === 'no' || tags.access === 'private') return false;
  return true;
}
