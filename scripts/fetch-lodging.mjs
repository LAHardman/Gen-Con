/**
 * Everywhere you could sleep, near the hall and out to a half-hour drive.
 *
 *     node scripts/fetch-lodging.mjs
 *
 * Regenerates `src/data/lodging.ts`. Run by hand: it is a slow crawl of a
 * shared free service and the answer changes about as often as hotels get built.
 *
 * WHY NOMINATIM AND NOT OVERPASS. Overpass is the right tool and this repo uses
 * it everywhere else. It was returning 503 and then 504 on a single-node query
 * when this was written, and its three mirrors are unreachable from some
 * networks. Nominatim is a geocoder rather than a tag dump, which has a real
 * consequence: it caps each answer, so **this produces a sample rather than a
 * census**. Every count downstream is a floor. `sampled: true` in the output
 * says so rather than leaving somebody to assume otherwise.
 *
 * THE TWO RINGS, AND WHY THEY ARE NOT THE SAME KIND OF THING.
 *
 * `walk` is the honest one: a radius around the convention centre small enough
 * that a straight line and a pavement are nearly the same journey.
 *
 * `drive` is an approximation and is labelled as one everywhere it surfaces. A
 * thirty-minute drive is a shape, not a circle — it reaches much further up an
 * interstate than across downtown at five o'clock — and drawing that shape needs
 * a routing engine this app deliberately does not depend on. So it is a radius
 * of DRIVE_KM, which is roughly what half an hour buys in mixed Indianapolis
 * traffic, and it will include places you cannot reach in thirty minutes and
 * miss places you can.
 *
 * Source: OpenStreetMap, © OpenStreetMap contributors, ODbL — the same licence
 * and credit as `footprints.ts`, `pavements.ts` and `eateries.ts`.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/data/lodging.ts');

/** The convention centre's north-west corner, from `venues.ts`. */
const ICC = { lat: 39.765683, lng: -86.166846 };

/** A walk somebody would actually make with a bag, in metres. */
const WALK_M = 1600;

/**
 * The drive radius, in kilometres.
 *
 * Downtown to Carmel, Greenwood or the airport is fifteen to twenty kilometres
 * and takes twenty-five to thirty-five minutes depending on the hour. Twenty-five
 * is the generous end of that, chosen deliberately: a place wrongly included can
 * be judged by its drive time on the page, and a place wrongly excluded is
 * invisible.
 */
const DRIVE_KM = 25;

const AGENT = 'gen-con-trip/0.1 (+https://github.com/LAHardman/Gen-Con)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/** Terms rather than tags, because a geocoder searches names. */
const TERMS = ['hotel', 'motel', 'inn', 'suites', 'hostel', 'guest house', 'extended stay'];

const metres = (a, b) => {
  const R = 6_371_000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
};

/** Nominatim asks for no more than one request a second, and means it. */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 1_100));

async function sweep(box, term, into) {
  const url =
    `${NOMINATIM}?format=jsonv2&limit=50&bounded=1&extratags=1&addressdetails=1` +
    `&viewbox=${box.join(',')}&q=${encodeURIComponent(term)}`;
  let rows = [];
  try {
    const response = await fetch(url, { headers: { 'User-Agent': AGENT } });
    if (!response.ok) {
      console.error(`  ${response.status} for "${term}"`);
      return 0;
    }
    rows = await response.json();
  } catch (error) {
    console.error(`  failed "${term}": ${error.message}`);
    return 0;
  }

  let added = 0;
  for (const row of rows) {
    if (row.category !== 'tourism') continue;
    const key = `${row.osm_type}${row.osm_id}`;
    if (into.has(key)) continue;
    const name = (row.name || '').trim();
    // A hotel with no name is a shape on a map and cannot be looked up by any
    // of the rate services, so it is not somewhere this app can help with.
    if (!name) continue;
    into.set(key, {
      id: key,
      name,
      kind: row.type,
      lat: Number(row.lat),
      lng: Number(row.lon),
      brand: (row.extratags?.brand ?? row.extratags?.operator ?? '').trim(),
      stars: (row.extratags?.stars ?? '').trim(),
      road: (row.address?.road ?? '').trim(),
      city: (row.address?.city ?? row.address?.town ?? row.address?.village ?? '').trim(),
    });
    added += 1;
  }
  return added;
}

/** left,top,right,bottom, as Nominatim wants it. */
const boxAround = (lat, lng, dLat, dLng) => [lng - dLng, lat + dLat, lng + dLng, lat - dLat];

