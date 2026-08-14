/**
 * Ask what a room costs, within the month's free allowances.
 *
 *     node scripts/fetch-rates.mjs --dry          # plan only, no requests, no writes
 *     node scripts/fetch-rates.mjs --verify=serpapi   # exactly one request
 *     node scripts/fetch-rates.mjs --only=serpapi     # a real run, one source
 *     node scripts/fetch-rates.mjs
 *
 * With a key in a file rather than the shell, Node reads it for you:
 *
 *     node --env-file=.env scripts/fetch-rates.mjs --verify=serpapi
 *
 * Reads `src/data/rate-store.json`, spends what quota there is, writes it back.
 * The ledger of what has been spent lives in that same file, because a
 * repository is the only store this app has and adding a database for a counter
 * would be the largest dependency in the project.
 *
 * RUN `--dry` FIRST, AND AGAIN AFTER ANY SERVICE CHANGES ITS API. None of the
 * four request shapes in `sources.mjs` has ever been run against the live
 * service — every one of those hosts was unreachable from the machine this was
 * written on. A dry run prints who would be asked, in what order, and what it
 * would cost, without spending anything.
 *
 * CREDENTIALS come from the environment and none are required: a source with no
 * key takes itself out of the running, and the run proceeds with the rest. That
 * is the same path as a source being down, which is deliberate — there is only
 * one degraded mode to reason about, and it is exercised every time somebody
 * runs this without a key.
 *
 *   SERPAPI_KEY, AMADEUS_KEY + AMADEUS_SECRET, APIFY_TOKEN + APIFY_ACTOR
 *   RATES_QUOTA_<SOURCE>=n   correct an allowance
 *   RATES_OFF_<SOURCE>=1     switch one off
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { planRun } from './lib/rates/plan.mjs';
import { budget, ledgerFor, spend, SOURCES } from './lib/rates/quota.mjs';
import { runOnce } from './lib/rates/run.mjs';
import { ALL, conventionNights, nearbyStay } from './lib/rates/sources.mjs';
import { placesFromStrangers } from './lib/rates/strangers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = join(ROOT, 'src/data/rate-store.json');
const OUT = join(ROOT, 'src/data/rates.ts');
const LISTINGS_OUT = join(ROOT, 'src/data/listings.ts');

/** The convention centre's north-west corner, as `fetch-lodging.mjs` measures from. */
const ICC = { lat: 39.765683, lng: -86.166846 };
/** The drive ring, matching `DRIVE_METRES` in the generated lodging file. */
const DRIVE_M = 25_000;

const dry = process.argv.includes('--dry');
/** `--verify=serpapi`: one request, printed in full, nothing written. */
const verify = process.argv.find((one) => one.startsWith('--verify='))?.slice(9) ?? null;
/** `--only=serpapi`: a real run using one source, so a quota is spent on purpose. */
const only = process.argv.find((one) => one.startsWith('--only='))?.slice(7) ?? null;
const now = Date.now();
const env = process.env;

/**
 * Reading the inventory out of TypeScript without a compiler.
 *
 * Node cannot import a `.ts` module and this script must run under bare `node`
 * in a workflow, so the generated file is parsed rather than imported. That is
 * only safe because `fetch-lodging.mjs` writes it in exactly one shape — and it
 * throws rather than proceeding on an empty parse, so a change to that shape
 * stops the run instead of quietly pricing nothing.
 */
