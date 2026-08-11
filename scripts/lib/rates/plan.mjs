/**
 * Who to ask about, in what order, with the quota there is.
 *
 * This file is the feature. Everything around it fetches and draws; this is
 * where the four rules live, and each of them is here because the obvious
 * implementation gets it wrong.
 *
 * 1. WALK BEFORE DRIVE, ALWAYS. Somewhere you can walk to at any price is worth
 *    more than somewhere cheap you would have to drive from, and the quota is
 *    small enough that a run which starts on the drive ring may never reach the
 *    walk ring at all. So the walk ring is planned to exhaustion first, and the
 *    drive ring only ever gets what is left over.
 *
 * 2. ONCE A MONTH EACH, UNLESS THERE IS SPARE. A price a month old is worth
 *    having and worth refreshing; a price refreshed weekly costs four times as
 *    much to say nearly the same thing. So a place is due when its newest quote
 *    is older than the current month — and only when the walk ring is entirely
 *    due-free does spare quota go on refreshing the freshest-but-oldest of them
 *    again, oldest first.
 *
 * 3. THE DRIVE RING IS CAPPED BY THE WALK RING'S CHEAPEST. "Only grab places up
 *    to the cheapest walkable price" cannot be a filter before the call, because
 *    the price is what the call is for. It is therefore two things: a **keep**
 *    rule applied to the answer, and a **probe order** chosen to find keepers
 *    early. Anything that comes back dearer than the floor is discarded and its
 *    id is remembered, so next month's quota is not spent learning it again.
 *
 * 4. NO FLOOR MEANS NO DRIVE RING. If nothing in the walk ring has a price yet,
 *    there is no cap, and querying the drive ring "for now" would spend the
 *    entire allowance on places that may all be above a floor discovered next
 *    week. A missing floor is a reason to stop, not a reason to use infinity.
 */

/** A month, as the ledger spells it. */
const monthOf = (whenMs) => new Date(whenMs).toISOString().slice(0, 7);

/**
 * Whether a place has been asked about within the current month.
 *
 * By calendar month rather than by thirty days, because that is the window the
 * quotas themselves reset on. Thirty days would drift a place's refresh into
 * the following month and spend two allowances on one place.
 */
export function isFresh(quotes, placeId, whenMs) {
  const newest = newestFor(quotes, placeId);
  return newest !== null && monthOf(newest) === monthOf(whenMs);
}