const found = new Map();

// The walk ring first and on its own, at full resolution: it is the part of
// this file anybody actually reads, and it must not be crowded out of a shared
// result cap by two hundred motels off the interstate.
console.error('walk ring');
for (const term of TERMS) {
  const added = await sweep(boxAround(ICC.lat, ICC.lng, 0.02, 0.026), term, found);
  console.error(`  ${term}: +${added}`);
  await breathe();
}

/*
 * Then the drive ring, as a grid.
 *
 * One box this size would hit the 50-row cap on the first term and return
 * whatever happened to rank highest, which for "hotel" is a popularity order
 * that has nothing to do with distance or price. Nine boxes each hit their own
 * cap, so coverage is nine times better for nine times the requests — and it is
 * still a sample.
 */
const dLat = DRIVE_KM / 111;
const dLng = DRIVE_KM / (111 * Math.cos((ICC.lat * Math.PI) / 180));
console.error('drive ring');
for (const row of [-1, 0, 1]) {
  for (const column of [-1, 0, 1]) {
    const lat = ICC.lat + (row * dLat * 2) / 3;
    const lng = ICC.lng + (column * dLng * 2) / 3;
    for (const term of ['hotel', 'motel', 'inn']) {
      const added = await sweep(boxAround(lat, lng, dLat / 3, dLng / 3), term, found);
      if (added) console.error(`  [${row},${column}] ${term}: +${added}`);
      await breathe();
    }
  }
}

const places = [...found.values()]
  .map((place) => ({ ...place, metres: metres(ICC, place) }))
  .filter((place) => place.metres <= DRIVE_KM * 1000)
  .sort((a, b) => a.metres - b.metres);

const walk = places.filter((place) => place.metres <= WALK_M);
console.error(`\n${places.length} places, ${walk.length} of them inside ${WALK_M} m`);

const literal = (place) =>
  `  { id: '${place.id}', name: ${JSON.stringify(place.name)}, kind: '${place.kind}', ` +
  `metres: ${place.metres}, ring: '${place.metres <= WALK_M ? 'walk' : 'drive'}', ` +
  `lat: ${place.lat}, lng: ${place.lng}` +
  (place.brand ? `, brand: ${JSON.stringify(place.brand)}` : '') +
  (place.stars ? `, stars: '${place.stars}'` : '') +
  (place.city ? `, city: ${JSON.stringify(place.city)}` : '') +
  ' },';

writeFileSync(
  OUT,
  `/**
 * Everywhere you could sleep, generated by \`scripts/fetch-lodging.mjs\`.
 *
 * DO NOT EDIT BY HAND — re-run the script.
 *
 * Two rings. \`walk\` is within ${WALK_M} m of the convention centre, where a
 * straight line and a pavement are nearly the same journey. \`drive\` is within
 * ${DRIVE_KM} km, which is a **radius standing in for a half-hour drive** — a real
 * half hour reaches further up an interstate and less across downtown at five
 * o'clock, and drawing that needs a routing engine this app does not depend on.
 *
 * This is a **sample, not a census**: it comes from a geocoder that caps every
 * answer, so treat every count as a floor.
 *
 * © OpenStreetMap contributors, ODbL.
 */

export interface Lodging {
  id: string;
  name: string;
  /** OSM's own \`tourism\` value: hotel, motel, hostel, guest_house. */
  kind: string;
  /** Straight-line metres from the convention centre. */
  metres: number;
  ring: 'walk' | 'drive';
  lat: number;
  lng: number;
  brand?: string;
  stars?: string;
  city?: string;
}

/** The walk ring's outer edge, in metres. */
export const WALK_METRES = ${WALK_M};

/** The drive ring's radius, in metres, standing in for half an hour. */
export const DRIVE_METRES = ${DRIVE_KM * 1000};

/** When this was pulled. Hotels open and close; this file does not notice. */
export const PULLED = '${new Date().toISOString().slice(0, 10)}';

/** True because a geocoder capped every query. Never present this as complete. */
export const SAMPLED = true;

/** Nearest first. */
export const LODGING: ReadonlyArray<Lodging> = [
${places.map(literal).join('\n')}
];

export const WALKABLE: ReadonlyArray<Lodging> = LODGING.filter((one) => one.ring === 'walk');
`,
  'utf8',
);
console.error(`wrote ${OUT}`);