function readLodging() {
  const source = readFileSync(join(ROOT, 'src/data/lodging.ts'), 'utf8');
  const rows = [];
  const shape =
    /\{ id: '([^']+)', name: (".*?"), kind: '([^']+)', metres: (\d+), ring: '(walk|drive)', lat: ([-\d.]+), lng: ([-\d.]+)(.*?) \},/g;
  let found;
  while ((found = shape.exec(source))) {
    const [, id, name, kind, metres, ring, lat, lng, tail] = found;
    rows.push({
      id,
      name: JSON.parse(name),
      kind,
      metres: Number(metres),
      ring,
      lat: Number(lat),
      lng: Number(lng),
      brand: tail.match(/brand: (".*?")/)?.[1] ? JSON.parse(tail.match(/brand: (".*?")/)[1]) : '',
      stars: tail.match(/stars: '([^']*)'/)?.[1] ?? '',
      city: tail.match(/city: (".*?")/)?.[1] ? JSON.parse(tail.match(/city: (".*?")/)[1]) : '',
    });
  }
  if (rows.length === 0) throw new Error('no lodging parsed — run scripts/fetch-lodging.mjs first');
  return rows;
}

/**
 * The hotels Gen Con publishes a rate for, read out of the generated file.
 *
 * Never worth a request: Gen Con's own page is free, official, and better than
 * anything a rate API would sell. With the block covering two thirds of the
 * walk ring, this is the single biggest saving available.
 */
function readBlockIds() {
  const source = readFileSync(join(ROOT, 'src/data/partners.ts'), 'utf8');
  const ids = new Set([...source.matchAll(/placeId: '([^']+)'/g)].map((one) => one[1]));
  const suspected = source.match(/SUSPECTED_IN_BLOCK[^=]*= new Set\((\[[^\]]*\])\)/s)?.[1];
  if (suspected) for (const id of JSON.parse(suspected)) ids.add(id);
  return ids;
}

const places = readLodging();
const inBlock = readBlockIds();

let store = { quotes: [], ledger: null, keys: {} };
try {
  store = { ...store, ...JSON.parse(readFileSync(STORE, 'utf8')) };
} catch {
  console.error('no store yet — starting one');
}

/**
 * The stay being priced, and what happens when it moves.
 *
 * A quote is a price for a particular set of nights, so quotes gathered for a
 * different stay are not stale — they are answers to another question, and
 * `isFresh` would have kept every one of them and skipped the whole run. They
 * are dropped, once, when the stay changes.
 */
const ledger = ledgerFor(store.ledger, now);
const wanted = conventionNights(now);

/**
 * Whether anybody is actually selling those nights yet.
 *
 * One page, one unit, before the month's allowance is committed to a stay that
 * cannot be bought. Hotels open their calendars eleven to thirteen months out,
 * so for most of the year the next convention is not yet bookable — measured on
 * 2026-08-14, Gen Con 2027 returned twenty properties and two prices where a
 * night six weeks out returned two hundred and thirty.
 *
 * The fallback is a comparable Wednesday-to-Sunday near enough to be on sale,
 * and every price says which stay it is for, so the page can too. It is not a
 * convention rate and must never be printed as one.
 */
async function bookable(stay) {
  const source = ALL.find((one) => one.name === 'serpapi');
  if (!source?.ready(env)) return true;
  if (!spend(ledger, 'serpapi', 1, env)) return true;
  const seen = [];
  try {
    await source.quoteArea(
      places.filter((one) => !inBlock.has(one.id)),
      {
        env,
        whenMs: now,
        nights: stay,
        query: 'hotels near Indiana Convention Center Indianapolis',
        report: (one) => seen.push(one),
        charge: () => false,
      },
    );
  } catch {
    // A broken source is not evidence about the calendar. Let the run find out.
    return true;
  }
  const priced = seen.filter((one) => one.nightly).length;
  console.error(`  ${stay.in}: ${priced} of ${seen.length} on that page carry a price`);
  return priced >= 10;
}

const onSale = dry || verify ? true : await bookable(wanted);
const nights = onSale ? wanted : { ...nearbyStay(now), insteadOf: wanted };

if (!onSale) {
  console.error(
    `\nGen Con ${wanted.year} (${wanted.in}) is not on sale yet — hotels open their\n` +
      `calendars about a year out. Pricing ${nights.in} to ${nights.out} instead, which is\n` +
      `the same Wednesday-to-Sunday shape, and saying so on every price.`,
  );
}

