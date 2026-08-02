#!/usr/bin/env node
/**
 * Pulls the Gen Con event schedule into public/events.json.
 *
 *   npm run fetch:events                  # import everything
 *   npm run fetch:events -- --inspect     # report what the source looks like
 *   npm run fetch:events -- --limit 500   # stop after 500 event pages
 *
 * The app reads the generated file rather than calling the source site at
 * runtime: a browser can't fetch it cross-origin, and a local file keeps the
 * schedule working on convention Wi-Fi.
 *
 * How the source is laid out, and therefore how this crawls it:
 *
 *   index.php            links one category.php page per event type
 *   dayTimeList.php      the convention's days, with real dates
 *   categoryAll.php      every event in a category: title, code, day, time,
 *                        cost, tickets — but no location
 *   event.php            one event's full record, and the only page that says
 *                        where it happens
 *
 * So the catalogue pass is cheap (one request per event type) and the detail
 * pass is not (one request per event, ~27,000 of them for a full year). Detail
 * pages are cached in .cache/event-details.jsonl and the crawl is resumable, so
 * only the first run pays for them; use `--limit` to spread it over several.
 */

import { mkdir, writeFile, readFile, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import {
  FIELD_PATTERNS,
  findLargestTable,
  mapFields,
  parseCataloguePage,
  parseDayIndex,
  parseEventPage,
  readEventTypes,
  readFieldTable,
  readGameCodes,
} from './lib/parse-events.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'public/events.json');
const DEBUG_DIR = resolve(ROOT, '.cache');
const DETAIL_CACHE = resolve(DEBUG_DIR, 'event-details.jsonl');

const SOURCE = {
  name: 'Gen Con Event Database',
  url: 'https://gencon.eventdb.us/',
};

/**
 * Candidate endpoints for structured data, tried before falling back to HTML.
 * None of these responded when this was last run — the site is HTML only — but
 * probing costs six requests and would save the whole crawl if one appears.
 */
const STRUCTURED_CANDIDATES = [
  'events.json',
  'api/events',
  'api/events.php',
  'export.php?format=json',
  'export.php?format=csv',
  'data.php?format=json',
];

const USER_AGENT =
  'gen-con-trip/0.1 (personal trip planner; contact via repository) Node/' + process.versions.node;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};

const INSPECT = flag('inspect');
const NO_DETAILS = flag('no-details');
const DETAIL_LIMIT = Number(option('limit', String(Number.MAX_SAFE_INTEGER)));
const DELAY_MS = Number(option('delay', '150'));
const CONCURRENCY = Math.max(1, Number(option('concurrency', '4')));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function get(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
    redirect: 'follow',
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  return { ok: response.ok, status: response.status, contentType, body, url: response.url };
}

/** One retry pass, because a single dropped request shouldn't lose a crawl. */
async function getWithRetry(url, tries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response = await get(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < tries) await sleep(1000 * attempt);
  }
  throw lastError;
}

const absolute = (path) => new URL(path, SOURCE.url).toString();

/* ----------------------------------------------------------------- inspect */