/** When a place was last quoted by anybody, or null. */
export function newestFor(quotes, placeId) {
  let newest = null;
  for (const quote of quotes) {
    if (quote.placeId !== placeId) continue;
    const at = Date.parse(quote.at);
    if (Number.isFinite(at) && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

/**
 * The cheapest nightly price anybody currently has for the walk ring.
 *
 * The cap for rule 3, and null when nothing is known — which the caller must
 * treat as "do not query the drive ring", not as "no limit". Stale quotes count:
 * last month's cheapest walkable rate is a far better cap than none.
 */
export function walkFloor(places, quotes) {
  const walkable = new Set(places.filter((one) => one.ring === 'walk').map((one) => one.id));
  let floor = null;
  for (const quote of quotes) {
    if (!walkable.has(quote.placeId)) continue;
    if (!Number.isFinite(quote.nightly) || quote.nightly <= 0) continue;
    if (floor === null || quote.nightly < floor) floor = quote.nightly;
  }
  return floor;
}

/**
 * How likely a drive-ring place is to come in under the floor, best first.
 *
 * Rule 3's probe order, and openly a heuristic — none of this is a price, it is
 * what can be known for free about a hotel before paying to ask. Two signals,
 * both weak and both real: budget chains are cheaper than luxury ones, and a
 * bed twenty kilometres out is cheaper than the same bed at four hundred
 * metres. Ranking by them beats ranking by nothing, which is what distance
 * alone would be.
 *
 * Lower is better, so it sorts like a cost.
 */
export function cheapFirst(place) {
  const name = `${place.brand ?? ''} ${place.name}`.toLowerCase();
  // Chains whose whole proposition is the price. Deliberately a short list of
  // certainties rather than a long list of guesses.
  const budget = /motel 6|super 8|red roof|days inn|econo|travelodge|knights inn|extended stay|studio ?6|americas best|quality inn|rodeway|howard johnson|la quinta|baymont|microtel|sleep inn|comfort inn|country inn|fairfield|hampton|tru by|home2|candlewide|candlewood|holiday inn express/;
  const luxury = /conrad|ritz|four seasons|w hotel|jw |st\.? regis|waldorf|autograph|luxury|resort|le m[eé]ridien|westin|omni|sheraton|marriott|hyatt regency|hilton garden|embassy/;

  let score = 0;
  if (budget.test(name)) score -= 30;
  if (luxury.test(name)) score += 30;
  // Four or five stars is a price signal wherever OSM has bothered to record it.
  const stars = Number(place.stars);
  if (Number.isFinite(stars)) score += (stars - 2) * 12;
  // Further out is cheaper, up to a point. Capped so that the far edge of the
  // ring does not outrank a genuinely budget chain three miles from the hall.
  score -= Math.min(place.metres / 1_000, 20);
  return score;
}

/**
 * The work for one run.
 *
 * Returns tasks in the order they should be attempted. The caller stops when a
 * source runs out or breaks; nothing here assumes every task will be reached,
 * which is why the ordering carries all the priority rather than the loop.
 *
 * `budgets` is units remaining per source; `quotes` is every quote already held.
 */
export function planRun({ places, quotes, budgets, whenMs, tried = {} }) {
  const capacity = Object.values(budgets).reduce((sum, left) => sum + left, 0);
  const tasks = [];
  if (capacity <= 0) return { tasks, floor: walkFloor(places, quotes), reason: 'no quota left' };

  const walk = places.filter((one) => one.ring === 'walk');

  // Rule 1 and 2: every walkable place with nothing from this month, nearest
  // first — because if the quota runs out halfway down, the half that got
  // asked should be the half nearest the hall.
  const dueWalk = walk
    .filter((one) => !isFresh(quotes, one.id, whenMs))
    .sort((a, b) => a.metres - b.metres);
  for (const place of dueWalk) tasks.push({ place, why: 'walk-due' });

  // Rule 4: no floor, no drive ring. Computed against the quotes actually held,
  // not against what this run might be about to learn.
  const floor = walkFloor(places, quotes);

  let spare = capacity - tasks.length;
  if (spare > 0 && floor !== null) {
    // Rule 3: the drive ring, most-likely-cheap first, skipping anything
    // already known to be above the floor and anything already fresh.
    const dueDrive = places
      .filter((one) => one.ring === 'drive')
      .filter((one) => !tried[one.id])
      .filter((one) => !isFresh(quotes, one.id, whenMs))
      .sort((a, b) => cheapFirst(a) - cheapFirst(b));
    for (const place of dueDrive) {
      if (spare <= 0) break;
      tasks.push({ place, why: 'drive-candidate' });
      spare -= 1;
    }
  }

  // Rule 2's exception: quota still spare and nothing due. Refresh the walk ring
  // again, oldest first, because a second look at the nearest hotel is worth
  // more than a first look at one you would need a car for.
  if (spare > 0 && dueWalk.length === 0) {
    const stalest = walk
      .map((place) => ({ place, at: newestFor(quotes, place.id) ?? 0 }))
      .sort((a, b) => a.at - b.at || a.place.metres - b.place.metres);
    for (const { place } of stalest) {
      if (spare <= 0) break;
      tasks.push({ place, why: 'walk-extra' });
      spare -= 1;
    }
  }

  return {
    tasks,
    floor,
    reason:
      floor === null
        ? 'no walkable price yet, so the drive ring is not worth asking about'
        : `drive ring capped at ${floor}`,
  };
}

/**
 * Whether a quote earns its place, given the floor.
 *
 * The other half of rule 3. A walkable price is always kept — it is the thing
 * being compared against, so it cannot be filtered by itself.
 */
export function keeps(place, nightly, floor) {
  if (place.ring === 'walk') return true;
  if (floor === null) return false;
  return Number.isFinite(nightly) && nightly <= floor;
}