if (store.nights && store.nights.in !== nights.in) {
  console.error(
    `\nthe stay moved: ${store.nights.in}→${store.nights.out} is now ${nights.in}→${nights.out}.` +
      `\n${store.quotes.length} quotes priced the old one and are being dropped.`,
  );
  store.quotes = [];
}
store.nights = nights;

const budgets = budget(ledger, env);

console.error(
  // Never "Gen Con 2026" for a stand-in week in October, which is what printing
  // the fallback's own year said and is a convention that does not exist.
  onSale
    ? `\npricing Gen Con ${nights.year}: ${nights.in} to ${nights.out}, Wednesday to Sunday`
    : `\npricing ${nights.in} to ${nights.out}, standing in for Gen Con ${wanted.year}`,
);

console.error(
  `\n${places.length} places (${places.filter((one) => one.ring === 'walk').length} walkable), ` +
    `${inBlock.size} of them published by Gen Con and never asked about`,
);
console.error(`month ${ledger.month}, allowances left:`);
for (const [name, left] of Object.entries(budgets)) {
  const source = ALL.find((one) => one.name === name);
  const why = !source?.ready(env) ? ' — not configured, will be skipped' : '';
  console.error(`  ${name.padEnd(8)} ${String(left).padStart(5)} ${SOURCES[name].unit}s${why}`);
}

if (dry) {
  const plan = planRun({
    places,
    quotes: store.quotes,
    budgets,
    whenMs: now,
    tried: ledger.tried,
    inBlock,
  });
  console.error(`\nwould ask about ${plan.tasks.length} — ${plan.reason}`);
  for (const task of plan.tasks.slice(0, 25)) {
    console.error(`  ${task.why.padEnd(16)} ${task.place.metres.toString().padStart(6)} m  ${task.place.name}`);
  }
  if (plan.tasks.length > 25) console.error(`  … and ${plan.tasks.length - 25} more`);
  console.error('\ndry run: nothing was requested and nothing was written');
  process.exit(0);
}

/*
 * One request, reported in full.
 *
 * The adapters were written from documentation against services this machine
 * cannot reach, so the first real call is the one that finds out whether they
 * are right. Doing that through a full run would spend a hundred requests
 * discovering the same thing a hundred times; this spends one and prints what
 * came back.
 */