async function inspect() {
  console.log(`Inspecting ${SOURCE.url}\n`);

  const root = await get(SOURCE.url);
  console.log(`GET ${SOURCE.url}`);
  console.log(`  status       ${root.status}`);
  console.log(`  content-type ${root.contentType}`);
  console.log(`  bytes        ${root.body.length}`);

  if (!root.ok) {
    console.log('\nThe source did not return a usable page; nothing further to inspect.');
    return;
  }

  await mkdir(DEBUG_DIR, { recursive: true });
  await writeFile(resolve(DEBUG_DIR, 'source-root.html'), root.body);
  console.log(`  saved        ${resolve(DEBUG_DIR, 'source-root.html')}`);

  const dom = parse(root.body);

  const tables = dom.querySelectorAll('table');
  console.log(`\nTables on the landing page: ${tables.length}`);
  console.log('  (the landing page is an index of categories, not a listing)');

  const types = readEventTypes(root.body);
  console.log(`\nEvent types linked: ${types.length}`);
  console.log(`  ${JSON.stringify(types)}`);

  console.log('\nProbing for structured data endpoints:');
  for (const candidate of STRUCTURED_CANDIDATES) {
    const url = absolute(candidate);
    try {
      const probe = await get(url);
      console.log(`  ${probe.status} ${probe.contentType.split(';')[0] || '?'}  ${url}`);
    } catch (error) {
      console.log(`  ---  ${url}  (${error.message})`);
    }
    await sleep(200);
  }

  const days = await get(absolute('dayTimeList.php'));
  const dayDates = parseDayIndex(days.body);
  console.log('\nConvention days, from dayTimeList.php:');
  for (const [weekday, date] of Object.entries(dayDates)) console.log(`  ${weekday.padEnd(10)} ${date}`);

  const sampleType = types[0];
  if (sampleType) {
    const url = absolute(`categoryAll.php?EventType=${sampleType}`);
    const page = await get(url);
    const { events, diagnostics } = parseCataloguePage(page.body, {
      baseUrl: page.url,
      eventType: sampleType,
      dayDates,
    });
    console.log(`\nCatalogue page ${url}`);
    console.log(`  ${JSON.stringify(diagnostics)}`);
    console.log(`  events extracted: ${events.length}`);
    if (events[0]) console.log(`  first: ${JSON.stringify(events[0])}`);

    const [code] = readGameCodes(page.body);
    if (code) {
      const eventUrl = absolute(`event.php?GameCode=${code}`);
      const eventPage = await get(eventUrl);
      const table = findLargestTable(parse(eventPage.body));
      const labels = table ? Object.keys(readFieldTable(table)) : [];

      console.log(`\nEvent page ${eventUrl}`);
      console.log(`  row labels (${labels.length}): ${JSON.stringify(labels)}`);
      console.log('\n  label -> field, as FIELD_PATTERNS resolves them:');
      const mapping = mapFields(labels);
      for (const [field] of FIELD_PATTERNS) {
        const label = mapping[field];
        console.log(`    ${field.padEnd(13)} ${label ? `"${label}"` : '— unmatched —'}`);
      }
      const unclaimed = labels.filter((label) => !Object.values(mapping).includes(label));
      if (unclaimed.length) console.log(`  labels no field claims: ${JSON.stringify(unclaimed)}`);

      const parsed = parseEventPage(eventPage.body, { dayDates });
      console.log(`\n  parsed: ${JSON.stringify(parsed.event, null, 2).replace(/\n/g, '\n  ')}`);
    }
  }
}

/* ------------------------------------------------------------------- import */

async function tryStructured() {
  for (const candidate of STRUCTURED_CANDIDATES) {
    const url = absolute(candidate);
    try {
      const response = await get(url);
      if (!response.ok || !response.contentType.includes('json')) continue;
      const data = JSON.parse(response.body);
      const events = Array.isArray(data) ? data : (data.events ?? data.data);
      if (Array.isArray(events) && events.length) {
        console.log(`Structured data found at ${url} (${events.length} records)`);
        return events;
      }
    } catch {
      // Candidate didn't pan out; move on.
    }
    await sleep(200);
  }
  return null;
}

/** One request per event type, collecting every session in the catalogue. */
async function crawlCatalogue(types, context) {
  const events = [];
  let lastDiagnostics = null;

  for (const type of types) {
    const url = absolute(`categoryAll.php?EventType=${type}`);
    const page = await getWithRetry(url);
    const parsed = parseCataloguePage(page.body, { ...context, baseUrl: page.url, eventType: type });
    lastDiagnostics = parsed.diagnostics;
    events.push(...parsed.events);
    console.log(`  ${type.padEnd(4)} ${String(parsed.events.length).padStart(6)} events`);
    await sleep(DELAY_MS);
  }

  return { events, diagnostics: lastDiagnostics };
}

/** Detail pages already fetched on an earlier run, keyed by game code. */
async function readDetailCache() {
  const cached = new Map();
  try {
    const text = await readFile(DETAIL_CACHE, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record.id) cached.set(record.id, record);
      } catch {
        // A half-written final line from an interrupted run; ignore it.
      }
    }
  } catch {
    // No cache yet.
  }
  return cached;
}

/**
 * Fetches the event pages that say where each event happens.
 * Runs a few requests at a time and pauses between them, and appends each
 * result to the cache as it lands so an interrupted run keeps its progress.
 */
