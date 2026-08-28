/**
 * What Gen Con's own hotel block costs, from Gen Con's own page.
 *
 *     node scripts/fetch-block-rates.mjs
 *
 * Regenerates `src/data/partners.json` from two sources:
 *
 *   `/gen-con-indy/hotelmap`  — Gen Con's published block: hotels with their
 *                               nightly rate, their distance to the convention
 *                               centre and whether a skywalk reaches them.
 *   the 2019 forum thread     — an attendee's table of block rates for 2014,
 *                               2015 and 2019, used for one thing only: working
 *                               out how fast this block's prices actually move.
 *
 * WHY BOTH. The hotel map is the real source and every price on the page comes
 * from it. The forum table earns its place because a projection needs a growth
 * rate, and the honest rate to use is **this block's own**, measured between two
 * years of its own prices, rather than a national hotel index that knows nothing
 * about Indianapolis in the first week of August. Twenty-odd hotels appear in
 * both, and the median annual change across them is what gets written out.
 *
 * WHAT THE PAGE GIVES, and it is more than money:
 *
 *   - a **range** for most hotels, because a block rate is a starting price and
 *     varies by room type. Both ends are kept; showing only the low one would
 *     make the block look cheaper than anybody pays.
 *   - **skywalk**, which is the single most useful fact about an Indianapolis
 *     hotel in August and appears in no other source this app has.
 *   - **five regions**, Gen Con's own grouping, which is why the block includes
 *     airport hotels at a hundred and nine dollars — real, official, current
 *     prices for exactly the "cheapest within a drive" question, free of any
 *     API quota.
 *
 * THE RATES EXCLUDE TAX and are starting prices: Gen Con's own footnote says
 * they "vary by room type and occupancy" and are "non-inclusive of local sales
 * and occupancy taxes". That footnote is carried through to the page.
 *
 * Sources:
 *   https://www.gencon.com/gen-con-indy/hotelmap
 *   https://www.gencon.com/forums/43-travel-housing-and-dining-2019/topics/15787-hotel-costs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { auditAliases, NOT_IN_BLOCK, TIES } from './lib/block-aliases.mjs';
import { partnersJson } from './lib/pack-write.mjs';
import { matchByName } from './lib/rates/sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/data/partners.json');
const MAP = 'https://www.gencon.com/gen-con-indy/hotelmap';
const THREAD =
  'https://www.gencon.com/forums/43-travel-housing-and-dining-2019/topics/15787-hotel-costs';
const AGENT = 'gen-con-trip/0.1 (+https://github.com/LAHardman/Gen-Con)';

/** Gen Con's own headings, and what this calls them. */
const REGIONS = {
  'Downtown Campus': 'downtown',
  'West Side / Airport': 'airport',
  'East Side': 'east',
  'North Side': 'north',
  'South Side': 'south',
};

const get = async (url) => {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
};

const unescape = (text) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;|&#8211;/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A looser comparison than the OSM matcher, for two jobs that can afford it.
 *
 * Used to line the 2019 forum table up with today's block, and to spot walkable
 * hotels that are probably in the block but could not be tied to it strictly.
 * Neither job assigns a price to a building, so a false positive costs a growth
 * sample or one row of a comparison table rather than putting the wrong rate on
 * the wrong hotel.
 *
 * Two significant words in common, rather than containment: "Sheraton
 * Indianapolis City **Center**" and "Sheraton Indianapolis City **Centre**"
 * are one hotel spelled two ways, and neither string contains the other.
 */
function sameHotel(a, b, need = 2) {
  const words = (name) =>
    new Set(
      name
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ')
        .split(/\s+/)
        .filter(
          (word) =>
            word.length > 2 &&
            !/^(hotel|inn|suites|suite|the|by|at|of|and|marriott|wyndham|hilton|choice|ihg|hyatt|indianapolis|indy|downtown|hotels)$/.test(
              word,
            ),
        )
        // Centre and center are the same place, and Gen Con uses both.
        .map((word) => word.replace(/centre$/, 'center')),
    );
  let one = words(a);
  let two = words(b);
  /*
   * Some hotels are named entirely out of the words this strips.
   *
   * "Hotel Indy" is `hotel` and `indy`, both of which every hotel in this city
   * shares, so stripping them leaves nothing and the comparison silently says
   * "not the same hotel" — which put a block hotel on the page as an
   * alternative to the block. When either side empties, both sides fall back to
   * their full token sets, where "hotel indy" still sits inside "hotel indy
   * indianapolis a tribute portfolio hotel".
   */
  if (one.size === 0 || two.size === 0) {
    const all = (name) =>
      new Set(name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean));
    one = all(a);
    two = all(b);
    const shared = [...one].filter((word) => two.has(word)).length;
    return shared >= Math.min(one.size, two.size) && Math.min(one.size, two.size) >= 2;
  }
  const shared = [...one].filter((word) => two.has(word)).length;
  return shared >= need || (shared === 1 && one.size === 1 && two.size === 1);
}

/* ------------------------------------------------- Gen Con's published block */