if (verify) {
  const source = ALL.find((one) => one.name === verify);
  if (!source) {
    console.error(`no such source: ${verify}. Try ${ALL.map((one) => one.name).join(', ')}.`);
    process.exit(2);
  }
  if (!source.ready(env)) {
    console.error(`${verify} is not configured — see the header of this file for which variables it wants.`);
    process.exit(2);
  }

  const asking = places.filter((one) => !inBlock.has(one.id));

  /*
   * A per-place source can only be verified against a hotel it can name.
   *
   * Without this, `--verify=xotelo` picked the first hotel on the list, got a
   * null back before any request was made, and reported "It answered and
   * returned nothing usable" and "one request was spent" — a source that had
   * never been asked anything, described as answering.
   */
  if (!source.quoteArea && source.canAsk) {
    const first = asking.find((one) => source.canAsk(one, { env, keys: store.keys }));
    if (!first) {
      console.error(
        `${verify} has nothing to ask about: none of the ${asking.length} hotels has what it\n` +
          'needs to name one. For xotelo that is a TripAdvisor key — run\n' +
          '`node scripts/resolve-hotel-keys.mjs` first. No request was made.',
      );
      process.exit(2);
    }
    asking.splice(0, asking.indexOf(first));
  }

  const group = source.areas ? source.areas(asking)[0] : { places: asking, label: 'everywhere' };
  console.error(
    `\nasking ${verify} for "${group.query ?? group.label}" ` +
      `— ${group.places.length} of our hotels are in that group…\n`,
  );

  /*
   * Everything the service returned, matched or not.
   *
   * The interesting failure here is not an error. It is twenty hotels coming
   * back and two of them matching, which is a name-matching problem and looks
   * exactly like a thin response unless both halves are printed.
   */
  const seen = [];
  try {
    const rows = source.quoteArea
      ? await source.quoteArea(group.places, {
          env,
          whenMs: now,
          nights,
          query: group.query,
          keys: store.keys,
          report: (one) => seen.push(one),
          /*
           * One page, which is what "one request" means.
           *
           * Refusing the charge is how a paging source is told to stop, and
           * without it this walked to its twelve-page cap and spent twelve of
           * the month's hundred searches while printing "one request was
           * spent". A verification that quietly costs twelve is not one.
           */
          charge: () => false,
        })
      : [await source.quote(group.places[0], { env, whenMs: now, nights, keys: store.keys })].filter(Boolean);

    const matched = seen.filter((one) => one.matched);
    if (seen.length > 0) {
      console.error(`  matched ${matched.length} of the ${seen.length} it returned:\n`);
      for (const one of matched) {
        console.error(`    ${String(one.nightly).padStart(6)}  ${one.matched}  [by ${one.how}]`);
        if (one.matched !== one.name) console.error(`            they call it: ${one.name}`);
      }

      /*
       * Sorting the misses into the two that mean different things.
       *
       * Most of what a downtown search returns is Gen Con's block, which was
       * deliberately not offered to the matcher — reporting those as "we could
       * not place it" reads as a fault and is the opposite of one. What is left
       * is the real list worth acting on.
       */
      const blockNames = new Set(
        readFileSync(join(ROOT, 'src/data/partners.ts'), 'utf8')
          .match(/blockName: "(?:[^"]*)"/g)
          ?.map((one) => one.slice(12, -1).toLowerCase()) ?? [],
      );
      const looksBlock = (name) => {
        const key = name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
        return [...blockNames].some((one) => {
          const theirs = new Set(one.replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 3));
          const mine = new Set(key.split(/\s+/).filter((w) => w.length > 3));
          const shared = [...theirs].filter((w) => mine.has(w)).length;
          return shared >= Math.min(theirs.size, mine.size) && shared >= 2;
        });
      };

      const missed = seen.filter((one) => !one.matched);
      const expected = missed.filter((one) => looksBlock(one.name));
      const real = missed.filter((one) => !looksBlock(one.name));

      if (expected.length > 0) {
        console.error(
          `\n  ${expected.length} it returned are Gen Con's own block hotels, which were`,
        );
        console.error("  never offered to the matcher. That is the design, not a miss.");
      }
      if (real.length > 0) {
        console.error(`\n  ${real.length} it returned that we genuinely could not place:\n`);
        for (const one of real.slice(0, 30)) {
          console.error(`    ${String(one.nightly ?? '-').padStart(6)}  ${one.name}`);
        }
        console.error(
          '\n  Each of those with a price is either a hotel we do not have, or one',
        );
        console.error('  we have under a name the matcher will not accept.');
      }
    } else {
      for (const row of rows) {
        const place = places.find((one) => one.id === row.placeId);
        console.error(`    ${String(row.nightly).padStart(6)}  ${place?.name ?? row.placeId}`);
      }
      if (rows.length === 0) console.error('  It answered and returned nothing usable.');
    }
    console.error(`\n${verify} works. One page was asked for; nothing was written.`);
  } catch (error) {
    console.error(`${verify} failed: ${error.message}`);
    console.error('\nThat message comes from the adapter, which refuses to guess at an');
    console.error('unfamiliar response rather than reporting it as "no price".');
    process.exit(1);
  }
  process.exit(0);
}

const chosen = only ? ALL.filter((one) => one.name === only) : ALL;
if (only && chosen.length === 0) {
  console.error(`no such source: ${only}`);
  process.exit(2);
}

