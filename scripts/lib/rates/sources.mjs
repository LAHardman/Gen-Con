/**
 * Four ways to ask what a room costs, behind one contract.
 *
 * THE CONTRACT, because the point of it is that the run loop never knows which
 * source it is talking to:
 *
 *   name      what the quota ledger calls it
 *   ready(env)  whether it is configured and switched on
 *   cost      units one task takes out of this source's monthly allowance
 *   quote(place, ctx) → { nightly, currency, via } | null    (null = no price)
 *   canAsk(place, ctx) → boolean   optional; false = nothing to ask *with*
 *
 * `canAsk` is not `ready` and it is not `null`. `ready` is about the source,
 * `canAsk` is about one hotel, and the difference is a whole allowance: the
 * ledger is charged before the request goes out, so a source that returns null
 * on its first line because it has no identifier for this hotel is charged for
 * a request that never left the machine. Xotelo did exactly that for every
 * hotel — 169 units a run, no traffic, no prices, and a budget that reported
 * itself spent.
 *
 * A source that cannot answer returns null. A source that is *broken* throws,
 * and the difference matters: null is one hotel with no rate, and the run moves
 * on; a throw takes that source out for the rest of the run, because one
 * timeout is a hint that the next two hundred will also be timeouts.
 *
 * WHY FOUR. Not for coverage — for survival. These are free tiers of commercial
 * products and an unofficial community endpoint, and any of them can be gone on
 * a Tuesday with no announcement. Four independent ways to learn one number
 * means the page keeps working when one, two or three of them stop. That is the
 * entire argument for the complexity here; a single source would be less code
 * and would eventually show an empty page.
 *
 * THESE REQUEST SHAPES ARE WRITTEN FROM DOCUMENTATION AND HAVE NOT BEEN RUN
 * AGAINST THE LIVE SERVICES — every one of these hosts is unreachable from the
 * network this was built on. Each parser therefore treats an unfamiliar
 * response as an error rather than as "no price", so a shape that has moved
 * announces itself instead of quietly producing a page of blanks. Confidence in
 * each is noted on the adapter. Run `--dry` first and read what comes back.
 */

/** `2026-08-01` — the check-in the ring is priced for. */
export const nightOf = (whenMs, offsetDays = 0) =>
  new Date(whenMs + offsetDays * 86_400_000).toISOString().slice(0, 10);

/** A response that is not JSON, or not the JSON expected, is a broken source. */
async function readJson(response, who) {
  if (!response.ok) throw new Error(`${who}: HTTP ${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${who}: not JSON (${text.slice(0, 80)})`);
  }
}

/** The first finite positive number in a set of candidates, else null. */
const money = (...candidates) => {
  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? Number(candidate.replace(/[^0-9.]/g, '')) : candidate;
    if (Number.isFinite(value) && value > 0) return Math.round(value * 100) / 100;
  }
  return null;
};

/* ------------------------------------------------------------------ SerpApi */

/**
 * Google Hotels, by way of SerpApi.
 *
 * Confidence: **good**. The engine, the parameters and the `properties[]` /
 * `rate_per_night.extracted_lowest` shape are all documented and stable.
 *
 * One search returns a page of hotels for an area, so this is the only adapter
 * that can price many places for one unit — which is why the run loop asks it
 * for whole rings rather than one hotel at a time. Spending a hundred monthly
 * searches one hotel at a time would price a hundred hotels a year.
 */
