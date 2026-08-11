/**
 * One run: spend what there is, keep what is worth keeping, break nothing.
 *
 * WHAT "STILL WORKS WHEN A SERVICE GOES OFFLINE" ACTUALLY REQUIRES. Not a
 * try/catch — three things, and the third is the one that gets forgotten:
 *
 *   1. A source that throws is **out for the rest of the run**. One timeout
 *      predicts the next two hundred, and a run that patiently waits out two
 *      hundred timeouts is a run that never finishes and never writes.
 *   2. Its quota is **not** spent on the attempt that broke it. A dead service
 *      must not be able to eat an allowance it never served.
 *   3. Every other source carries on, and the run **still writes its output**.
 *      A run that fails because one of four sources failed has converted a
 *      partial outage into a total one, which is exactly backwards.
 *
 * NOTHING HERE DELETES. A new quote is added beside the old one and the store
 * keeps the newest per place per source. So a month where every service is down
 * leaves the page exactly as it was, showing prices with their real dates on
 * them, rather than emptying it.
 */

import { keeps, planRun, walkFloor } from './plan.mjs';
import { budget, noteTried, spend } from './quota.mjs';
import { ALL } from './sources.mjs';

/**
 * Which sources can be used at all, in the order to try them.
 *
 * Area sources first: one of their units prices a whole ring, and spending a
 * per-place allowance on a hotel an area search would have covered anyway is
 * the single most wasteful thing this run could do.
 */
export function usable(sources, env, budgets) {
  return sources
    .filter((source) => source.ready(env))
    .filter((source) => (budgets[source.name] ?? 0) > 0)
    .sort((a, b) => (a.covers === b.covers ? 0 : a.covers === 'area' ? -1 : 1));
}

/**
 * Do the work.
 *
 * `now` is passed rather than read so a run is reproducible and testable; `fetch`
 * is passed for the same reason. Returns everything the caller needs to write
 * and everything a human needs to read.
 */
export async function runOnce({
  places,
  quotes,
  ledger,
  keys = {},
  env = {},
  whenMs,
  sources = ALL,
  /** Places Gen Con publishes a rate for. Never worth a request. */
  inBlock = new Set(),
  fetch: get,
  log = () => {},
}) {
  const budgets = budget(ledger, env);
  const plan = planRun({ places, quotes, budgets, whenMs, tried: ledger.tried, inBlock });
  const fresh = [];
  /** Sources that broke this run, and why. Reported rather than swallowed. */
  const down = {};
  const cache = {};

  log(`${plan.tasks.length} places worth asking about — ${plan.reason}`);

  const alive = () => usable(sources, env, budget(ledger, env)).filter((one) => !down[one.name]);

  /*
   * Area sources first, once each, for the whole list. One SerpApi search
   * returns a page of hotels; asking it hotel by hotel would price a hundred
   * places a year out of a hundred monthly searches.
   */
  for (const source of alive()) {
    if (source.covers !== 'area' || !source.quoteArea) continue;
    // Spent before the call, not after: a run that dies mid-request has then
    // over-counted by one, which costs a request. Counting after would
    // under-count on the same failure, which costs the quota.
    if (!spend(ledger, source.name, source.cost, env)) continue;
    try {
      /*
       * Area sources are asked only about hotels outside the block.
       *
       * One search returns a page of hotels whatever it is asked, but handing
       * it the block ones would let their bought prices back in through the
       * side door — and a bought price is worse than the published one it would
       * sit beside.
       */
      const asked = places.filter((one) => !inBlock.has(one.id));
      const rows = await source.quoteArea(asked, { env, whenMs, fetch: get, keys, cache });
      const outside = rows.filter((row) => !inBlock.has(row.placeId));
      for (const row of outside) fresh.push({ ...row, source: source.name, at: iso(whenMs) });
      log(
        `  ${source.name}: ${outside.length} prices from one search` +
          (rows.length > outside.length ? ` (${rows.length - outside.length} block hotels dropped)` : ''),
      );
    } catch (error) {
      down[source.name] = String(error.message ?? error);
      // Rule 2: give the unit back. It bought nothing.
      ledger.spent[source.name] -= source.cost;
      log(`  ${source.name} is down — ${down[source.name]}`);
    }
  }

  /*
   * Then per-place sources, for whatever an area search did not cover. Ordered
   * by the plan, so if the allowance runs out it runs out on the far side of
   * the drive ring rather than on the hotel across the road.
   */
  const priced = new Set(fresh.map((one) => one.placeId));
  for (const { place, why } of plan.tasks) {
    if (priced.has(place.id)) continue;
    for (const source of alive()) {
      if (source.covers !== 'place' || !source.quote) continue;
      if (!spend(ledger, source.name, source.cost, env)) continue;
      try {
        const quote = await source.quote(place, { env, whenMs, fetch: get, keys, cache });
        if (!quote) {
          // A real answer about this hotel — no rate — so stop asking about it
          // and let the next source have a turn at the next one.
          continue;
        }
        fresh.push({ ...quote, placeId: place.id, source: source.name, at: iso(whenMs), why });
        priced.add(place.id);
        break;
      } catch (error) {
        down[source.name] = String(error.message ?? error);
        ledger.spent[source.name] -= source.cost;
        log(`  ${source.name} is down — ${down[source.name]}`);
      }
      if (source.pacingMs) await pause(source.pacingMs);
    }
  }

  /*
   * The keep rule. A walkable price is always kept — it is the thing the cap is
   * measured from. A drive-ring price above the cap is dropped *and remembered*,
   * so next month's allowance is not spent learning the same thing again.
   */
  const byId = new Map(places.map((place) => [place.id, place]));
  const kept = [];
  let rejected = 0;
  for (const quote of fresh) {
    const place = byId.get(quote.placeId);
    // A block hotel that slipped through is dropped here too, belt and braces:
    // its published rate is better than anything bought.
    if (!place || inBlock.has(place.id)) continue;
    if (keeps(place, quote.nightly)) {
      kept.push(quote);
    } else {
      rejected += 1;
      noteTried(ledger, place.id, whenMs);
    }
  }

  log(
    `kept ${kept.length}, dropped ${rejected} with no usable number` +
      `${Object.keys(down).length ? `, ${Object.keys(down).join(' and ')} down` : ''}`,
  );

  return {
    quotes: merge(quotes, kept),
    ledger,
    down,
    kept: kept.length,
    rejected,
    // Recomputed *after* the run, so the page shows the floor its own numbers
    // support rather than the one this run started with.
    floor: walkFloor(places, merge(quotes, kept)),
  };
}

const iso = (whenMs) => new Date(whenMs).toISOString();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Newest quote per place per source, oldest dropped.
 *
 * Per *source* rather than per place: two services disagreeing about one hotel
 * is information — it is the honest width of "about $180" — and collapsing them
 * to whichever ran last would throw that away and make the number look more
 * certain than it is.
 */
export function merge(existing, incoming) {
  const best = new Map();
  for (const quote of [...existing, ...incoming]) {
    const key = `${quote.placeId} ${quote.source}`;
    const held = best.get(key);
    if (!held || Date.parse(quote.at) >= Date.parse(held.at)) best.set(key, quote);
  }
  return [...best.values()].sort(
    (a, b) => a.placeId.localeCompare(b.placeId) || a.source.localeCompare(b.source),
  );
}