/** Everything the searches returned that none of our hotels claimed. */
const strangers = [];

const result = await runOnce({
  places,
  quotes: store.quotes,
  ledger,
  keys: store.keys,
  env,
  whenMs: now,
  nights,
  inBlock,
  sources: chosen,
  sawStranger: (one) => strangers.push(one),
  log: (line) => console.error(line),
});

writeFileSync(
  STORE,
  `${JSON.stringify({ quotes: result.quotes, ledger: result.ledger, keys: store.keys, nights }, null, 1)}\n`,
  'utf8',
);

/*
 * Everywhere else somebody could sleep, which the search knows about and the
 * survey does not. See `lib/rates/strangers.mjs` for why it is its own file.
 */
if (strangers.length > 0) {
  const { places: extra, why } = placesFromStrangers({
    strangers,
    known: places,
    hall: ICC,
    driveMetres: DRIVE_M,
  });
  console.error(
    `\n${strangers.length} priced places no hotel of ours claimed → ${extra.length} kept` +
      ` (${why.alreadyKnown} already listed, ${why.sameDoor} behind one door,` +
      ` ${why.cheaper} the same listing again, ${why.tooFar} too far)`,
  );

  writeFileSync(
    LISTINGS_OUT,
    `/**
 * Somewhere to sleep that nobody surveyed. GENERATED — do not edit.
 *
 * Run 'node scripts/fetch-rates.mjs' to rebuild this.
 *
 * A search for hotels near the hall answers with more than hotels: flats,
 * condos and lofts let by the night, which for a convention where four people
 * share a room is often the cheapest way to sleep within walking distance. It
 * also answers with hotels the OpenStreetMap pull missed. Both are here.
 *
 * **This is not 'lodging.ts' and must not be merged into it.** That file is a
 * survey under ODbL: somebody stood there. Every row here is a booking product
 * — one listing, which may be one flat in a block of forty, may be gone next
 * week, and may be the same address as the row beside it under another name.
 * The rules in 'scripts/lib/rates/strangers.mjs' refuse the duplicates they
 * can prove and keep the rest; they cannot prove all of them.
 *
 * Prices are for Gen Con ${nights.year}, ${nights.in} to ${nights.out}.
 */

export interface Listing {
  /** Prefixed 'serp:' so it can never be read as an OpenStreetMap id. */
  id: string;
  name: string;
  /** hotel, motel, hostel, or rental — somebody's flat rather than a front desk. */
  kind: string;
  /** Straight-line metres from the convention centre. */
  metres: number;
  ring: 'walk' | 'drive';
  lat: number;
  lng: number;
  /** Per night, for the convention stay above. */
  nightly: number;
  city?: string;
}

/** When these were gathered. */
export const FOUND = '${new Date(now).toISOString().slice(0, 10)}';

/** Nearest first. */
export const LISTINGS: ReadonlyArray<Listing> = [
${extra
  .map(
    (one) =>
      `  { id: '${one.id}', name: ${JSON.stringify(one.name)}, kind: '${one.kind}',` +
      ` metres: ${one.metres}, ring: '${one.ring}', lat: ${one.lat}, lng: ${one.lng},` +
      ` nightly: ${one.nightly}${one.city ? `, city: ${JSON.stringify(one.city)}` : ''} },`,
  )
  .join('\n')}
];
`,
    'utf8',
  );
  console.error(`wrote ${LISTINGS_OUT}`);
}

/*
 * The app reads a generated module rather than the JSON, for the same reason
 * every other dataset here is a module: it is type-checked, it is in the bundle,
 * and it works with no network on a convention floor.
 */
const byPlace = new Map();
for (const quote of result.quotes) {
  if (!byPlace.has(quote.placeId)) byPlace.set(quote.placeId, []);
  byPlace.get(quote.placeId).push(quote);
}