export const serpapi = {
  name: 'serpapi',
  covers: 'area',
  ready: (env) => Boolean(env.SERPAPI_KEY),
  cost: 1,

  /**
   * The searches worth making, given the hotels that need pricing.
   *
   * One search per town rather than one search full stop. The first version
   * asked "hotels near Indiana Convention Center" and nothing else, which was
   * fine while the interesting hotels were downtown — and useless the moment
   * Gen Con's own page took over downtown pricing, because what is left to buy
   * is a hundred and seventy hotels in Plainfield, Carmel and Greenwood that a
   * downtown search will never return.
   *
   * A hundred searches a month against a dozen towns is not a constraint worth
   * optimising: this spends one unit per town per run and reaches everything.
   */
  areas(places) {
    const byTown = new Map();
    for (const place of places) {
      const town = place.city || 'Indianapolis';
      if (!byTown.has(town)) byTown.set(town, []);
      byTown.get(town).push(place);
    }
    return (
      [...byTown.entries()]
        // Biggest groups first: if the allowance runs out, it runs out having
        // priced the most hotels it could.
        .sort((a, b) => b[1].length - a[1].length)
        .map(([town, group]) => ({
          query:
            town === 'Indianapolis'
              ? 'hotels near Indiana Convention Center Indianapolis'
              : `hotels in ${town}, Indiana`,
          label: town,
          places: group,
        }))
    );
  },

  /**
   * One search, one town, many prices back.
   *
   * `report` is for the `--verify` path: it is handed every property the
   * service returned, matched or not, because the interesting failure here is
   * not an error — it is twenty hotels coming back and two of them matching,
   * which is a name-matching problem and looks identical to a thin response
   * unless somebody prints both.
   */
  async quoteArea(places, { env, whenMs, query, fetch: get = fetch, report, charge }) {
    const ask = (token) => {
      const url = new URL('https://serpapi.com/search.json');
      url.searchParams.set('engine', 'google_hotels');
      url.searchParams.set('q', query ?? 'hotels near Indiana Convention Center Indianapolis');
      url.searchParams.set('check_in_date', nightOf(whenMs, 30));
      url.searchParams.set('check_out_date', nightOf(whenMs, 31));
      url.searchParams.set('adults', '1');
      url.searchParams.set('currency', 'USD');
      url.searchParams.set('api_key', env.SERPAPI_KEY);
      if (token) url.searchParams.set('next_page_token', token);
      return url;
    };

    /*
     * Paged, because one search is one page and one page is about twenty
     * hotels.
     *
     * Indianapolis alone has 184 of ours. "One search per town reaches
     * everything" was true of the towns with nine hotels in them and quietly
     * false of the one with most of them — a single search would have priced
     * the first twenty and left a hundred and sixty looking simply unpriced,
     * which is indistinguishable from the service not working.
     *
     * Every page is another unit, so every page after the first asks `charge`
     * first and stops when the month says no. The cap is a backstop against a
     * token that never stops arriving, not a budget: the budget is the ledger.
     */
    const rows = [];
    let token = null;
    for (let page = 0; page < 12; page += 1) {
      // The first page was paid for by the run loop before it called this.
      if (page > 0 && charge && !charge()) break;
      const body = await readJson(await get(ask(token)), 'serpapi');
      if (body.error) throw new Error(`serpapi: ${body.error}`);
      if (!Array.isArray(body.properties)) {
        throw new Error('serpapi: no properties[] in the response');
      }
      rows.push(...body.properties);
      token = body.serpapi_pagination?.next_page_token ?? null;
      if (!token) break;
    }

    const found = [];
    for (const row of rows) {
      const nightly = money(row.rate_per_night?.extracted_lowest, row.rate_per_night?.lowest);
      if (!row.name) continue;
      /*
       * Coordinates first, name second.
       *
       * Google gives every property a position, and a position identifies a
       * building where a name only describes one. Four hotels in this city are
       * called some arrangement of "La Quinta Inn & Suites" and the matcher
       * rightly refuses all of them; their coordinates are sixteen kilometres
       * apart and refuse nothing.
       */
      const point = row.gps_coordinates
        ? { lat: Number(row.gps_coordinates.latitude), lng: Number(row.gps_coordinates.longitude) }
        : null;
      const byPoint = nightly ? matchByPoint(places, point) : null;
      const place = byPoint ?? (nightly ? matchByName(places, row.name) : null);
      if (place) found.push({ placeId: place.id, nightly, currency: 'USD', via: row.name });
      report?.({
        name: row.name,
        nightly,
        matched: place?.name ?? null,
        // Which mechanism found it, so a run says whether coordinates arrived.
        how: place ? (byPoint ? 'position' : 'name') : null,
      });
    }
    return found;
  },
};

/* ------------------------------------------------------------------- Xotelo */

/**
 * TripAdvisor's rates, by way of Xotelo.
 *
 * Confidence: **fair** on the shape (`result.rates[]` with `rate`), **poor** on
 * the identifier. Every call needs a TripAdvisor hotel key that has to be found
 * first and does not appear in OpenStreetMap, so a place with no key resolved is
 * simply skipped rather than guessed at. Keys never change, so one resolved key
 * is resolved forever — they live in the store beside the quotes.
 *
 * No key, no account and no published monthly cap. The budget it is given is
 * self-imposed politeness towards a free service, not an allowance being spent.
 */
