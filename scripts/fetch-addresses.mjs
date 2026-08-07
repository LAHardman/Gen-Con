/**
 * Every street address downtown, pulled from OpenStreetMap.
 *
 * The map knows fourteen buildings very well and the rest of the city not at
 * all, which is fine until somebody's event is at a steakhouse. Gen Con
 * schedules 40 of those — a loft, a brewpub, a ballpark, a museum lawn — and
 * writes each one as a street address in the `Room` field, so the only thing
 * standing between the schedule and a route is a table of what those addresses
 * mean.
 *
 *     node scripts/fetch-addresses.mjs
 *
 * Regenerates src/data/addresses.ts. Overpass is a shared free service, so this
 * is run by hand when the data is worth refreshing rather than by the build.
 *
 * WHAT IS TAKEN. Anything carrying both `addr:housenumber` and `addr:street`,
 * as a node or as a building, over the campus and about a kilometre around it.
 * A building's centre stands for it, which for a downtown block is the middle
 * of the block rather than its door — accurate enough to walk to and honest
 * about being no better, since OSM does not map most entrances here.
 *
 * WHAT IS NOT. Anything with only one half of an address, which cannot be
 * typed and cannot be matched. Interpolation ways, which give a range rather
 * than a place: "100-198 South Street" is not somewhere you can stand.
 *
 * NAMES ARE KEPT WHERE THERE ARE ANY, because they are what somebody types.
 * "St. Elmo" is a name, not a number, and an address table that only answers
 * to "127 South Illinois Street" answers to nothing anybody would enter.
 *
 * ABBREVIATION IS THE WHOLE PROBLEM with matching these. OpenStreetMap writes
 * "South Illinois Street" and Gen Con writes "127 S Illinois St", and neither
 * is wrong. `search.ts` normalises both ends rather than this script rewriting
 * the source: what is stored is what OSM says.
 *
 * Source: OpenStreetMap, © OpenStreetMap contributors, ODbL. Same licence and
 * same credit as `footprints.ts` and `pavements.ts`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/data/addresses.ts');

/**
 * Overpass, and its mirrors, because one host is not a source.
 *
 * The main instance answers 503 or a dispatcher timeout often enough that
 * retrying it alone turns a working script into a broken one for an afternoon.
 * These run the same software over the same planet file; whichever answers
 * first gives the same rows.
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];
const AGENT = 'gen-con-trip/0.1 (+https://github.com/LAHardman/Gen-Con)';

/**
 * The campus and a good walk around it.
 *
 * Wider than `pavements.ts` takes, and deliberately: a pavement outside the box
 * is one nobody walks, but an *address* outside the box is an event nobody can
 * find. Gen Con's offsite venues run from Victory Field in the west to 416 East
 * Wabash, 1.6 km apart, and both have to be in here.
 */
const BOX = [39.753, -86.18, 39.776, -86.15];

async function overpass(query) {
  // Round the mirrors before waiting, then round them again after backing off.
  // An error arrives as an HTML page with 200 on it as often as it arrives as a
  // status, so the check is on the body.
  let wait = 4_000;
  let last = 'nothing tried';
  for (let round = 1; round <= 3; round += 1) {
    for (const endpoint of ENDPOINTS) {
      const host = new URL(endpoint).host;
      let text;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'User-Agent': AGENT },
          body: new URLSearchParams({ data: query }),
        });
        text = await response.text();
        if (text.trimStart().startsWith('{')) {
          if (round > 1 || endpoint !== ENDPOINTS[0]) console.log(`  answered by ${host}`);
          return JSON.parse(text);
        }
        last = text.match(/Error<\/strong>: ([^<]*)/)?.[1]?.trim() ?? `HTTP ${response.status}`;
      } catch (error) {
        last = error.message;
      }
      console.warn(`  ${host}: ${last}`);
    }
    if (round < 3) await new Promise((done) => setTimeout(done, (wait *= 2)));
  }
  throw new Error(`no Overpass mirror would answer: ${last}`);
}

const round = (n) => Number(n.toFixed(6));
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function main() {
  const [s, w, n, e] = BOX;
  const query =
    `[out:json][timeout:180];\n` +
    `(node["addr:housenumber"]["addr:street"](${s},${w},${n},${e});\n` +
    ` way["addr:housenumber"]["addr:street"](${s},${w},${n},${e}););\n` +
    `out tags center;`;

  // `--from response.json` replays a saved Overpass answer instead of asking
  // for a new one. Overpass rate-limits by IP and this repository has several
  // scripts that use it, so a day of work on the others can leave this one
  // unable to run at all — and the fix should not be to ask harder. Save the
  // response once, replay it while iterating on what is written from it.
  const replay = process.argv.indexOf('--from');
  const data =
    replay === -1
      ? await overpass(query)
      : JSON.parse(readFileSync(process.argv[replay + 1], 'utf8'));
  if (replay === -1) console.log(`Overpass: addressed features in ${s},${w},${n},${e}`);
  else console.log(`replaying ${process.argv[replay + 1]} — not asking Overpass`);

  const seen = new Map();
  for (const element of data.elements) {
    const at = element.type === 'node' ? element : element.center;
    if (!at) continue;
    const number = element.tags['addr:housenumber'].trim();
    const street = element.tags['addr:street'].trim();
    const name = element.tags.name?.trim();
    // One entry per address. A building and the shop inside it are two
    // elements and one place; the named one is the more useful of the two,
    // because a name is what somebody types.
    const key = `${number}|${street}`.toLowerCase();
    const kept = seen.get(key);
    if (kept && (kept.name || !name)) continue;
    seen.set(key, { number, street, name, lat: round(at.lat), lng: round(at.lon) });
  }

  const rows = [...seen.values()].sort(
    (a, b) => a.street.localeCompare(b.street) || Number(a.number) - Number(b.number),
  );
  const named = rows.filter((row) => row.name).length;
  console.log(`  ${data.elements.length} elements -> ${rows.length} addresses, ${named} named`);

  const source = `/**
 * Street addresses downtown, from OpenStreetMap.
 *
 * Generated by scripts/fetch-addresses.mjs — do not edit by hand.
 *
 * These are here so that a place the map does not draw can still be walked to.
 * Gen Con schedules events at forty addresses it has no floor plan for, and a
 * pin at the right corner of the right block is the whole of what anybody
 * needs for those: the route to it is the same walk the router already does.
 *
 * A building's entry is the centre of its footprint, not its door. Downtown
 * blocks are large, so that can be 30 m out — which is why nothing here is
 * called a room, and why the map draws these as pins rather than as places
 * with an inside.
 *
 * Source: OpenStreetMap, © OpenStreetMap contributors, ODbL.
 */

export interface StreetAddress {
  /** As OSM writes it: \`addr:housenumber\`. */
  number: string;
  /** As OSM writes it, spelled out — "South Illinois Street". */
  street: string;
  /** What is there, where OSM names it. */
  name?: string;
  lat: number;
  lng: number;
}

export const ADDRESSES: ReadonlyArray<StreetAddress> = [
${rows
  .map(
    (row) =>
      `  { number: ${quote(row.number)}, street: ${quote(row.street)},` +
      `${row.name ? ` name: ${quote(row.name)},` : ''} lat: ${row.lat}, lng: ${row.lng} },`,
  )
  .join('\n')}
];
`;

  writeFileSync(OUT, source);
  console.log(`${OUT}: ${(source.length / 1024) | 0} KB`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
