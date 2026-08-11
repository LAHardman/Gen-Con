/**
 * What Gen Con's own hotel block used to cost.
 *
 *     node scripts/fetch-block-rates.mjs
 *
 * Regenerates `src/data/partners.ts` from a table posted on Gen Con's own
 * forums: 22 block hotels with their negotiated rate for 2014, 2015 and 2019.
 *
 * WHY THIS IS THE ONLY SOURCE THERE IS. Gen Con publishes no block rates
 * anywhere a program can read — the portal is behind a badge purchase and a
 * login, and it always has been. What exists instead is that somebody sat down
 * in 2019, typed the whole block into a forum post, and compared it with the
 * years before. That post is still there.
 *
 * ITS PROVENANCE IS EXACTLY AS GOOD AS THAT SOUNDS, and the app says so. It is
 * a forum post by an attendee, not a Gen Con publication; it is seven years
 * old; it covers the 2019 block, and the block has changed hands since — Gen
 * Con moved to Q-rooms for 2026 and the participating list will not be
 * identical. Every number derived from it is marked as an estimate and carries
 * its base year, so nobody has to take it on trust.
 *
 * WHAT IS *NOT* DONE HERE: projecting forward. The multiplier belongs with the
 * app, in `src/data/blocks.ts`, because it changes every year and the recorded
 * history does not. This file only writes down what was actually paid.
 *
 * Source: https://www.gencon.com/forums/43-travel-housing-and-dining-2019/topics/15787-hotel-costs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { matchByName } from './lib/rates/sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/data/partners.ts');
const THREAD =
  'https://www.gencon.com/forums/43-travel-housing-and-dining-2019/topics/15787-hotel-costs';

/** The same reader `fetch-rates.mjs` uses, and for the same reason. */
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

const strip = (markup) => {
  const body = markup.replace(/<(script|style|nav|footer|head)[\s\S]*?<\/\1>/gi, ' ');
  return body
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
};

const response = await fetch(THREAD, {
  headers: { 'User-Agent': 'gen-con-trip/0.1 (+https://github.com/LAHardman/Gen-Con)' },
});
if (!response.ok) throw new Error(`forum thread: HTTP ${response.status}`);
const text = strip(await response.text());

const HEAD = 'Hotel 2019 Incr. 2015 Incr. 2014';
const at = text.indexOf(HEAD);
if (at < 0) throw new Error('the rate table is no longer on that page in the shape expected');
const table = text.slice(at + HEAD.length, text.indexOf('Posted by', at + HEAD.length));

/** `Name $219 9.95% $201 3.08% $195`, with the 2014 pair optional. */
const ROW = /([A-Za-z&.,'’\- ]+?)\s*\$(\d+)\s+[\d.]+%\s+\$(\d+)(?:\s+[\d.]+%\s+\$(\d+))?/g;

/*
 * Matched against the walk ring only.
 *
 * Every hotel Gen Con has ever blocked is downtown, and the full inventory
 * reaches twenty-five kilometres out — which means four Fairfield Inns, three
 * SpringHill Suites and a Staybridge in every suburb. Offering those as
 * candidates makes half the block ambiguous and the strict matcher then
 * correctly refuses all of them. Narrowing to the walk ring is not a fudge to
 * get more matches: it is the actual population the block is drawn from.
 */
const places = readLodging().filter((one) => one.ring === 'walk');
const partners = [];
const unmatched = [];
let found;
while ((found = ROW.exec(table))) {
  const [, rawName, y2019, y2015, y2014] = found;
  const name = rawName.trim();
  // Matched against the OSM inventory by the same strict rule the rate sources
  // use: a missed match leaves a hotel off this list, a false one puts the
  // wrong block rate on the wrong building.
  const place = matchByName(places, name);
  if (!place) {
    unmatched.push(name);
    continue;
  }
  /*
   * One building, one block rate. Belt and braces over the matcher: if two
   * block entries ever land on the same place again, that is a false match
   * however confident the matcher was, and the run stops rather than writing a
   * file where one hotel has two prices.
   */
  const clash = partners.find((one) => one.placeId === place.id);
  if (clash) {
    throw new Error(
      `"${name}" and "${clash.blockName}" both matched ${place.name} — the matcher is too loose`,
    );
  }
  partners.push({
    placeId: place.id,
    blockName: name,
    osmName: place.name,
    y2014: y2014 ? Number(y2014) : null,
    y2015: Number(y2015),
    y2019: Number(y2019),
  });
}

console.error(`${partners.length} matched to the inventory`);
for (const one of partners) {
  console.error(`  ${one.blockName.padEnd(46)} -> ${one.osmName}`);
}
if (unmatched.length) {
  // Named rather than counted: each is a hotel the block had and this app
  // cannot show a block rate for, and somebody may want to know which.
  console.error(`\n${unmatched.length} in the block with no match in OpenStreetMap:`);
  for (const name of unmatched) console.error(`  ${name}`);
}
if (partners.length < 12) throw new Error('too few matched — the table or the matcher has moved');

const literal = (one) =>
  `  { placeId: '${one.placeId}', blockName: ${JSON.stringify(one.blockName)}, ` +
  `y2014: ${one.y2014 ?? 'null'}, y2015: ${one.y2015}, y2019: ${one.y2019} },`;

writeFileSync(
  OUT,
  `/**
 * Gen Con's own hotel block, and what it charged, generated by
 * \`scripts/fetch-block-rates.mjs\`.
 *
 * DO NOT EDIT BY HAND — re-run the script.
 *
 * THESE ARE REAL RATES AND THEY ARE OLD. They come from a table an attendee
 * posted on Gen Con's forums in 2019, listing the negotiated block rate for
 * each hotel in 2014, 2015 and 2019. Gen Con publishes block rates nowhere a
 * program can read them, so this is the only record there is.
 *
 * Treat it accordingly: a forum post rather than a Gen Con publication, seven
 * years old, describing the 2019 block. Gen Con moved its housing to Q-rooms
 * for 2026 and the participating list will not be identical to this one.
 * Anything projected from these numbers is an estimate and is drawn as one.
 *
 * Source: ${THREAD}
 */

export interface Partner {
  /** The id in \`lodging.ts\` — matched by name, strictly, on generation. */
  placeId: string;
  /** What Gen Con's block called it, which is not always what OSM calls it. */
  blockName: string;
  /** Block rate per night, USD. Null where that year was not in the table. */
  y2014: number | null;
  y2015: number;
  y2019: number;
}

/** The year the newest recorded rates belong to. */
export const BASE_YEAR = 2019;

/** Where these came from, printed on the page beside anything derived. */
export const SOURCE = '${THREAD}';

export const PARTNERS: ReadonlyArray<Partner> = [
${partners.map(literal).join('\n')}
];

const BY_PLACE = new Map(PARTNERS.map((one) => [one.placeId, one]));

/** Whether a place was in the 2019 block. */
export const isPartner = (placeId: string): boolean => BY_PLACE.has(placeId);

export const partnerFor = (placeId: string): Partner | null => BY_PLACE.get(placeId) ?? null;
`,
  'utf8',
);
console.error(`\nwrote ${OUT}`);
