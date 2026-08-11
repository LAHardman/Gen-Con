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

  /** One search, one area, many prices back. */
  async quoteArea(places, { env, whenMs, fetch: get = fetch }) {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google_hotels');
    url.searchParams.set('q', 'hotels near Indiana Convention Center Indianapolis');
    url.searchParams.set('check_in_date', nightOf(whenMs, 30));
    url.searchParams.set('check_out_date', nightOf(whenMs, 31));
    url.searchParams.set('adults', '1');
    url.searchParams.set('currency', 'USD');
    url.searchParams.set('api_key', env.SERPAPI_KEY);

    const body = await readJson(await get(url), 'serpapi');
    if (body.error) throw new Error(`serpapi: ${body.error}`);
    const rows = body.properties;
    if (!Array.isArray(rows)) throw new Error('serpapi: no properties[] in the response');

    const found = [];
    for (const row of rows) {
      const nightly = money(row.rate_per_night?.extracted_lowest, row.rate_per_night?.lowest);
      if (!nightly || !row.name) continue;
      const place = matchByName(places, row.name);
      if (place) found.push({ placeId: place.id, nightly, currency: 'USD', via: row.name });
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

/* ------------------------------------------------------------------ Amadeus */

/**
 * Amadeus, in its test environment.
 *
 * Confidence: **fair**. OAuth2 client-credentials and the
 * `/v3/shopping/hotel-offers` shape are documented; what is *not* documented is
 * a monthly quota for the hotel APIs at all, which is why its budget in
 * `quota.mjs` is a guess biased low.
 *
 * The test environment carries a limited, partly synthetic data set. A price
 * from here is real in shape and may not be real in amount — so quotes carry
 * their source all the way to the page, and the page says which is which.
 */
export const amadeus = {
  name: 'amadeus',
  covers: 'place',
  ready: (env) => Boolean(env.AMADEUS_KEY && env.AMADEUS_SECRET),
  cost: 1,

  /** Bearer tokens last ~30 minutes; one per run is plenty. */
  async token({ env, fetch: get = fetch, cache }) {
    if (cache?.amadeusToken) return cache.amadeusToken;
    const response = await get('https://test.api.amadeus.com/v1/security/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.AMADEUS_KEY,
        client_secret: env.AMADEUS_SECRET,
      }),
    });
    const body = await readJson(response, 'amadeus token');
    if (!body.access_token) throw new Error('amadeus: no access_token');
    if (cache) cache.amadeusToken = body.access_token;
    return body.access_token;
  },

  async quote(place, context) {
    const hotelId = context.keys?.[`amadeus:${place.id}`];
    if (!hotelId) return null;
    const get = context.fetch ?? fetch;
    const token = await this.token(context);

    const url = new URL('https://test.api.amadeus.com/v3/shopping/hotel-offers');
    url.searchParams.set('hotelIds', hotelId);
    url.searchParams.set('checkInDate', nightOf(context.whenMs, 30));
    url.searchParams.set('checkOutDate', nightOf(context.whenMs, 31));
    url.searchParams.set('adults', '1');

    const response = await get(url, { headers: { Authorization: `Bearer ${token}` } });
    // A hotel with nothing available answers 400 with its own error code, which
    // is an answer about that hotel rather than a broken source.
    if (response.status === 400) return null;
    const body = await readJson(response, 'amadeus');
    const offers = body.data?.[0]?.offers;
    if (!Array.isArray(offers)) return null;

    const nightly = offers
      .map((offer) => money(offer.price?.total, offer.price?.base))
      .filter(Boolean)
      .sort((a, b) => a - b)[0];
    return nightly ? { nightly, currency: body.data[0].offers[0]?.price?.currency ?? 'USD', via: 'amadeus-test' } : null;
  },
};

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
]);

export function words(name) {
  return new Set(
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((word) => word && !NOISE.has(word)),
  );
}

export function matchByName(places, name) {
  const theirs = words(name);
  if (theirs.size === 0) return null;
  let best = null;
  for (const place of places) {
    const ours = words(place.name);
    if (ours.size === 0) continue;
    const shared = [...theirs].filter((word) => ours.has(word)).length;
    // One side must be wholly contained in the other: every distinguishing word
    // of the shorter name has to appear in the longer one.
    const contained = shared === Math.min(theirs.size, ours.size);
    if (!contained) continue;
    // Among containments, prefer the one that leaves least unexplained.
    const slack = Math.abs(theirs.size - ours.size);
    if (!best || slack < best.slack) best = { place, slack };
  }
  // Two words left unaccounted for is where "Hampton Inn Downtown" stops being
  // one hotel and starts being a chain in a city.
  return best && best.slack <= 2 ? best.place : null;
}

/** In the order the run loop should try them: cheapest allowance spent last. */
export const ALL = [serpapi, xotelo, amadeus, apify];
