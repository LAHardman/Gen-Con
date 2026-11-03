/**
 * Keep the last published schedule, so a failed import cannot blank the app.
 *
 * The deploy builds `public/events.json` from gencon.com, and that import can
 * fail for reasons nobody here controls. This runs first and seeds the file
 * from what the site is already serving. A successful import then overwrites
 * it; a failed one leaves it alone. The seed is only ever used when it is a
 * real feed: an HTML error page or an empty schedule is worse than nothing.
 *
 * Usage: node scripts/keep-last-feed.mjs <published events.json URL>
 * Always exits 0, because having no earlier copy is a normal first deploy.
 */

import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/events.json');

/** Whether this parsed JSON is a schedule worth serving. */
export function isUsableFeed(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (Array.isArray(raw.events)) return raw.events.length > 0;
  const packed = raw.format === 'columns-1' || raw.format === 'columns-2';
  return packed && Number.isInteger(raw.count) && raw.count > 0 && !!raw.columns && !!raw.keys;
}

/** Returns what happened, as a sentence the workflow log can show. */
export async function keepLastFeed({ url, output = DEFAULT_OUTPUT, fetchImpl = fetch }) {
  const exists = await access(output).then(() => true, () => false);
  if (exists) return 'public/events.json already exists; leaving it alone.';
  if (!url) return 'No published URL given; nothing to keep.';

  let text;
  try {
    const response = await fetchImpl(url, { headers: { 'cache-control': 'no-cache' } });
    if (!response.ok) return `No earlier schedule to keep (HTTP ${response.status}).`;
    text = await response.text();
  } catch (reason) {
    return `No earlier schedule to keep (${reason instanceof Error ? reason.message : reason}).`;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'The published events.json is not JSON; not keeping it.';
  }
  if (!isUsableFeed(parsed)) return 'The published events.json holds no events; not keeping it.';

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, text);
  return `Kept the last published schedule (${(text.length / 1024 / 1024).toFixed(1)} MB) as a fallback.`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await keepLastFeed({ url: process.argv[2] }));
}
