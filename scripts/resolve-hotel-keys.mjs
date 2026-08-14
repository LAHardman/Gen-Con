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
 * --probe EXISTS BECAUSE THIS COULD NOT BE TRIED WHERE IT WAS WRITTEN. Every
 * one of these hosts is unreachable from the sandbox this app is built in, so
 * the request shapes in `sources.mjs` are written from documentation and have
 * never met the live service. `--probe` asks, prints exactly what came back,
 * and writes nothing — run it on a machine with an open network before trusting
 * any of this.
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
    ['list, with the dates the rates endpoint wants', list(`location_key=g37209&chk_in=${IN}&chk_out=${OUT}`)],
    ['list, dates and paging', list(`location_key=g37209&chk_in=${IN}&chk_out=${OUT}&offset=0&limit=30`)],
    ['list, paging but no dates', list('location_key=g37209&offset=0&limit=30&sort=best_value')],
    ['list, geo id without its g', list(`location_key=37209&chk_in=${IN}&chk_out=${OUT}`)],
    ['list, called hotel_key instead', list(`hotel_key=g37209&chk_in=${IN}&chk_out=${OUT}`)],
    ['rates, with a plausible key, to see a good response', `https://data.xotelo.com/api/rates?hotel_key=g37209-d1750052&chk_in=${IN}&chk_out=${OUT}&adults=1`],
    ['heatmap, which may name its hotel', 'https://data.xotelo.com/api/heatmap?hotel_key=g37209-d1750052'],
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
    if (body?.error) {
      log(`  ${area.name}: ${JSON.stringify(body.error).slice(0, 120)}`);
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
