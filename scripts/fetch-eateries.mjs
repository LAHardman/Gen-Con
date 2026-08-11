/**
 * Somewhere to eat that is not a food truck, pulled from OpenStreetMap.
 *
 *     node scripts/fetch-eateries.mjs
 *     node scripts/fetch-eateries.mjs --from response.json
 *
 * Regenerates src/data/eateries.ts. Overpass is a shared free service, so this
 * is run by hand when the data is worth refreshing rather than by the build.
 *
 * WHY THIS EXISTS. Gen Con's own catalogue knows about 43 food trucks on South
 * Street and nothing else, and the convention is in the middle of a city. The
 * question "where can I eat" has an answer four hundred metres away that no
 * amount of work on Gen Con's data will ever produce.
 *
 * WHAT IS TAKEN, and the rule is deliberately strict: anything with a name, a
 * **cuisine**, and either **opening hours** or a **website**. 111 named eating
 * places are in the box and 48 pass — because the other 63 are a name and a dot
 * on a map, and a list a third made of "Starbucks, no idea" is a list nobody
 * scrolls twice. A cuisine is what makes it findable; hours or a site are what
 * make it worth walking to.
 *
 * WHAT IS KEPT of what OSM holds: the name, what sort of place it is, its
 * cuisines, its opening hours *verbatim*, its website, its dietary flags and
 * its street address. Nothing is normalised on the way in — `opening_hours` is
 * a real specification with its own grammar and the app reads what it can and
 * prints the rest as written, which is the only honest thing to do with a
 * string like `Mo-Th 11:00-23:00; Fr-Sa 11:00-24:00; Su 11:00-22:00`.
 *
 * THESE ARE VOLUNTEER HOURS, not published ones, and the file says when it was
 * pulled so the app can say so too. That is a step up from the Block Party's,
 * which are last year's — see `food.ts` — and it is still not a promise.
 *
 * Source: OpenStreetMap, © OpenStreetMap contributors, ODbL. Same licence and
 * same credit as `footprints.ts`, `pavements.ts` and `addresses.ts`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/data/eateries.ts');

/** The same mirrors `fetch-addresses.mjs` uses, and for the same reason. */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];
const AGENT = 'gen-con-trip/0.1 (+https://github.com/LAHardman/Gen-Con)';

/** The same box as the addresses: the campus and a good walk around it. */
const BOX = [39.753, -86.18, 39.776, -86.15];

/**
 * What counts as somewhere to eat.
 *
 * OSM's own `amenity` values. `bar` and `pub` are in the query and almost never
 * carry a cuisine, so they mostly fall out at the next step rather than being
 * excluded here — a pub that has filled in its kitchen's cuisine is somewhere
 * to eat and should be kept.
 */
const AMENITIES = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream', 'food_court'];

/** What to call each of those on screen. */
const KIND_NAMES = {
  restaurant: 'Restaurant',
  cafe: 'Café',
  fast_food: 'Fast food',
  bar: 'Bar',
  pub: 'Pub',
  ice_cream: 'Ice cream',
  food_court: 'Food court',
};

async function overpass(query) {
  let wait = 4_000;
  let last = 'nothing tried';
  for (let round = 1; round <= 3; round += 1) {
    for (const endpoint of ENDPOINTS) {
      const host = new URL(endpoint).host;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'User-Agent': AGENT },
          body: new URLSearchParams({ data: query }),
        });
        const text = await response.text();
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
const list = (values) => `[${values.map(quote).join(', ')}]`;

/** OSM writes several with semicolons: `chicken;sandwich`. */
const split = (value) =>
  (value ?? '')
    .split(';')
    .map((one) => one.trim())
    .filter(Boolean);

/**
 * `coffee_shop` as somebody would say it.
 *
 * OSM's cuisine values are lower-case with underscores, which is a key rather
 * than a label. Nothing is translated or merged — `steak_house` stays its own
 * value and does not become `steak` — because merging them here would be this
 * script deciding what two words mean.
 */
const titleCase = (value) =>
  value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

