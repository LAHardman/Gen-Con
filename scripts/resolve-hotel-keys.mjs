/**
 * Find each hotel's TripAdvisor key, so the keyless price source can ask.
 *
 *     node scripts/resolve-hotel-keys.mjs --probe    # what does the API return?
 *     node scripts/resolve-hotel-keys.mjs            # resolve, and write the store
 *
 * WHY THIS EXISTS. Of the three price sources, exactly one needs no key, no
 * account and no card: Xotelo, which republishes TripAdvisor's rates. Its one
 * condition is that every request names a hotel by TripAdvisor's own key, and
 * that key is in no dataset this app already holds — not in OpenStreetMap, not
 * in Gen Con's list. So `xotelo.quote` has been returning `null` on the first
 * line, for every hotel, since it was written: no key, no request, no price.
 * 169 hotels have no price for want of an identifier.
 *
 * Resolved once and kept. A hotel's TripAdvisor key does not change, so this
 * writes into `keys` in `src/data/rate-store.json` beside the quotes and a
 * later run skips whatever is already there. The monthly price run does not
 * depend on this having succeeded — a place with no key is skipped exactly as
 * it was before.
 *
 * MATCHED ON THE BUILDING, NOT THE NAME. `matchByPoint` first, because this
 * city has four hotels that all reduce to "la quinta" and their coordinates are
 * the only thing that tells them apart; `matchByName` only for a listing with
 * no usable coordinates. Both refuse a tie rather than picking from it. A wrong
 * key is worse than no key: it does not fail, it prints another hotel's price
 * under this hotel's name, and nothing downstream can tell.
 *
 * WHAT THE LIVE SERVICE ACTUALLY SAID, measured on a GitHub runner across three
 * rounds on 2026-08-14, because none of these hosts is reachable from the
 * sandbox this app is written in:
 *
 *   /api/rates      WORKS, free, no key. Answered `{"error":null,"result":
 *                   {...,"currency":"USD","rates":[]}}` and accepted a
 *                   `g37209-d1750052` shaped hotel_key. The adapter in
 *                   `sources.mjs` is reading the right shape.
 *   /api/search     PAYWALLED. 401, "available only for RapidAPI".
 *   /api/locations  404. /api/hotels 404. Neither exists.
 *   /api/list       REFUSES EVERYTHING. `location_key=g37209` alone gives
 *                   "Failed to fetch list data"; adding dates gives "chk_in is
 *                   invalid" — for the very same `2026-09-13` string that
 *                   `/api/rates` accepted in the same run, at a week out and at
 *                   thirty, in ISO and in US order, with the geo id and without
 *                   its `g`.
 *
 * So there is no free way to *discover* a TripAdvisor key, only to use one. The
 * priced endpoint is open and the index in front of it is not, which is a
 * coherent thing for a business to do and leaves this script with nothing to
 * read. It therefore reports that and writes nothing, rather than failing the
 * run: a month with no keys is exactly the month everything had before.
 *
 * If keys arrive from anywhere — a hand-written table like `block-aliases.mjs`,
 * a RapidAPI subscription, `list` reopening — drop them into `keys` in the
 * store and the whole path downstream already works.
 *
 * --probe asks, prints exactly what came back, and writes nothing. Run it on a
 * machine with an open network before trusting any of the above; it is how all
 * of it was learned.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { matchByName, matchByPoint, nightOf } from './lib/rates/sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = join(ROOT, 'src/data/rate-store.json');
const LODGING = join(ROOT, 'src/data/lodging.ts');

const PROBE = process.argv.includes('--probe');

/**
 * TripAdvisor's geo keys for the towns this app's hotels sit in.
 *
 * Written down rather than searched for because they are stable identifiers for
 * places that will not move, and because a search endpoint is one more thing
 * that can be switched off. `--probe` prints whether each one still answers.
 */
const AREAS = [
  { key: 'g37209', name: 'Indianapolis' },
  { key: 'g37796', name: 'Carmel' },
  { key: 'g37826', name: 'Fishers' },
  { key: 'g37244', name: 'Plainfield' },
  { key: 'g37151', name: 'Brownsburg' },
  { key: 'g37782', name: 'Greenwood' },
  { key: 'g37821', name: 'Noblesville' },
  { key: 'g37860', name: 'Speedway' },
];