export const xotelo = {
  name: 'xotelo',
  covers: 'place',
  // Free and keyless: the only thing that stops it is being switched off.
  ready: () => true,
  cost: 1,

  /*
   * A hotel with no resolved key is one this source has no way to name, which
   * is not the same as one it has no price for — and charging the allowance for
   * it spends the month on requests that are never made. `resolve-hotel-keys`
   * is what fills these in.
   */
  canAsk: (place, { keys } = {}) => Boolean(keys?.[place.id]),

  async quote(place, { keys, whenMs, fetch: get = fetch }) {
    const hotelKey = keys?.[place.id];
    // Not an error: most places will not have a key until somebody resolves one.
    if (!hotelKey) return null;

    const url = new URL('https://data.xotelo.com/api/rates');
    url.searchParams.set('hotel_key', hotelKey);
    url.searchParams.set('chk_in', nightOf(whenMs, 30));
    url.searchParams.set('chk_out', nightOf(whenMs, 31));
    url.searchParams.set('adults', '1');

    const body = await readJson(await get(url), 'xotelo');
    if (body.error) throw new Error(`xotelo: ${JSON.stringify(body.error).slice(0, 80)}`);
    const rates = body.result?.rates;
    if (!Array.isArray(rates)) throw new Error('xotelo: no result.rates[] in the response');
    if (rates.length === 0) return null;

    const nightly = rates.map((rate) => money(rate.rate)).filter(Boolean).sort((a, b) => a - b)[0];
    return nightly ? { nightly, currency: 'USD', via: 'tripadvisor' } : null;
  },
};

/* ---------------------------------------------------- Amadeus, and why it is gone */

/*
 * Amadeus used to be here and is not any more: its Self-Service tier became
 * business-only, so there is no key an individual can get. The adapter has been
 * removed rather than left switched off, because a source that can never run is
 * a fifth of this file to read past and a fifth of it to keep working.
 *
 * If it reopens, the shape it wanted was OAuth2 client-credentials against
 * `/v1/security/oauth2/token`, then `/v3/shopping/hotel-offers?hotelIds=…`,
 * with the cheapest of `data[0].offers[].price.total`. It also needed a
 * hotel id per hotel, resolved through `/v1/reference-data/locations/hotels`.
 */

/* -------------------------------------------------------------------- Apify */

/**
 * Whatever actor somebody has pointed this at.
 *
 * Confidence: **low, by design**. Apify is a platform rather than an API: the
 * request shape here — a synchronous actor run returning dataset items — is
 * documented and stable, but the *items* are whatever that actor emits, and
 * that is the operator's choice. So the actor id is configuration, and the
 * parser accepts a small set of common field names and throws on anything else
 * rather than guessing which number is a price.
 *
 * $5 of monthly credit is the smallest allowance of the four, so this is the
 * last source tried and the first to run dry. It exists as insurance: when the
 * other three have all changed their terms, an actor can be pointed at
 * something else without touching this file.
 */
export const apify = {
  name: 'apify',
  covers: 'area',
  ready: (env) => Boolean(env.APIFY_TOKEN && env.APIFY_ACTOR),
  cost: 1,

  async quoteArea(places, { env, whenMs, fetch: get = fetch }) {
    const url = new URL(
      `https://api.apify.com/v2/acts/${env.APIFY_ACTOR}/run-sync-get-dataset-items`,
    );
    url.searchParams.set('token', env.APIFY_TOKEN);

    const response = await get(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        search: 'Indianapolis downtown',
        checkIn: nightOf(whenMs, 30),
        checkOut: nightOf(whenMs, 31),
        currency: 'USD',
        maxItems: 100,
      }),
    });
    const items = await readJson(response, 'apify');
    if (!Array.isArray(items)) throw new Error('apify: the actor did not return a list');

    const found = [];
    for (const item of items) {
      const name = item.name ?? item.title ?? item.hotelName;
      const nightly = money(item.price, item.priceValue, item.rate, item.lowestPrice);
      if (!name || !nightly) continue;
      const place = matchByName(places, name);
      if (place) found.push({ placeId: place.id, nightly, currency: 'USD', via: String(name) });
    }
    if (found.length === 0 && items.length > 0) {
      // Items came back and none of them looked like a hotel with a price. That
      // is a parser that has stopped matching, not an area with no hotels.
      throw new Error(`apify: ${items.length} items and no recognisable price`);
    }
    return found;
  },
};

/* --------------------------------------------------------------- name matching */

/**
 * Tie a rate service's name for a hotel to OpenStreetMap's.
 *
 * The join nobody wants to own. "JW Marriott Indianapolis", "JW Marriott
 * Indianapolis Downtown" and "Indianapolis JW Marriott" are one building, and
 * "Hampton Inn Indianapolis Downtown Across from Circle Centre" and "Hampton Inn
 * Indianapolis Downtown IUPUI" are emphatically two.
 *
 * So this is deliberately strict: normalise, then require that one name's
 * significant words are a subset of the other's. That misses real matches and
 * keeps false ones out, which is the right way round — a missed match costs a
 * blank cell, a false one puts the IUPUI Hampton's price on the Circle Centre
 * Hampton and somebody books the wrong hotel.
 */