async function main() {
  const [s, w, n, e] = BOX;
  const query =
    `[out:json][timeout:120];\n` +
    `(nwr["amenity"~"^(${AMENITIES.join('|')})$"](${s},${w},${n},${e}););\n` +
    `out tags center;`;

  const replay = process.argv.indexOf('--from');
  const data =
    replay === -1
      ? await overpass(query)
      : JSON.parse(readFileSync(process.argv[replay + 1], 'utf8'));
  if (replay === -1) console.log(`Overpass: eating places in ${s},${w},${n},${e}`);
  else console.log(`replaying ${process.argv[replay + 1]} — not asking Overpass`);

  const named = data.elements.filter((one) => one.tags?.name);
  const rows = [];
  const seen = new Set();

  for (const element of named) {
    const tags = element.tags;
    const at = element.type === 'node' ? element : element.center;
    if (!at) continue;

    const cuisine = split(tags.cuisine).map(titleCase);
    const hours = tags.opening_hours?.trim();
    const website = (tags.website ?? tags['contact:website'])?.trim();
    // The rule, in one line: findable, and worth walking to.
    if (!cuisine.length || (!hours && !website)) continue;

    // A chain has several branches downtown and each is its own place; the same
    // *place* mapped twice as a node and a building is not. Keyed on the name
    // and where it is, to a hundred metres or so.
    const key = `${tags.name.toLowerCase()}|${at.lat.toFixed(3)}|${at.lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const diet = [];
    for (const [tag, label] of [
      ['diet:vegetarian', 'Vegetarian'],
      ['diet:vegan', 'Vegan'],
      ['diet:gluten_free', 'Gluten free'],
    ]) {
      // `only` and `yes` both mean you can eat there; `no` and `limited` do not
      // get a badge, because a badge that can mean "not really" is worse than
      // none at all.
      if (tags[tag] === 'yes' || tags[tag] === 'only') diet.push(label);
    }

    const number = tags['addr:housenumber']?.trim();
    const street = tags['addr:street']?.trim();

    rows.push({
      id: `${element.type[0]}${element.id}`,
      name: tags.name.trim(),
      kind: KIND_NAMES[tags.amenity] ?? 'Restaurant',
      cuisine,
      hours,
      website: website && /^https?:\/\//.test(website) ? website : undefined,
      diet,
      address: number && street ? `${number} ${street}` : street,
      lat: round(at.lat),
      lng: round(at.lon),
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  if (rows.length < 20) throw new Error(`only ${rows.length} eating places — refusing to write`);

  const counts = new Map();
  for (const row of rows) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
  console.log(
    `  ${named.length} named -> ${rows.length} kept ` +
      `(${[...counts].map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')})`,
  );
  console.log(
    `  ${rows.filter((r) => r.hours).length} with hours, ` +
      `${rows.filter((r) => r.website).length} with a site, ` +
      `${rows.filter((r) => r.diet.length).length} with dietary flags`,
  );

  const pulled = new Date().toISOString().slice(0, 10);
  const source = `/**
 * Somewhere to eat downtown, from OpenStreetMap.
 *
 * Generated by scripts/fetch-eateries.mjs — do not edit by hand.
 *
 * Gen Con's own catalogue knows about 43 food trucks on South Street and
 * nothing else, and the convention is in the middle of a city. Everything here
 * carries a name, a cuisine and either opening hours or a website — the other
 * sixty-odd eating places in the box are a name and a dot on a map, and a list
 * a third made of "no idea" is a list nobody scrolls twice.
 *
 * THE HOURS ARE VOLUNTEERS' AND ARE KEPT VERBATIM. \`opening_hours\` is a real
 * specification and this stores exactly what OSM says; \`openingText\` in
 * \`eateries.ts\`'s reader turns the common forms into a sentence and prints the
 * rest as written rather than guessing. \`PULLED\` is the day they were read,
 * and the app shows it, because a restaurant's hours change and nobody here
 * will know when they do.
 *
 * Source: OpenStreetMap, © OpenStreetMap contributors, ODbL.
 */

export interface Eatery {
  /** OSM's own id, prefixed by element type. Stable enough to key a plan by. */
  id: string;
  name: string;
  /** Restaurant, Café, Fast food, Bar, Pub, Ice cream. */
  kind: string;
  /** OSM's \`cuisine\`, title-cased and split on its semicolons. */
  cuisine: string[];
  /** \`opening_hours\`, exactly as written. Absent where nobody has said. */
  hours?: string;
  website?: string;
  /** Only where OSM says yes or only — never where it says limited. */
  diet: string[];
  address?: string;
  lat: number;
  lng: number;
}

/** The day this was read from OpenStreetMap. */
export const PULLED = '${pulled}';

export const EATERIES: ReadonlyArray<Eatery> = [
${rows
  .map((row) => {
    const parts = [
      `id: ${quote(row.id)}`,
      `name: ${quote(row.name)}`,
      `kind: ${quote(row.kind)}`,
      `cuisine: ${list(row.cuisine)}`,
      row.hours ? `hours: ${quote(row.hours)}` : null,
      row.website ? `website: ${quote(row.website)}` : null,
      `diet: ${list(row.diet)}`,
      row.address ? `address: ${quote(row.address)}` : null,
      `lat: ${row.lat}`,
      `lng: ${row.lng}`,
    ].filter(Boolean);
    return `  { ${parts.join(', ')} },`;
  })
  .join('\n')}
];
`;

  writeFileSync(OUT, source);
  console.log(`  wrote ${OUT}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
