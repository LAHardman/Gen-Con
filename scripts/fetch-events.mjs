#!/usr/bin/env node
/**
 * Pulls the Gen Con event schedule into public/events.json.
 *
 *   npm run fetch:events                  # import, reusing what's cached
 *   npm run fetch:events -- --full        # ignore the cache and re-pull it all
 *   npm run fetch:events -- --inspect     # report what the source looks like
 *   npm run fetch:events -- --limit 500   # stop after 500 event pages
 *
 * The app reads the generated file rather than calling the source site at
 * runtime: a browser can't fetch it cross-origin, and a local file keeps the
 * schedule working on convention Wi-Fi.
 *
 * How the source is laid out, and therefore how this crawls it:
 *
 *   changeList.php       when the database was last rebuilt, and an index of
 *                        every change set since it started
 *   changes.php          one change set: the events added, deleted, or with
 *                        tickets back on sale
 *   index.php            links one category.php page per event type
 *   dayTimeList.php      the convention's days, with real dates
 *   categoryAll.php      every event in a category: title, code, day, time,
 *                        cost, tickets — but no location
 *   event.php            one event's full record, and the only page that says
 *                        where it happens
 *
 * So the catalogue pass is cheap (one request per event type) and the detail
 * pass is not (one request per event, ~27,000 of them for a full year). Only
 * the first run should pay for that, so this keeps two things in .cache/:
 *
 *   event-details.jsonl  every event record pulled, and when it was pulled
 *   import-state.json    the watermark that says what has changed since
 *
 * A later run reads changeList.php first. The whole site is rebuilt from one
 * spreadsheet, and that page prints when it was last processed; while that
 * timestamp hasn't moved, nothing on the site has, and the run stops there
 * having made a single request. When it has moved, the change sets published
 * since the last run name the events affected, and only those are re-pulled.
 *
 * Use `--full` to ignore all of that and re-pull every page.
 */

