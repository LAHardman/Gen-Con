/**
 * Who is at which booth, from Gen Con's own exhibitor browser.
 *
 *     node scripts/fetch-exhibitors.mjs
 *
 * Writes `src/data/exhibitors.ts`. One row per *location*, not per exhibitor:
 * Asmodee has four booths, a demo hall and a meeting room, and each of those is
 * a place somebody might be looking for.
 *
 *     https://www.gencon.com/api/v1/exhibitor_profiles?page=N&per_page=100
 *
 * The endpoint is public, unauthenticated and paginated, and it is what the
 * "Looking Glass" browser at `gencon.com/map` reads. Each location carries a
 * label Gen Con writes itself — `Exhibit Hall : Booth 1637`, `ICC : Rm 140`,
 * `Block Party : Food Truck 3` — which is kept verbatim, because the label is
 * the thing an attendee is told and paraphrasing it would only lose.
 *
 * WHAT IS DELIBERATELY NOT TAKEN, and it is the interesting part.
 *
 * Each location also has `lg` and `lt` in its `navigateTo` link: coordinates on
 * Gen Con's map. They are not longitude and latitude and they are not
 * convertible to them. That map is `L.CRS.Simple` over a tile pyramid at
 * `/lg/tiles/v1/`, and those tiles are **a star field** — the plan is vector
 * overlay, laid out area by area, each area revealed at its own zoom, with the
 * areas sitting beside one another rather than where the buildings are. So
 * there is no georeference to solve for, and three measurements say so:
 *
 *   - the exhibit-hall booths occupy `lt` -7.6..34.8 and the convention
 *     centre's rooms and halls `lt` -42..-5.6, adjacent bands rather than one
 *     building;
 *   - the booth cloud is 78.2 x 42.4 units, aspect 1.84, against 1.49 for the
 *     surveyed halls it would have to be;
 *   - fitted onto those halls in each of the eight ways a rectangle can be
 *     laid on one, the best puts 72% of booths inside a hall. A real plan of
 *     the same rooms would put all of them there.
 *
 * The coordinates *are* internally faithful — booths of one aisle share an `lg`
 * to within a unit, and the aisles step by 2.65 — so what is lost is only the
 * link to the ground, which is the whole of what a route needs. Which of Halls
 * A-K a booth number is in is therefore not in this source, and is not guessed
 * here.
 *
 * Source: Gen Con LLC.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/data/exhibitors.ts');

const API = 'https://www.gencon.com/api/v1/exhibitor_profiles';
const PER_PAGE = 100;

/**
 * The kinds whose own website is worth a request each.
 *
 * The listing carries names, places and tags; a *website* is only on the
 * per-exhibitor record, which is one request per exhibitor. 779 of those is a
 * three-minute run against somebody else's server for a field that matters to
 * one group: a food truck's own page is the nearest thing to a menu that
 * exists, and it is what replaces the Gen Con link for them. So the detail is
 * pulled for those 43 and nobody else.
 */
const DETAILED = new Set(['Food & Drink']);

/** Their server. Node's default user-agent is refused by some of these. */
const AGENT = 'gen-con-trip/0.1 (+https://github.com/LAHardman/Gen-Con)';

/** Between pages. Eight requests either way, but be a good guest. */
const PAUSE = 300;

/**
 * Far more pages than the eight this takes, and a stop rather than a guess.
 *
 * `totalPages` comes from the same response being paged through, so trusting it
 * blindly means a loop that a bad answer never ends. This is the backstop.
 */
const MAX_PAGES = 40;

async function page(n) {
  const url = `${API}?page=${n}&per_page=${PER_PAGE}`;
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.exhibitors)) throw new Error(`${url} had no exhibitors`);
  return body;
}