const NOISE = new Set([
  'hotel', 'inn', 'suites', 'suite', 'the', 'a', 'an', 'and', 'by', 'at', 'of', 'on',
  'indianapolis', 'indy', 'downtown', 'in', 'near', 'hotels',
  /*
   * Chain names, and this line was bought with a wrong price.
   *
   * "Tru by Hilton Indianapolis Downtown" and "Tru by Hilton
   * Indianapolis-Lawrence" are two hotels seventeen kilometres apart. With
   * `hilton` counted as a distinguishing word they share two — tru and hilton —
   * which cleared the two-word bar, and a downtown rate landed on a hotel in a
   * suburb. A franchise brand says who runs a hotel, not which one it is.
   */
  'hilton', 'marriott', 'hyatt', 'wyndham', 'ihg', 'choice', 'radisson', 'best', 'western',
]);

/** Every token, for names made entirely of the words above. */
const allWords = (name) =>
  new Set(
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );

export function words(name) {
  const kept = new Set(
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((word) => word && !NOISE.has(word)),
  );
  /*
   * Some hotels are named entirely out of what this strips.
   *
   * "Marriott Indianapolis Downtown" is three noise words and nothing else, and
   * an empty set matches nothing at all — so a name that disappears falls back
   * to its full token list, where it can still be compared with another.
   */
  return kept.size > 0 ? kept : allWords(name);
}

/**
 * How far apart two points are, in metres.
 *
 * Duplicated from `blocks.ts` rather than imported: this file runs under bare
 * node in a workflow and that one is TypeScript the app compiles.
 */
function metresApart(a, b) {
  const R = 6_371_000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Two hotels are the same building if they are in the same place.
 *
 * Names are a bad key and this is a better one. Indianapolis has four hotels
 * that all reduce to "la quinta" — one 1.4 km from the hall and three sixteen
 * kilometres out — and no amount of care with words can tell them apart,
 * because their names genuinely are identical. Their coordinates are not.
 *
 * Eighty metres is generous enough for the difference between a front door and
 * a building centroid, and tight enough that no two hotels in this city share
 * it. A tie inside that radius still refuses rather than guessing.
 */
const SAME_BUILDING_M = 80;

export function matchByPoint(places, point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  const near = places
    .filter((one) => Number.isFinite(one.lat) && Number.isFinite(one.lng))
    .map((one) => ({ place: one, away: metresApart(one, point) }))
    .filter((one) => one.away <= SAME_BUILDING_M)
    .sort((a, b) => a.away - b.away);
  if (near.length === 0) return null;
  // Two hotels within eighty metres of one point is a car park, not a match.
  if (near.length > 1 && near[1].away - near[0].away < 25) return null;
  return near[0].place;
}

export function matchByName(places, name) {
  const theirs = words(name);
  if (theirs.size === 0) return null;

  const candidates = [];
  for (const place of places) {
    const ours = words(place.name);
    if (ours.size === 0) continue;
    const shared = [...theirs].filter((word) => ours.has(word)).length;
    // One side must be wholly contained in the other: every distinguishing word
    // of the shorter name has to appear in the longer one.
    if (shared !== Math.min(theirs.size, ours.size)) continue;
    /*
     * A single shared word is only enough when it is the whole of both names.
     *
     * This is the rule that took a real scalp. "Courtyard by Marriott Downtown"
     * reduces to {courtyard, marriott} and "Marriott Indianapolis Downtown" to
     * {marriott} — contained, one word shared, and the block rate for a
     * Courtyard landed on the Marriott. Requiring two shared words, or an exact
     * one-word name on both sides, refuses that pairing instead of guessing.
     */
    if (shared < 2 && !(theirs.size === 1 && ours.size === 1)) continue;
    candidates.push({ place, slack: Math.abs(theirs.size - ours.size) });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.slack - b.slack);
  // Two words left unaccounted for is where "Hampton Inn Downtown" stops being
  // one hotel and starts being a chain in a city.
  if (candidates[0].slack > 2) return null;
  /*
   * A tie is an ambiguity, and an ambiguity resolved by array order is a
   * coin toss dressed up as an answer. Two Hampton Inns four streets apart both
   * reduce to {hampton}; picking whichever came first would put one's price on
   * the other, and nothing downstream could tell.
   */
  if (candidates.length > 1 && candidates[1].slack === candidates[0].slack) return null;
  return candidates[0].place;
}

/** In the order the run loop should try them: cheapest allowance spent last. */
export const ALL = [serpapi, xotelo, apify];