import { mkdir, writeFile, readFile, appendFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import {
  FIELD_PATTERNS,
  findLargestTable,
  mapFields,
  parseCataloguePage,
  parseChangeList,
  parseChangeSet,
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
const STATE_FILE = resolve(DEBUG_DIR, 'import-state.json');
const LOCK_FILE = resolve(DEBUG_DIR, 'import.lock');
const FULL_PULL_FILE = resolve(DEBUG_DIR, 'full-pull.json');
const STATE_VERSION = 1;

/**
 * How long a cache may go without a full re-pull.
 *
 * A change set only records events added, deleted, or with tickets back on
 * sale. The source says so itself: it lists a set only "when at least one of
 * the three criteria above is met", so a title, date, description — or room —
 * edit changes the data without appearing in one. Following change sets alone
 * would let a room move go unnoticed indefinitely, so a full pass falls due
 * anyway on this cadence.
 */
const FULL_REFRESH_DAYS = 7;

/**
 * Past this many unseen change sets, reading them all costs more requests than
 * the re-pull they were meant to avoid.
 */
const MAX_CHANGE_SETS = 40;

/** Sweeps over the event pages that failed, before giving up on them. */
const DETAIL_SWEEPS = 4;

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
const FULL = flag('full');
const NO_DETAILS = flag('no-details');
const DETAIL_LIMIT = Number(option('limit', String(Number.MAX_SAFE_INTEGER)));
/** A capped run reads part of the source, so it can't stand in for a full one. */
const DETAIL_LIMITED = DETAIL_LIMIT !== Number.MAX_SAFE_INTEGER;
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

/**
 * Fetches with backoff, because a crawl this long will hit transient failures
 * whatever the network is like — a dropped connection, a DNS blip, or the
 * source shedding load — and one of them must not cost the run.
 *
 * Retries anything that might succeed later: a network error, a 429, or a 5xx.
 * A 4xx means the page genuinely isn't there, so it fails immediately rather
 * than knocking four more times. Waits grow exponentially with a little jitter,
 * so a pool of workers that all fail at once doesn't march back in step.
 */
async function getWithRetry(url, tries = 5) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response = await get(url);
      if (response.ok) return response;
      if (response.status < 500 && response.status !== 429) {
        throw new Error(`HTTP ${response.status}`);
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (/^HTTP 4/.test(error.message)) throw error;
      lastError = error;
    }
    if (attempt < tries) await sleep(500 * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
  }
  throw lastError;
}

/* --------------------------------------------------------------------- lock */

/**
 * Stops two imports running at once.
 *
 * Both would append to the same cache, and because the cache is what decides
 * which pages still need fetching, both would decide the same ones do: a
 * second run doubles the requests made of somebody's hobby server and gains
 * nothing. Easy to do by accident — a weekly job and a local run overlapping,
 * or a backgrounded crawl that outlived the shell that started it.
 *
 * The lock records a pid, so a crash leaves one that can be recognised as
 * stale rather than blocking every later run.
 */
async function takeLock() {
  try {
    const held = JSON.parse(await readFile(LOCK_FILE, 'utf8'));
    let alive = false;
    try {
      process.kill(held.pid, 0);
      alive = true;
    } catch {
      // No such process; the lock outlived whatever wrote it.
    }
    if (alive && held.pid !== process.pid) {
      console.error(`Another import (pid ${held.pid}) started at ${held.startedAt} is still running.`);
      console.error(`Wait for it, or remove ${LOCK_FILE} if you know it is gone.`);
      return false;
    }
    console.log(`Clearing a stale lock from pid ${held.pid}.`);
  } catch {
    // No lock, or an unreadable one; either way it's ours to take.
  }
  await mkdir(DEBUG_DIR, { recursive: true });
  await writeFile(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return true;
}

async function releaseLock() {
  try {
    const held = JSON.parse(await readFile(LOCK_FILE, 'utf8'));
    if (held.pid === process.pid) await rm(LOCK_FILE, { force: true });
  } catch {
    // Already gone.
  }
}

/* -------------------------------------------------------------- cache state */

/** The watermark from the last run: what the source looked like when it ended. */
async function readState() {
  try {
    const state = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    return state.version === STATE_VERSION ? state : null;
  } catch {
    return null;
  }
}

async function writeState(state) {
  await mkdir(DEBUG_DIR, { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify({ version: STATE_VERSION, ...state }, null, 2)}\n`);
}

/* ------------------------------------------------------- an unfinished pull */

/**
 * When the full pull now in progress began.
 *
 * A full pull of this source is 27,000 requests and the better part of a
 * morning, and the watermark that records one is only written when it finishes.
 * So an interrupted full pull used to leave the worst of both: a cache holding
 * every page it did fetch, and nothing to say those pages belonged to a pull
 * still in progress. The next run read no watermark, concluded it had to pull
 * everything, and — because a full pull may not trust what it already holds —
 * threw all of them away and asked for them again. Interrupt that one too and
 * it never finishes, however many times it is run.
 *
 * This file is the missing half. While it exists a full pull is unfinished, and
 * a record fetched since it was written is one this same pull has already
 * refreshed and needn't fetch twice.
 */
async function readFullPull() {
  try {
    const held = JSON.parse(await readFile(FULL_PULL_FILE, 'utf8'));
    return Number.isNaN(Date.parse(held.startedAt)) ? null : held.startedAt;
  } catch {
    return null;
  }
}

async function beginFullPull(startedAt) {
  await mkdir(DEBUG_DIR, { recursive: true });
  await writeFile(FULL_PULL_FILE, `${JSON.stringify({ version: 1, startedAt }, null, 2)}\n`);
  return startedAt;
}

const endFullPull = () => rm(FULL_PULL_FILE, { force: true });

/**
 * The oldest record in the cache, for a pull interrupted before the file above
 * existed: a cache with records in it and no watermark can only have come from
 * a full pull that never finished, so its own records date it.
 */
async function earliestPullAt() {
  let earliest = null;
  for (const record of (await readDetailCache()).values()) {
    if (typeof record.pulledAt !== 'string') continue;
    if (!earliest || record.pulledAt < earliest) earliest = record.pulledAt;
  }
  return earliest;
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

/**
 * Every event record pulled so far, keyed by game code, each carrying the
 * `pulledAt` of the run that read it.
 *
 * The file is appended to rather than rewritten as a crawl proceeds, so a code
 * re-pulled after a change set appears twice. Reading in order and letting the
 * later line win is what makes that safe.
 */
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
 *
 * Runs a few requests at a time and pauses between them, and appends each
 * result to the cache as it lands so an interrupted run keeps its progress.
 *
 * Anything that fails is swept up and tried again rather than left behind: a
 * first run is 27,000 requests, and at even a very low failure rate that is
 * hundreds of events with no location. Each sweep re-attempts only what the
 * one before it missed, waiting longer each time, so a source having a bad
 * minute costs a pause rather than the run.
 */
async function crawlDetails(
  codes,
  context,
  { invalidate = new Set(), drop = new Set(), refresh = false, refreshedSince = null } = {},
) {
  const cached = await readDetailCache();
  const held = cached.size;

  if (refresh) {
    // A full pull exists to catch the edits change sets never mention, so it
    // has to ignore what it already holds rather than trust any of it — but
    // only what it held when this pull started. Anything fetched since is a
    // page this same pull has already refreshed, and dropping those is what
    // stopped an interrupted full pull from ever finishing.
    let kept = 0;
    for (const [code, record] of cached) {
      if (refreshedSince && record.pulledAt >= refreshedSince) kept += 1;
      else cached.delete(code);
    }
    if (held - kept) console.log(`  ignoring ${held - kept} cached records; this is a full pull`);
    if (kept) console.log(`  ${kept} of them were pulled by this same full pull, so they stand`);
  } else {
    let dropped = 0;
    for (const code of drop) if (cached.delete(code)) dropped += 1;
    // Re-pull rather than trust: the source has published a change touching these.
    let stale = 0;
    for (const code of invalidate) if (cached.delete(code)) stale += 1;

    if (held) console.log(`  ${held} already cached in ${DETAIL_CACHE}`);
    if (stale) console.log(`  ${stale} superseded by a change set, so re-pulling`);
    if (dropped) console.log(`  ${dropped} deleted upstream, dropped from the cache`);
  }

  let pending = codes.filter((code) => !cached.has(code)).slice(0, DETAIL_LIMIT);
  if (!pending.length) return { cached, failed: [] };

  await mkdir(DEBUG_DIR, { recursive: true });
  const total = pending.length;
  console.log(`  fetching ${total} event pages (${CONCURRENCY} at a time)`);

  let done = 0;
  // Pages that answered but held no readable record. Retrying fetches the same
  // bytes, so they aren't failures — but they are events that will reach the
  // feed with no location, and saying nothing about them is how 2,661 of them
  // once went missing without a word in the log.
  let unreadable = 0;
  for (let sweep = 1; sweep <= DETAIL_SWEEPS && pending.length; sweep += 1) {
    if (sweep > 1) {
      console.log(`  sweep ${sweep}: retrying ${pending.length} that failed`);
      await sleep(2000 * 2 ** (sweep - 2));
    }
    const failed = [];

    const worker = async (slice) => {
      for (const code of slice) {
        try {
          const page = await getWithRetry(absolute(`event.php?GameCode=${code}`));
          const { event } = parseEventPage(page.body, context);
          if (event) {
            const record = { ...event, id: code, pulledAt: new Date().toISOString() };
            cached.set(code, record);
            await appendFile(DETAIL_CACHE, `${JSON.stringify(record)}\n`);
          } else {
            unreadable += 1;
          }
        } catch {
          failed.push(code);
        }
        done += 1;
        if (done % 250 === 0) console.log(`  ${done}/${total} event pages`);
        await sleep(DELAY_MS);
      }
    };

    const slices = Array.from({ length: CONCURRENCY }, (_, i) =>
      pending.filter((_, index) => index % CONCURRENCY === i),
    );
    await Promise.all(slices.map(worker));
    pending = failed;
  }

  console.log(`  ${cached.size} event pages cached, ${pending.length} still failing`);
  if (unreadable) {
    console.log(`  ${unreadable} page(s) came back but held no readable record — those events`);
    console.log('  will have no location. Run --inspect to see what the page looks like now.');
  }
  return { cached, failed: pending };
}

/**
 * Rewrites the append-only cache as one record per event.
 *
 * Appending is what makes an interrupted run keep its progress, but it means a
 * re-pulled event leaves its old line behind. Reading takes the last line for
 * an id, so the stale ones are harmless — they just accumulate.
 */
async function compactDetailCache(cached) {
  if (!cached.size) return;
  const lines = [...cached.values()].map((record) => JSON.stringify(record));
  await writeFile(DETAIL_CACHE, `${lines.join('\n')}\n`);
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

/**
 * Works out how much of the source has to be re-read, from its own record of
 * what it has changed.
 *
 * Returns `null` when there is nothing to do at all, and otherwise the set of
 * events to re-pull and the set to forget.
 */
async function planWork(state) {
  const page = await getWithRetry(absolute('changeList.php'));
  const changes = parseChangeList(page.body);
  const latest = changes.sets[0]?.id ?? null;
  console.log(`Source last rebuilt: ${changes.csvProcessedAt ?? 'unknown'} (change set ${latest ?? '?'})`);

  if (FULL) {
    console.log('  --full: re-pulling every event page.\n');
    return { changes, latest, invalidate: new Set(), drop: new Set(), full: true };
  }
  if (!state) {
    console.log('  No cache state yet, so this is a full pull.\n');
    return { changes, latest, invalidate: new Set(), drop: new Set(), full: true };
  }

  // Everything on the site comes from one spreadsheet. While the timestamp on
  // it hasn't moved, neither has any value the crawl would read.
  if (changes.csvProcessedAt && changes.csvProcessedAt === state.csvProcessedAt) {
    console.log(`  Unchanged since the last pull at ${state.lastPullAt}.\n`);
    return null;
  }

  const lastFull = Date.parse(state.lastFullPullAt ?? '');
  const sinceFull = (Date.now() - lastFull) / 86_400_000;
  if (Number.isNaN(lastFull) || sinceFull >= FULL_REFRESH_DAYS) {
    console.log(
      `  Last full pull was ${Number.isNaN(lastFull) ? 'never' : `${sinceFull.toFixed(1)} days ago`};` +
        " change sets don't record\n  edits to a room or a time, so re-pulling everything.\n",
    );
    return { changes, latest, invalidate: new Set(), drop: new Set(), full: true };
  }

  const unseen = changes.sets.filter((set) => set.id > (state.changeSet ?? 0));
  if (unseen.length > MAX_CHANGE_SETS) {
    console.log(`  ${unseen.length} change sets behind; re-pulling everything instead.\n`);
    return { changes, latest, invalidate: new Set(), drop: new Set(), full: true };
  }
  if (!unseen.length) {
    console.log('  No new change sets, but the spreadsheet moved: refreshing the catalogue.\n');
    return { changes, latest, invalidate: new Set(), drop: new Set(), full: false };
  }

  console.log(`  ${unseen.length} change set(s) since the last pull; reading them.`);
  const invalidate = new Set();
  const drop = new Set();
  // Oldest set first, and each one overrides the last: an event can be added
  // and then deleted, or deleted and then added back, and only the newest set
  // that mentions it says what it is now.
  for (const set of [...unseen].reverse()) {
    const body = await getWithRetry(absolute(`changes.php?ChangeSet=${set.id}`));
    const { added, deleted, ticketsReturned } = parseChangeSet(body.body);
    for (const code of [...added, ...ticketsReturned]) {
      invalidate.add(code);
      drop.delete(code);
    }
    for (const code of deleted) {
      drop.add(code);
      invalidate.delete(code);
    }
    await sleep(DELAY_MS);
  }
  console.log(`  ${invalidate.size} event(s) to re-pull, ${drop.size} deleted.\n`);
  return { changes, latest, invalidate, drop, full: false };
}

async function run() {
  console.log(`Importing events from ${SOURCE.url}\n`);

  const state = await readState();
  const plan = await planWork(state);
  if (!plan) {
    console.log(`${OUTPUT} is already up to date. Nothing fetched.`);
    return;
  }

  const structured = await tryStructured();
  if (structured) {
    await writeFeed(structured, structured.length, plan);
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
    // Deliberately incomplete, so the watermark stays put and a later run
    // without the flag still knows it has locations to fetch.
    await writeFeed(events, events.length, plan, { complete: false });
    return;
  }

  console.log('Event pages (the only place the location appears):');
  // A capped run can't do a full re-pull: throwing the cache away and then
  // reading only `--limit` of it back would lose more than it refreshed, and
  // the next run would do the same again. So a cap turns a full pull into a
  // top-up, and the full-pull watermark isn't moved by it.
  const fullRefresh = plan.full && !DETAIL_LIMITED;
  if (plan.full && DETAIL_LIMITED) {
    console.log('  --limit is set, so keeping the cache; a full re-pull needs an uncapped run.');
  }

  // Either this full pull is one already in progress, or it starts here. The
  // second clause adopts a pull interrupted before that marker existed: no
  // watermark and a cache with records in it can only mean one that never
  // finished, and its own records say when it began.
  let startedAt = null;
  if (fullRefresh) {
    const resuming = (await readFullPull()) ?? (state ? null : await earliestPullAt());
    if (resuming) console.log(`  resuming the full pull that began at ${resuming}`);
    startedAt = await beginFullPull(resuming ?? new Date().toISOString());
  }

  const { cached, failed } = await crawlDetails(
    events.map((event) => event.id),
    context,
    fullRefresh
      ? { refresh: true, refreshedSince: startedAt }
      : { invalidate: plan.invalidate, drop: plan.drop },
  );

  const merged = events.map((event) => merge(event, cached.get(event.id)));
  const located = merged.filter((event) => event.locationText).length;
  console.log(`\n  ${located} of ${merged.length} events have a location.`);
  if (located < merged.length) {
    console.log(`  Re-run to fetch the remaining ${merged.length - located}; the cache is kept.`);
  }

  await compactDetailCache(cached);
  // Only a run that got everything may move the watermark, and "everything"
  // is checked rather than assumed: every event in the catalogue has a record
  // and nothing is still failing. Leaving it where it was means the next run
  // sees the same change sets again and finishes the job, rather than skipping
  // past events it never actually read. A `--limit` run that happens to close
  // the last gap therefore counts, and one that doesn't, doesn't.
  const missing = events.filter((event) => !cached.has(event.id)).length;
  const complete = failed.length === 0 && missing === 0;
  await writeFeed(merged, events.length, plan, { complete, fullRefresh });

  // A full pull that got everything is finished with; one that didn't keeps its
  // marker, so the next run carries it on rather than starting it again.
  if (fullRefresh && complete) await endFullPull();
}

async function writeFeed(events, catalogueCount, plan, { complete = true, fullRefresh = false } = {}) {
  const usable = events.filter((event) => event && event.title && event.start);
  const dropped = catalogueCount - usable.length;

  if (usable.length === 0) {
    fail('No event had both a title and a parseable start time.', null);
    return;
  }

  const fetchedAt = new Date().toISOString();
  const feed = {
    source: {
      ...SOURCE,
      fetchedAt,
      // What the source said about itself when this was pulled, so the feed
      // carries its own provenance rather than only a local clock reading.
      sourceUpdatedAt: plan?.changes?.csvProcessedAt ?? undefined,
      changeSet: plan?.latest ?? undefined,
    },
    year: Number(usable[0].start.slice(0, 4)),
    events: usable,
  };

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(feed, null, 2)}\n`);

  if (plan && complete) {
    const previous = await readState();
    await writeState({
      csvProcessedAt: plan.changes?.csvProcessedAt ?? null,
      changeSet: plan.latest ?? null,
      lastPullAt: fetchedAt,
      // Only an actual full re-pull resets this clock, so a top-up can't put
      // off the next one.
      lastFullPullAt: fullRefresh ? fetchedAt : (previous?.lastFullPullAt ?? fetchedAt),
      events: usable.length,
    });
  } else if (plan) {
    console.log('\nNot all event pages were read, so the cache watermark is left where it was.');
    console.log('Re-run to finish; what did arrive is cached and will not be fetched again.');
  }

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

// --inspect only reads, so it needn't wait on a crawl that is writing.
const locked = INSPECT ? true : await takeLock();
if (!locked) {
  process.exitCode = 1;
} else {
  /*
   * Ctrl-C, or a container being reclaimed under a long crawl.
   *
   * Node's default handling for these exits without running the `finally`
   * below, which leaves the lock file behind. A later run recognises it as
   * stale by its pid — but only while no other process has been given that pid,
   * and a container that recycles them quickly can hand it to something else.
   * Releasing it here costs nothing and removes the case.
   *
   * Nothing else needs saving: every page is appended to the cache as it
   * arrives, and a half-written last line is ignored when it is read back.
   */
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      console.log(`\n${signal} — stopping. Every page fetched so far is in ${DETAIL_CACHE};`);
      console.log('run the same command again to carry on from where this left off.');
      releaseLock().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
    });
  }

  try {
    await (INSPECT ? inspect() : run());
  } catch (error) {
    console.error(`\nImport failed: ${error.message}`);
    if (error.cause) console.error(`Cause: ${error.cause}`);
    process.exitCode = 1;
  } finally {
    if (!INSPECT) await releaseLock();
  }
}