/**
 * The label, split into where and what.
 *
 * Gen Con writes these as parts separated by a spaced colon, coarsest first,
 * and the last part is the spot itself where there is one: `Exhibit Hall :
 * Booth 1637` is a booth in the exhibit hall, `ICC : Hall B : Archon Studio` is
 * a named space in Hall B. Where the last part is not a spot — `ICC : Rm 140` —
 * it is both, and saying so twice is better than dropping either.
 *
 * The separator is the *spaced* colon rather than any colon, because an
 * exhibitor may have one in its name: splitting `ICC : Hall E : Magic: the
 * Gathering` on every colon files Wizards of the Coast under "the Gathering".
 */
function split(label) {
  const parts = label.split(/\s+:\s+/).map((part) => part.trim()).filter(Boolean);
  const spot = parts.length > 1 ? parts[parts.length - 1] : label.trim();
  const area = parts.length > 1 ? parts.slice(0, -1).join(' : ') : label.trim();
  const number = spot.match(/^(?:Booth|Table|Food Truck)\s+#?\s*([0-9A-Za-z-]+)$/i);
  return { area, spot, booth: number ? number[1] : undefined };
}

async function main() {
  const rows = [];
  const seen = new Set();
  let total = null;

  for (let n = 1; n <= MAX_PAGES; n += 1) {
    const body = await page(n);
    total = body.meta?.totalPages ?? null;
    for (const exhibitor of body.exhibitors) {
      for (const location of exhibitor.locations ?? []) {
        if (!location.label) continue;
        const link = new URL(`https://www.gencon.com${location.navigateTo ?? '/'}`);
        const level = link.searchParams.get('f');
        const { area, spot, booth } = split(location.label);
        // The same exhibitor can be returned on two pages while the source is
        // being edited under us; the label is what makes a location a location.
        const key = `${exhibitor.name}|${location.label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          // Trimmed: at least one stand is registered as "Eerie Idol Games "
          // with the space, which sorts and matches as a different name.
          name: exhibitor.name.trim(),
          kind: (exhibitor.exhibitorType ?? 'Exhibitors').trim(),
          area,
          spot,
          booth,
          level: level === null || level === 'null' ? undefined : Number(level),
          // Gen Con's own id, which is what the app asks for a description with.
          id: typeof exhibitor.id === 'number' ? exhibitor.id : undefined,
          tags: (exhibitor.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean),
        });
      }
    }
    if (total !== null && n >= total) break;
    await new Promise((resolve) => setTimeout(resolve, PAUSE));
  }

  /*
   * The website, for the kinds that need one. See `DETAILED`.
   *
   * One request per exhibitor rather than per location, because a publisher
   * with four booths has one website and asking four times would be rude.
   */
  const websites = new Map();
  const wanted = [...new Set(rows.filter((row) => DETAILED.has(row.kind)).map((row) => row.id))].filter(
    (id) => id !== undefined,
  );
  console.log(`Reading ${wanted.length} exhibitor records for their websites...`);
  for (const id of wanted) {
    try {
      const response = await fetch(`${API}/${id}`, { headers: { 'User-Agent': AGENT } });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json();
      const link = body?.website?.navigateTo;
      // Only an absolute link off Gen Con's own site. A relative one is a page
      // on gencon.com, which is what this is meant to replace.
      if (typeof link === 'string' && /^https?:\/\//i.test(link)) websites.set(id, link.trim());
    } catch (error) {
      console.warn(`  ${id}: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, PAUSE));
  }
  for (const row of rows) row.website = websites.get(row.id);

  rows.sort((a, b) => a.name.localeCompare(b.name) || a.spot.localeCompare(b.spot));

  /*
   * Tags as indices into one list.
   *
   * 3,506 tag instances draw on 116 distinct words, and a row is a *location* —
   * so a publisher with six booths repeats its tags six times. Written out as
   * strings that is 47.8 KB; as indices into a shared list it is 12.3 KB, on a
   * file every visit downloads.
   */
  const vocabulary = [...new Set(rows.flatMap((row) => row.tags))].sort();
  const indexOfTag = new Map(vocabulary.map((tag, at) => [tag, at]));

  const quote = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const line = (row) =>
    `  { name: ${quote(row.name)}, kind: ${quote(row.kind)}, area: ${quote(row.area)}, spot: ${quote(row.spot)}` +
    (row.booth ? `, booth: ${quote(row.booth)}` : '') +
    (row.level === undefined || Number.isNaN(row.level) ? '' : `, level: ${row.level}`) +
    (row.id === undefined ? '' : `, id: ${row.id}`) +
    (row.tags.length ? `, tags: [${row.tags.map((tag) => indexOfTag.get(tag)).join(',')}]` : '') +
    (row.website ? `, website: ${quote(row.website)}` : '') +
    ' },';

  const areas = new Map();
  for (const row of rows) areas.set(row.area, (areas.get(row.area) ?? 0) + 1);

  const file = `/**
 * Who is at which booth. Generated by \`scripts/fetch-exhibitors.mjs\` — edit
 * that, not this.
 *
 * One row per location rather than per exhibitor: a publisher with four booths,
 * a demo hall and a meeting room is six places somebody might be looking for.
 *
 * \`area\` and \`spot\` are Gen Con's own words, split on the colons it writes
 * them with. What is NOT here is a position, and nothing in the source says
 * which of Exhibit Halls A-K a booth number is in — \`booths.ts\` decides that
 * from the number.
 *
 * The source *does* carry a position, which this deliberately drops. Each
 * location's \`navigateTo\` holds a coordinate on Gen Con's own interactive
 * map, and those are a real plan of the floor rather than the star field this
 * file used to claim: aisle number runs with one axis at r=0.977 and position
 * along an aisle with the other at r=0.950, and one similarity transform lays
 * all 569 of them on to the building to a median of 1.6 m against the placement
 * read off the printed map. They are left out because the printed map is the
 * better source — it gives every stand's footprint and the ones nobody has
 * taken, which this API has no way to express — but if that map is ever not
 * published, this is where the booths can come from instead.
 *
 * Source: Gen Con LLC.
 */

/**
 * Every word Gen Con files exhibitors under, once.
 *
 * These are its own vocabulary rather than anything worked out here: cuisines
 * and dishes for the food trucks, genres and trades for the halls. \`food.ts\`
 * is what decides which of them mean what.
 */
export const EXHIBITOR_TAGS: readonly string[] = [
${vocabulary.map((tag) => `  ${quote(tag)},`).join('\n')}
];

export interface Exhibitor {
  name: string;
  /** Gen Con's own grouping: Exhibitors, Artists, Authors, Food & Drink. */
  kind: string;
  /** Where, as written: 'Exhibit Hall', 'ICC : Hall B', 'Block Party'. */
  area: string;
  /** The spot within it: 'Booth 1637', 'Rm 140', 'Table Q'. */
  spot: string;
  /** Its number, where the spot is numbered. */
  booth?: string;
  /** The campus level Gen Con's map puts it on. */
  level?: number;
  /** Gen Con's own id, which its description is fetched by. */
  id?: number;
  /** Indices into \`EXHIBITOR_TAGS\` — see \`tagsOf\`. */
  tags?: number[];
  /** Their own site, where one is known. Only pulled for food and drink. */
  website?: string;
}

/** An exhibitor's tags as words. */
export function tagsOf(exhibitor: Exhibitor): string[] {
  return (exhibitor.tags ?? []).map((at) => EXHIBITOR_TAGS[at]).filter(Boolean);
}

export const EXHIBITORS: Exhibitor[] = [
${rows.map(line).join('\n')}
];
`;

  writeFileSync(OUT, file);
  const named = rows.filter((row) => row.booth).length;
  console.log(
    `${OUT}: ${rows.length} locations, ${new Set(rows.map((r) => r.name)).size} exhibitors, ` +
      `${named} numbered, ${Math.round(file.length / 1024)} KB`,
  );
  for (const [area, count] of [...areas].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${area}`);
  }
}

await main();
