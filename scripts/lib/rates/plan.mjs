/**
 * Who to ask about, in what order, with the quota there is.
 *
 * This file is the feature. Everything around it fetches and draws; this is
 * where the rules live, and each is here because the obvious implementation
 * gets it wrong.
 *
 * 1. NEVER SPEND A REQUEST ON A HOTEL IN GEN CON'S BLOCK. Gen Con publishes
 *    those rates itself, on a page that costs nothing to read and is more
 *    authoritative than anything a rate API would return. Paying an allowance to
 *    learn a number already sitting in `partners.ts` is the single most wasteful
 *    thing this could do — and with the block covering 24 of the 35 walkable
 *    hotels, it is most of the walk ring.
 *
 * 2. WALK BEFORE DRIVE. Somewhere you can walk to at any price is worth more
 *    than somewhere cheap you would have to drive from, and the quota is small
 *    enough that a run starting on the drive ring may never reach the walk ring.
 *    So the walk ring is planned to exhaustion first.
 *
 * 3. EVERY HOTEL OUTSIDE THE BLOCK, NOT JUST THE CHEAP ONES. An earlier version
 *    capped the drive ring at the cheapest walkable rate and discarded anything
 *    dearer. That saved quota and lost information — you cannot tell whether a
 *    hotel is worth the drive without knowing what it costs, and "it was too
 *    expensive" is a fact worth showing rather than one worth forgetting. So
 *    everything outside the block is asked about, and the *page* decides what
 *    is worth a drive.
 *
 * 4. ONCE A MONTH EACH, THEN SPEND WHAT IS LEFT. A price a month old is worth
 *    having; one refreshed weekly costs four times as much to say nearly the
 *    same thing. But an allowance that resets on the first of the month and goes
 *    unspent is gone, so once nothing is due the remaining quota goes on
 *    refreshing the stalest — nearest first, because that is where a stale price
 *    misleads most.
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
export function planRun({ places, quotes, budgets, whenMs, tried = {}, inBlock = new Set() }) {
  const capacity = Object.values(budgets).reduce((sum, left) => sum + left, 0);
  const floor = walkFloor(places, quotes);
  if (capacity <= 0) return { tasks: [], floor, reason: 'no quota left' };

  /*
   * Rule 1, applied before anything else so it cannot be forgotten later.
   *
   * A block hotel's price is published. Every request spent on one is a request
   * not spent on a hotel whose price nobody knows.
   */
  const askable = places.filter((one) => !inBlock.has(one.id));
  const walk = askable.filter((one) => one.ring === 'walk');
  const drive = askable.filter((one) => one.ring === 'drive');

  const tasks = [];
  const due = (list) => list.filter((one) => !isFresh(quotes, one.id, whenMs));

  // Rule 2: the walk ring, nearest first — if the quota runs out halfway down,
  // the half that got asked should be the half nearest the hall.
  for (const place of due(walk).sort((a, b) => a.metres - b.metres)) {
    tasks.push({ place, why: 'walk-due' });
  }

  // Rule 3: then everything else outside the block, most-likely-cheap first so
  // that a run which stops early has still found the useful end of the list.
  for (const place of due(drive).sort((a, b) => cheapFirst(a) - cheapFirst(b))) {
    tasks.push({ place, why: 'drive-due' });
  }

  /*
   * Rule 4: spend the rest.
   *
   * An unspent allowance is gone on the first of next month, so anything left
   * after everything is fresh goes on refreshing the stalest. Walkable places
   * first at equal staleness: a stale price on a hotel across the road misleads
   * somebody more than a stale one twenty kilometres out.
   */
  let spare = capacity - tasks.length;
  if (spare > 0) {
    const stalest = askable
      .filter((one) => isFresh(quotes, one.id, whenMs))
      .map((place) => ({ place, at: newestFor(quotes, place.id) ?? 0 }))
      .sort((a, b) => a.at - b.at || a.place.metres - b.place.metres);
    for (const { place } of stalest) {
      if (spare <= 0) break;
      tasks.push({ place, why: 'refresh' });
      spare -= 1;
    }
  }

  const skipped = places.length - askable.length;
  return {
    tasks,
    floor,
    reason:
      `${askable.length} outside the block, ${skipped} skipped because Gen Con publishes them` +
      (floor === null ? '' : `; cheapest walkable so far ${floor}`),
  };
}

/**
 * Whether a quote is worth keeping.
 *
 * Everything with a real number is, now that the drive ring is no longer capped
 * — see rule 3. This survives as a function rather than being inlined because
 * it is the one place a "do not store this" rule would go, and a quote of zero
 * or NaN from a source that half-answered is still worth refusing.
 */
export function keeps(place, nightly) {
  return Number.isFinite(nightly) && nightly > 0;
}