/**
 * Read the block out of the table.
 *
 * Row by row rather than out of flattened text: the region headings are rows
 * too, and in a flat string there is nothing to say where "Downtown Campus"
 * stops applying and "West Side / Airport" begins.
 */
function readBlock(markup) {
  const rows = markup.match(/<tr>[\s\S]*?<\/tr>/gi) ?? [];
  const hotels = [];
  let region = null;

  for (const row of rows) {
    const heading = row.match(/<h3>\s*([^<]+?)\s*<\/h3>/i)?.[1];
    if (heading && REGIONS[unescape(heading)]) {
      region = REGIONS[unescape(heading)];
      continue;
    }
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
      unescape(cell[1].replace(/<[^>]+>/g, ' ')),
    );
    if (cells.length < 3 || !region) continue;

    const [name, rate, distance] = cells;
    // `$287 - $620`, `$254*`, `$289`. The asterisk is a footnote marker rather
    // than part of the number.
    const money = [...rate.matchAll(/\$\s?([\d,]+)/g)].map((one) =>
      Number(one[1].replace(/,/g, '')),
    );
    if (!name || money.length === 0) continue;

    hotels.push({
      blockName: name,
      low: money[0],
      // A single quoted rate is a single rate, not a range of width zero — the
      // page draws those differently and null is what says which.
      high: money.length > 1 ? money[money.length - 1] : null,
      region,
      skywalk: /skywalk/i.test(distance),
      distance: distance.replace(/\*+/g, '').trim(),
    });
  }
  return hotels;
}

/* ------------------------------------------- the 2019 table, for a growth rate */

