#!/usr/bin/env node
/**
 * Pulls the Gen Con event schedule into public/events.json.
 *
 * Run this on a machine with internet access:
 *
 *   npm run fetch:events                  # import everything it can find
 *   npm run fetch:events -- --inspect     # report what the source looks like
 *   npm run fetch:events -- --limit 3     # stop after 3 listing pages
 *
 * The app reads the generated file rather than calling the source site at
 * runtime: a browser can't fetch it cross-origin, and a local file keeps the
 * schedule working on convention Wi-Fi.
 *
 * IMPORTANT: the parsing in scripts/lib/parse-events.mjs is written to be
 * generic (find the listing table, map columns by their headings) but it has
 * not been run against the live site — see README.md. If an import comes back
 * empty, `--inspect` prints the page structure it actually found, which is what
 * you need to correct the column patterns.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import { parseListingPage } from './lib/parse-events.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'public/events.json');
const DEBUG_DIR = resolve(ROOT, '.cache');

const SOURCE = {
  name: 'Gen Con Event Database',
  url: 'https://gencon.eventdb.us/',
};

/**
 * Candidate endpoints for structured data, tried before falling back to HTML.
 * Sites of this shape often expose one of these; if any responds with JSON we
 * use it and skip scraping entirely.
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
const PAGE_LIMIT = Number(option('limit', '40'));
const DELAY_MS = Number(option('delay', '700'));

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
  const dump = resolve(DEBUG_DIR, 'source-root.html');
  await writeFile(dump, root.body);
  console.log(`  saved        ${dump}`);

  const dom = parse(root.body);

  const tables = dom.querySelectorAll('table');
  console.log(`\nTables: ${tables.length}`);
  tables.forEach((table, index) => {
    const headers = table
      .querySelectorAll('th')
      .map((cell) => cell.text.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    console.log(
      `  [${index}] rows=${table.querySelectorAll('tr').length} headers=${JSON.stringify(headers)}`,
    );
  });

  const links = [
    ...new Set(
      dom
        .querySelectorAll('a[href]')
        .map((a) => a.getAttribute('href'))
        .filter((href) => href && !href.startsWith('#')),
    ),
  ].slice(0, 40);
  console.log(`\nLinks (first ${links.length}):`);
  for (const href of links) console.log(`  ${href}`);

  const selects = dom.querySelectorAll('select');
  console.log(`\nFilters: ${selects.length} <select>`);
  for (const select of selects) {
    const name = select.getAttribute('name') ?? select.getAttribute('id') ?? '?';
    const options = select.querySelectorAll('option').slice(0, 8).map((o) => o.text.trim());
    console.log(`  ${name}: ${JSON.stringify(options)}`);
  }

  console.log('\nProbing for structured data endpoints:');
  for (const candidate of STRUCTURED_CANDIDATES) {
    const url = new URL(candidate, SOURCE.url).toString();
    try {
      const probe = await get(url);
      console.log(`  ${probe.status} ${probe.contentType.split(';')[0] || '?'}  ${url}`);
    } catch (error) {
      console.log(`  ---  ${url}  (${error.message})`);
    }
    await sleep(200);
  }

  const parsed = parseListingPage(root.body, { baseUrl: SOURCE.url });
  console.log('\nParse attempt on the landing page:');
  console.log(`  ${JSON.stringify(parsed.diagnostics, null, 2).replace(/\n/g, '\n  ')}`);
  console.log(`  events extracted: ${parsed.events.length}`);
  if (parsed.events[0]) {
    console.log(`  first: ${JSON.stringify(parsed.events[0], null, 2).replace(/\n/g, '\n  ')}`);
  }
}

/* ------------------------------------------------------------------- import */

async function tryStructured() {
  for (const candidate of STRUCTURED_CANDIDATES) {
    const url = new URL(candidate, SOURCE.url).toString();
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

/** Follows "next page" links, collecting events from each listing page. */
async function crawlListing() {
  const collected = [];
  const seen = new Set();
  let next = SOURCE.url;
  let pages = 0;
  let lastDiagnostics = null;

  while (next && pages < PAGE_LIMIT && !seen.has(next)) {
    seen.add(next);
    pages += 1;

    const page = await get(next);
    if (!page.ok) {
      console.warn(`  page ${pages}: HTTP ${page.status} for ${next}`);
      break;
    }

    const { events, diagnostics } = parseListingPage(page.body, { baseUrl: page.url });
    lastDiagnostics = diagnostics;
    collected.push(...events);
    console.log(`  page ${pages}: ${events.length} events (${next})`);

    if (events.length === 0) break;

    const dom = parse(page.body);
    const nextLink = dom
      .querySelectorAll('a[href]')
      .find((a) => /next|›|»|older/i.test(a.text) || a.getAttribute('rel') === 'next');
    const href = nextLink?.getAttribute('href');
    next = href ? new URL(href, page.url).toString() : null;

    await sleep(DELAY_MS);
  }

  return { events: collected, diagnostics: lastDiagnostics, pages };
}

async function run() {
  console.log(`Importing events from ${SOURCE.url}\n`);

  const structured = await tryStructured();
  let events = structured;
  let diagnostics = null;

  if (!events) {
    console.log('No structured endpoint responded; reading the HTML listing.');
    const crawl = await crawlListing();
    events = crawl.events;
    diagnostics = crawl.diagnostics;
  }

  const usable = events.filter((event) => event && event.title && event.start);
  const dropped = events.length - usable.length;

  if (usable.length === 0) {
    console.error('\nNo events could be imported.');
    if (diagnostics) {
      console.error(`Parser diagnostics: ${JSON.stringify(diagnostics, null, 2)}`);
    }
    console.error(
      '\nRun `npm run fetch:events -- --inspect` to see the page structure, then adjust\n' +
        'COLUMN_PATTERNS in scripts/lib/parse-events.mjs to match the real column headings.',
    );
    process.exitCode = 1;
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
  if (dropped > 0) {
    console.log(`Skipped ${dropped} rows with no title or no parseable start time.`);
  }
  console.log('Reload the app to pick them up.');
}

try {
  await (INSPECT ? inspect() : run());
} catch (error) {
  console.error(`\nImport failed: ${error.message}`);
  if (error.cause) console.error(`Cause: ${error.cause}`);
  process.exitCode = 1;
}