/** How many a page returns, and how many pages are worth walking. */
const PAGE = 30;
const PAGES = 12;

const get = async (url) => {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'gen-con-trip-planner (+github)' },
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* left null; the caller prints the text instead */
  }
  return { ok: response.ok, status: response.status, text, body };
};

/* ------------------------------------------------------------------- probing */

if (PROBE) {
  console.error('Asking Xotelo what it actually returns. Nothing is written.\n');

  /*
   * What the first round established, so a second round is not spent on it:
   *   /api/rates   is free and works — it answered "chk_in is required"
   *   /api/search  is not — 401, "available only for RapidAPI"
   *   /api/list    exists and rejected `location_key` alone as a bad request
   *
   * So the question left is what else `list` wants. It returns prices, and the
   * priced endpoint needs dates, which is the first guess below.
   */
  const list = (query) => `https://data.xotelo.com/api/list?${query}`;
  const IN = nightOf(Date.now(), 30);
  const OUT = nightOf(Date.now(), 31);

  const tries = [
    ['list, no paging, no dates', list('location_key=g37209')],
    ['list, geo without its g, no dates', list('location_key=37209')],
    ['list, sorted by popularity', list('location_key=g37209&limit=30&offset=0&sort=popularity')],
    ['list, sorted by price', list('location_key=g37209&limit=30&offset=0&sort=price')],
    ['list, dates in US order', list('location_key=g37209&chk_in=09/13/2026&chk_out=09/14/2026')],
    ['list, dates only a week out', list(`location_key=g37209&chk_in=${nightOf(Date.now(), 7)}&chk_out=${nightOf(Date.now(), 8)}`)],
    ['list, given a hotel key, to see what it says', list('location_key=g37209-d1750052')],
    ['is there a locations endpoint', 'https://data.xotelo.com/api/locations?query=Indianapolis'],
    ['is there a hotels endpoint', 'https://data.xotelo.com/api/hotels?location_key=g37209'],
    ['rates, further out, to see a non-empty one', `https://data.xotelo.com/api/rates?hotel_key=g37209-d1750052&chk_in=${nightOf(Date.now(), 75)}&chk_out=${nightOf(Date.now(), 76)}&adults=1`],
  ];

  for (const [what, url] of tries) {
    console.error(`--- ${what}\n    ${url}`);
    try {
      const { status, text } = await get(url);
      console.error(`    HTTP ${status}`);
      console.error(
        text
          .slice(0, 1400)
          .split('\n')
          .map((line) => `    ${line}`)
          .join('\n'),
      );
    } catch (error) {
      console.error(`    threw: ${error.message}`);
    }
    console.error('');
  }
  process.exit(0);
}

/* ----------------------------------------------------------------- resolving */

/** The hotels this app knows about, read the way `fetch-rates.mjs` reads them. */
function ourPlaces() {
  const source = readFileSync(LODGING, 'utf8');
  const shape =
    /\{ id: '([^']+)', name: (".*?"), kind: '([^']+)', metres: (\d+), ring: '(walk|drive)', lat: ([-\d.]+), lng: ([-\d.]+)(.*?) \},/g;
  const places = [];
  for (const row of source.matchAll(shape)) {
    places.push({ id: row[1], name: JSON.parse(row[2]), lat: Number(row[6]), lng: Number(row[7]) });
  }
  if (!places.length) throw new Error('read no hotels out of lodging.ts — has its shape changed?');
  return places;
}

/**
 * Everything one town lists, walked a page at a time.
 *
 * A page that comes back short is the last one; a page that comes back broken
 * ends that town rather than the run, because eight towns each answering for
 * themselves is the whole reason they are listed separately.
 */
