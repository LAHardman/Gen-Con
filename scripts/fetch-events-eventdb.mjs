/**
 * Fetches the Gen Con schedule from the community mirror, gencon.eventdb.us,
 * and writes public/events.json.
 *
 * WHEN THIS IS USED. Gen Con's own catalogue API empties out once a
 * convention is over and stays empty until the next year's schedule is
 * posted, so `npm run fetch:events` then finds nothing. The mirror keeps the
 * last convention, which makes a good draft for planning the next trip. The
 * deploy runs this only when there is no schedule at all, so the mirror is
 * never asked for anything that Gen Con's own data or an earlier copy can
 * provide.
 *
 * BEING A GOOD GUEST. It is one person's hobby site paid for by donations.
 * This reads about 120 pages, one every 1.5 seconds by default, and says who
 * is asking. It reads no event detail pages, which is why events carry no room.
 *
 * It refuses to write if any hour holds a different number of sessions than
 * the site says it does: a changed layout must not become a short schedule.
 *
 * Usage: node scripts/fetch-events-eventdb.mjs [--delay 1500]
 */

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack } from './lib/pack-feed.mjs';
import { parseHourList, parseHourPage } from './lib/eventdb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'public/events.json');
const BASE = 'https://gencon.eventdb.us';
const AGENT = 'Gen-Con-trip-planner (personal project; reading the schedule once for planning)';
const SOURCE = { name: 'gencon.eventdb.us (community mirror of the Gen Con catalogue)', url: `${BASE}/` };

const args = process.argv.slice(2);
const at = args.indexOf('--delay');
const PAUSE_MS = at === -1 ? 1500 : Number(args[at + 1]);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function get(path) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/${path}`, { headers: { 'User-Agent': AGENT } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (reason) {
      if (attempt === 3) throw new Error(`${path}: ${reason.message}`);
      await sleep(PAUSE_MS * attempt * 3);
    }
  }
}

async function main() {
  const started = Date.now();
  const hours = parseHourList(await get('dayTimeList.php'));
  if (hours.length === 0) throw new Error('no hours were listed; the page layout has probably changed');
  const expectedTotal = hours.reduce((sum, hour) => sum + hour.expected, 0);
  console.log(`the site lists ${hours.length} hours holding ${expectedTotal.toLocaleString('en')} sessions`);

  const byId = new Map();
  const wrong = [];
  for (const hour of hours) {
    await sleep(PAUSE_MS);
    const found = parseHourPage(await get(`dayTime.php?StartDate=${encodeURIComponent(hour.start)}`), hour.start);
    if (found.length !== hour.expected) wrong.push(`${hour.start}: found ${found.length}, site says ${hour.expected}`);
    for (const event of found) byId.set(event.id, event);
  }
  if (wrong.length) {
    throw new Error(`${wrong.length} hours did not add up, so nothing was written:\n  ${wrong.slice(0, 10).join('\n  ')}`);
  }

  const events = [...byId.values()].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  if (events.length !== expectedTotal) {
    throw new Error(`${events.length} distinct sessions against ${expectedTotal} listed; nothing was written`);
  }

  const { roomIdForEvent } = await import(join(ROOT, 'src/data/events.ts'));
  const feed = pack(events, { ...SOURCE, fetchedAt: new Date().toISOString() }, roomIdForEvent);
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(feed)}\n`);
  const megabytes = ((await stat(OUTPUT)).size / 1024 / 1024).toFixed(1);
  console.log(`Wrote ${events.length.toLocaleString('en')} events to ${OUTPUT} (${megabytes} MB) in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