const rows = [...byPlace.entries()]
  .map(([placeId, quotes]) => {
    const cheapest = quotes.reduce((low, one) => (one.nightly < low.nightly ? one : low));
    const newest = quotes.reduce((late, one) => (Date.parse(one.at) > Date.parse(late.at) ? one : late));
    return {
      placeId,
      nightly: cheapest.nightly,
      currency: cheapest.currency ?? 'USD',
      sources: [...new Set(quotes.map((one) => one.source))].sort(),
      at: newest.at.slice(0, 10),
      spread:
        quotes.length > 1
          ? Math.round(Math.max(...quotes.map((one) => one.nightly)) - cheapest.nightly)
          : 0,
    };
  })
  .sort((a, b) => a.nightly - b.nightly);

writeFileSync(
  OUT,
  `/**
 * What a room costs, generated by \`scripts/fetch-rates.mjs\`.
 *
 * DO NOT EDIT BY HAND — re-run the script.
 *
 * One row per place, carrying the **cheapest** quote anybody had and the date of
 * the newest. \`sources\` is who was asked, because a price is worth as much as
 * its provenance, and \`spread\` is the gap between the dearest and cheapest
 * quotes for the same place — the honest width of the number.
 *
 * These are indicative nightly rates for a sample night, gathered on free tiers
 * of commercial services. **They are not the Gen Con block rate**, which is
 * behind a badge purchase and a login and cannot be fetched at all.
 */

export interface Rate {
  placeId: string;
  /** The cheapest anybody quoted, per night. */
  nightly: number;
  currency: string;
  /** Who answered. More than one is a stronger number than one. */
  sources: string[];
  /** The newest quote's date, so the page can say how old this is. */
  at: string;
  /** Dearest minus cheapest across sources. Zero when only one answered. */
  spread: number;
}

/** When this file was last written, whether or not anything changed. */
export const REFRESHED = '${new Date(now).toISOString().slice(0, 10)}';

/**
 * The nights these prices are for, and whether they are the convention's own.
 *
 * Hotels open their calendars about a year out, so for most of the year the
 * next Gen Con cannot be booked at all and there is nothing to gather. When
 * that is the case this holds a comparable Wednesday-to-Sunday that *is* on
 * sale, and \`isConvention\` is false — the page says so rather than letting a
 * quiet week's rate pass for a convention one, which it is not and is cheaper
 * than.
 */
export interface Stay {
  /** Check-in and check-out, ISO. */
  in: string;
  out: string;
  /** Whether these really are the convention's nights, or a stand-in for them. */
  isConvention: boolean;
  conventionYear: number;
  conventionFrom: string;
}

export const STAY: Stay = {
  in: '${nights.in}',
  out: '${nights.out}',
  isConvention: ${onSale},
  /** The convention these stand in for, when they are standing in. */
  conventionYear: ${wanted.year},
  conventionFrom: '${wanted.in}',
};

/** The cheapest walkable rate — the cap the drive ring was gathered under. */
export const WALK_FLOOR: number | null = ${result.floor ?? 'null'};

/** Cheapest first. */
export const RATES: ReadonlyArray<Rate> = [
${rows
  .map(
    (row) =>
      `  { placeId: '${row.placeId}', nightly: ${row.nightly}, currency: '${row.currency}',` +
      ` sources: [${row.sources.map((one) => `'${one}'`).join(', ')}],` +
      ` at: '${row.at}', spread: ${row.spread} },`,
  )
  .join('\n')}
];

const BY_PLACE = new Map(RATES.map((rate) => [rate.placeId, rate]));

export const rateFor = (placeId: string): Rate | null => BY_PLACE.get(placeId) ?? null;
`,
  'utf8',
);

console.error(`\nwrote ${rows.length} rates to ${OUT}`);
if (Object.keys(result.down).length) {
  console.error(`down this run: ${Object.entries(result.down).map(([n, why]) => `${n} (${why})`).join(', ')}`);
}