async function listArea(area, log) {
  const found = [];
  for (let page = 0; page < PAGES; page += 1) {
    const url = `https://data.xotelo.com/api/list?location_key=${area.key}&limit=${PAGE}&offset=${page * PAGE}`;
    const { ok, status, body, text } = await get(url);
    if (!ok) {
      log(`  ${area.name}: HTTP ${status}, stopping there`);
      break;
    }
    /*
     * The expected answer, as of the probe above: this endpoint declines. It is
     * reported once per town and is not an error — an index that is not free is
     * a fact about the service, not a fault in the run, and the month it leaves
     * behind is the month everything already had.
     */
    if (body?.error) {
      log(`  ${area.name}: declined — ${String(body.error.message ?? '').slice(0, 90)}`);
      break;
    }
    const list = body?.result?.list;
    if (!Array.isArray(list)) {
      throw new Error(
        `xotelo list: no result.list[] for ${area.name} — got ${text.slice(0, 200)}`,
      );
    }
    found.push(...list);
    if (list.length < PAGE) break;
  }
  return found;
}

/** A listing's coordinates, whatever this API decided to call them. */
const pointOf = (listing) => {
  const lat = Number(listing?.geo?.latitude ?? listing?.latitude ?? listing?.lat);
  const lng = Number(listing?.geo?.longitude ?? listing?.longitude ?? listing?.lng ?? listing?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

/**
 * Tie listings to our hotels, one to one, refusing anything unclear.
 *
 * One-to-one because two of our places claiming one listing means one of them
 * is wrong and there is no way to tell which; both are dropped and reported.
 */
export function tieUp(places, listings) {
  const claimed = new Map();
  const clashes = [];

  for (const listing of listings) {
    const key = listing?.key ?? listing?.hotel_key;
    if (!key || !listing?.name) continue;

    const place = matchByPoint(places, pointOf(listing)) ?? matchByName(places, listing.name);
    if (!place) continue;

    const already = claimed.get(place.id);
    if (already && already.key !== key) {
      clashes.push({ place, keys: [already.key, key] });
      continue;
    }
    claimed.set(place.id, { key, name: listing.name });
  }

  for (const clash of clashes) claimed.delete(clash.place.id);
  return { ties: claimed, clashes };
}

const log = (line) => console.error(line);

const places = ourPlaces();
const store = JSON.parse(readFileSync(STORE, 'utf8'));
store.keys ??= {};

log(`${places.length} hotels, ${Object.keys(store.keys).length} of them already keyed`);

const listings = [];
for (const area of AREAS) {
  const found = await listArea(area, log);
  log(`  ${area.name}: ${found.length} listed`);
  listings.push(...found);
}
log(`${listings.length} listings in all`);

/*
 * Nothing listed is the measured case, not a surprise. Said plainly and left
 * alone: exiting non-zero here would fail a monthly run for a condition that
 * changes nothing, and every hotel is skipped by `canAsk` exactly as before.
 */
if (listings.length === 0) {
  log('');
  log('No listings, so no keys. Xotelo prices a hotel for free but does not');
  log('hand out the index: /api/search is RapidAPI-only and /api/list declines');
  log('every parameter it was offered. Nothing written, nothing spent — and');
  log('nothing broken, since a hotel with no key was already being skipped.');
  log('');
  log('Keys from anywhere else go straight into `keys` in rate-store.json and');
  log('the rest of the path already works. Otherwise the prices come from a');
  log('source with an account: see SERPAPI_KEY in .github/workflows/rates.yml.');
  process.exit(0);
}

const { ties, clashes } = tieUp(places, listings);

let added = 0;
for (const [id, tie] of ties) {
  if (store.keys[id]) continue;
  store.keys[id] = tie.key;
  added += 1;
}

for (const clash of clashes) {
  log(`  refused ${clash.place.name}: two listings claim it (${clash.keys.join(', ')})`);
}

const keyed = places.filter((place) => store.keys[place.id]).length;
log(`tied ${added} new, ${keyed} of ${places.length} hotels now have a key`);

if (added > 0) {
  writeFileSync(STORE, `${JSON.stringify(store, null, 1)}\n`, 'utf8');
  log(`wrote ${STORE}`);
} else {
  log('nothing new to write');
}