function readHistory(markup) {
  const text = unescape(markup.replace(/<[^>]+>/g, ' '));
  const head = 'Hotel 2019 Incr. 2015 Incr. 2014';
  const at = text.indexOf(head);
  if (at < 0) return [];
  const table = text.slice(at + head.length, text.indexOf('Posted by', at + head.length));
  const row = /([A-Za-z&.,'’\- ]+?)\s*\$(\d+)\s+[\d.]+%\s+\$(\d+)(?:\s+[\d.]+%\s+\$(\d+))?/g;
  const out = [];
  let found;
  while ((found = row.exec(table))) out.push({ name: found[1].trim(), y2019: Number(found[2]) });
  return out;
}

/* --------------------------------------------------------------------- run it */

const [mapMarkup, forumMarkup] = await Promise.all([get(MAP), get(THREAD)]);

const year = Number(mapMarkup.match(/Gen Con (20\d\d)\s*-\s*Housing Block/i)?.[1]);
if (!year) throw new Error('cannot tell which year the block on that page is for');

const block = readBlock(mapMarkup);
if (block.length < 30) throw new Error(`only ${block.length} hotels parsed — the table has moved`);
console.error(`${block.length} hotels in the ${year} block`);
for (const [label, key] of Object.entries(REGIONS)) {
  console.error(`  ${label.padEnd(20)} ${block.filter((one) => one.region === key).length}`);
}

/*
 * How fast this block's own prices move.
 *
 * Median rather than mean, over the hotels in both tables: one hotel that
 * changed hands or rebuilt can double, and a mean lets it drag the projection
 * for everybody else.
 */
const history = readHistory(forumMarkup);
const spans = [];
for (const old of history) {
  const now = block.find((one) => sameHotel(one.blockName, old.name));
  if (!now) continue;
  spans.push({ name: old.name, rate: (now.low / old.y2019) ** (1 / (year - 2019)) - 1 });
}
spans.sort((a, b) => a.rate - b.rate);
const growth = spans.length ? spans[Math.floor(spans.length / 2)].rate : null;
console.error(
  `\n${spans.length} hotels in both tables; median annual change 2019→${year}: ` +
    (growth === null ? 'unknown' : `${(growth * 100).toFixed(2)}%`),
);

/* ------------------------------------------------ tie it to this app's hotels */

function readLodging() {
  const source = readFileSync(join(ROOT, 'src/data/lodging.ts'), 'utf8');
  const rows = [];
  const shape =
    /\{ id: '([^']+)', name: (".*?"), kind: '([^']+)', metres: (\d+), ring: '(walk|drive)'/g;
  let found;
  while ((found = shape.exec(source))) {
    rows.push({
      id: found[1],
      name: JSON.parse(found[2]),
      kind: found[3],
      metres: Number(found[4]),
      ring: found[5],
    });
  }
  if (rows.length === 0) throw new Error('no lodging — run scripts/fetch-lodging.mjs first');
  return rows;
}

/**
 * Gen Con's name for a hotel, as the matcher should see it.
 *
 * Gen Con writes "SpringHill Suites **by Marriott** Indianapolis Downtown" where
 * OpenStreetMap writes "SpringHill Suites Indianapolis Downtown". That "by
 * Marriott" is a franchise qualifier rather than a distinguishing word, and
 * leaving it in adds a significant word to one side and nothing to the other —
 * which the strict matcher then reads as a mismatch and refuses.
 *
 * The consequence was worse than a missing row: an unmatched block hotel is not
 * recognised as being in the block, so it becomes eligible as an "alternative
 * outside the block" and the page cheerfully compares two block hotels with each
 * other.
 */
const forMatching = (name) =>
  name.replace(/\bby (marriott|hilton|wyndham|choice|ihg|radisson|hyatt)\b/gi, ' ');

const places = readLodging();
const walk = places.filter((one) => one.ring === 'walk');

/*
 * The hand-written table first, and it has to still describe reality.
 *
 * A stale alias fails silently — the key stops matching a renamed hotel and the
 * tie simply stops being applied — so a table that no longer fits the page is
 * treated as a broken build rather than a warning nobody reads.
 */
const wrong = auditAliases(
  block.map((one) => one.blockName),
  places.map((one) => one.id),
);
if (wrong.length) {
  throw new Error(`scripts/lib/block-aliases.mjs is out of date:\n  ${wrong.join('\n  ')}`);
}

const taken = new Set();
let matched = 0;
let byHand = 0;

/*
 * Every checked answer is claimed before the matcher gets a turn.
 *
 * In one pass, an earlier hotel the matcher guesses at can take a building a
 * later hotel has a *checked* claim on, and the checked one then loses to the
 * guess. A hand-written answer outranks a guess whatever order the page is in.
 */
for (const hotel of block) {
  const tie = TIES[hotel.blockName];
  if (!tie) continue;
  // `null` is a real answer here — "looked, and this app has not got it".
  hotel.placeId = tie.placeId;
  if (tie.placeId) {
    taken.add(tie.placeId);
    matched += 1;
    byHand += 1;
  }
}

for (const hotel of block) {
  if (TIES[hotel.blockName]) continue;
  /*
   * Downtown entries are matched against the walk ring only.
   *
   * Every downtown block hotel is walkable, and the full inventory reaches
   * twenty-five kilometres out — four Fairfield Inns, three SpringHills, a
   * Staybridge in every suburb. Offering those as candidates makes half the
   * downtown block ambiguous, and the matcher then correctly refuses all of it.
   * Everything else is matched against the lot, because that is where it is.
   */
  const pool = hotel.region === 'downtown' ? walk : places;
  const place = matchByName(pool, forMatching(hotel.blockName));
  if (!place || taken.has(place.id)) {
    // A place already claimed is a false match by definition — one building
    // cannot be two hotels — so it is dropped rather than allowed to overwrite.
    hotel.placeId = null;
    continue;
  }
  taken.add(place.id);
  hotel.placeId = place.id;
  matched += 1;
}

console.error(
  `\n${matched} of ${block.length} tied to a hotel this app knows about ` +
    `(${byHand} by hand, ${matched - byHand} by name)`,
);

/*
 * The safety net, for hotels nobody has looked at yet.
 *
 * Matching is strict and will always leave some block hotels untied. Every one
 * of those is a hotel that must never be offered as an alternative *outside*
 * the block, so a looser name comparison records the suspicion separately. The
 * strict list decides what gets a price; this list only decides what is
 * excluded from the comparison, where being cautious costs little.
 *
 * "Little" was doing too much work: downtown has two hotels outside the block,
 * so every false positive here is a third of the comparison. A checked entry in
 * NOT_IN_BLOCK overrules the net, which is the point of having checked it.
 */
const suspected = walk
  .filter((place) => !taken.has(place.id))
  .filter((place) => !NOT_IN_BLOCK[place.id])
  /*
   * One distinctive word is enough *here*, unlike everywhere else.
   *
   * The generic words are already stripped, so anything left — "alexander",
   * "staybridge", "homewood" — identifies a hotel rather than a chain in a
   * city. Requiring two missed "The Alexander Hotel" against "The Alexander,
   * Autograph Collection", and the page then offered a block hotel as an
   * alternative *to* the block.
   *
   * The asymmetry is deliberate: a false positive here shortens a comparison
   * list that is already short, and a false negative states something untrue.
   */
  .filter((place) => block.some((one) => sameHotel(one.blockName, place.name, 1)))
  .map((place) => place.id);
if (suspected.length) {
  console.error(
    `\n${suspected.length} walkable hotels look like block entries but could not be tied.` +
      `\nEach one is a line missing from scripts/lib/block-aliases.mjs — either a TIES` +
      `\nentry naming the building, or a NOT_IN_BLOCK entry saying it is not one:`,
  );
  for (const id of suspected) {
    console.error(`  ${id.padEnd(17)} ${places.find((one) => one.id === id).name}`);
  }
}

/** Block hotels still without a building, which is the other half of the same job. */
const untied = block.filter((one) => !one.placeId && !TIES[one.blockName]);
if (untied.length) {
  console.error(`\n${untied.length} block hotels could not be tied to a building:`);
  for (const one of untied) console.error(`  ${one.region.padEnd(9)} ${one.blockName}`);
}

// The shared pack writer: one row per line, every field present, `null` kept
// where it is an answer ("no unambiguous building", "a single rate"). The
// prose that used to head the generated module lives in `partners.ts`, which
// is handwritten now and reads this JSON.
writeFileSync(OUT, partnersJson({ year, growth, partners: block, suspected }), 'utf8');
console.error(`\nwrote ${OUT}`);