async function crawlDetails(codes, context) {
  const cached = await readDetailCache();
  const pending = codes.filter((code) => !cached.has(code)).slice(0, DETAIL_LIMIT);

  if (cached.size) console.log(`  ${cached.size} already cached in ${DETAIL_CACHE}`);
  if (!pending.length) return cached;
  console.log(`  fetching ${pending.length} event pages (${CONCURRENCY} at a time)`);

  await mkdir(DEBUG_DIR, { recursive: true });
  let done = 0;
  let failed = 0;

  const worker = async (slice) => {
    for (const code of slice) {
      try {
        const page = await getWithRetry(absolute(`event.php?GameCode=${code}`));
        const { event } = parseEventPage(page.body, context);
        if (event) {
          const record = { ...event, id: code };
          cached.set(code, record);
          await appendFile(DETAIL_CACHE, `${JSON.stringify(record)}\n`);
        }
      } catch {
        failed += 1;
      }
      done += 1;
      if (done % 250 === 0) {
        console.log(`  ${done}/${pending.length} event pages (${failed} failed)`);
      }
      await sleep(DELAY_MS);
    }
  };

  const slices = Array.from({ length: CONCURRENCY }, (_, i) =>
    pending.filter((_, index) => index % CONCURRENCY === i),
  );
  await Promise.all(slices.map(worker));

  console.log(`  ${done} event pages fetched, ${failed} failed`);
  return cached;
}

/** Detail values win where they exist; the catalogue fills in the rest. */
function merge(catalogueEvent, detail) {
  if (!detail) return catalogueEvent;
  const merged = { ...catalogueEvent };
  for (const [key, value] of Object.entries(detail)) {
    if (value !== undefined && value !== null && value !== '') merged[key] = value;
  }
  return merged;
}

async function run() {
  console.log(`Importing events from ${SOURCE.url}\n`);

  const structured = await tryStructured();
  if (structured) {
    await writeFeed(structured, structured.length);
    return;
  }
  console.log('No structured endpoint responded; crawling the HTML pages.\n');

  const landing = await getWithRetry(SOURCE.url);
  const types = readEventTypes(landing.body);
  if (!types.length) {
    fail('The landing page linked no category.php?EventType=… pages.', null);
    return;
  }

  const days = await getWithRetry(absolute('dayTimeList.php'));
  const dayDates = parseDayIndex(days.body);
  const year = Number(Object.values(dayDates)[0]?.slice(0, 4)) || undefined;
  console.log(`Convention days: ${JSON.stringify(dayDates)}\n`);

  const context = { dayDates, year, baseUrl: SOURCE.url };

  console.log(`Catalogue (${types.length} event types):`);
  const { events, diagnostics } = await crawlCatalogue(types, context);
  console.log(`  ${events.length} events in the catalogue\n`);

  if (!events.length) {
    fail('The catalogue pages yielded no events.', diagnostics);
    return;
  }

  if (NO_DETAILS) {
    console.log('Skipping event pages (--no-details): events will have no location.\n');
    await writeFeed(events, events.length);
    return;
  }

  console.log('Event pages (the only place the location appears):');
  const details = await crawlDetails(
    events.map((event) => event.id),
    context,
  );

  const merged = events.map((event) => merge(event, details.get(event.id)));
  const located = merged.filter((event) => event.locationText).length;
  console.log(`\n  ${located} of ${merged.length} events have a location.`);
  if (located < merged.length) {
    console.log(`  Re-run to fetch the remaining ${merged.length - located}; the cache is kept.`);
  }

  await writeFeed(merged, events.length);
}

async function writeFeed(events, catalogueCount) {
  const usable = events.filter((event) => event && event.title && event.start);
  const dropped = catalogueCount - usable.length;

  if (usable.length === 0) {
    fail('No event had both a title and a parseable start time.', null);
    return;
  }

  const feed = {
    source: { ...SOURCE, fetchedAt: new Date().toISOString() },
    year: Number(usable[0].start.slice(0, 4)),
    events: usable,
  };

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(feed, null, 2)}\n`);

  console.log(`\nWrote ${usable.length} events to ${OUTPUT}`);
  if (dropped > 0) console.log(`Skipped ${dropped} with no title or no parseable start time.`);
  console.log('Reload the app to pick them up.');
}

function fail(reason, diagnostics) {
  console.error(`\nNo events could be imported: ${reason}`);
  if (diagnostics) console.error(`Parser diagnostics: ${JSON.stringify(diagnostics, null, 2)}`);
  console.error(
    '\nRun `npm run fetch:events -- --inspect` to see the page structure, then adjust\n' +
      'FIELD_PATTERNS in scripts/lib/parse-events.mjs to match the real row labels.',
  );
  process.exitCode = 1;
}

try {
  await (INSPECT ? inspect() : run());
} catch (error) {
  console.error(`\nImport failed: ${error.message}`);
  if (error.cause) console.error(`Cause: ${error.cause}`);
  process.exitCode = 1;
}
