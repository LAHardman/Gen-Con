/**
 * The asynchronous half of the pack: fetching it, verifying it, keeping it.
 *
 * `refreshPack` runs in the background after the app has rendered: one
 * small request for the manifest, then only the tables whose hash moved.
 * Nothing it downloads is applied to the running app — a venue table
 * swapped under a mounted Leaflet map buys a class of bug nothing needs —
 * it is stored, and the *next* launch reads it (`loadStoredPack`, called by
 * `main.tsx` before the data modules load).
 *
 * ALL OR NOTHING, MANIFEST LAST. A table is stored only after its bytes
 * match the manifest's hash and parse as JSON; the manifest is stored only
 * after every stale table landed. A refresh that dies half-way therefore
 * leaves the held manifest describing the tables actually held, and the
 * next run simply fetches again. At no point can a truncated download
 * shadow a working snapshot — the rule the whole pack lives by, because an
 * installed copy that can never update again has no way back from a
 * misread.
 *
 * The pack has its own cache, not the service worker's: `sw.js` passes
 * `pack/` URLs through untouched, because stale-while-revalidate would hand
 * this refresher the very staleness it exists to beat, and store every
 * table twice.
 */

import { readManifest, staleTables } from './pack';

const CACHE = 'gencon-pack-1';
const MANIFEST = 'manifest.json';

/** First 16 hex characters of SHA-256 — the manifest's own hash format. */
async function sha16(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/**
 * Every table the stored pack holds, keyed by name, for the boot stash.
 *
 * `{}` on any failure — no caches API (a first visit, a browser without it,
 * jsdom), nothing stored yet, a manifest that no longer reads. The caller
 * treats an empty answer as "snapshot only", which is always sound.
 */
export async function loadStoredPack(): Promise<Record<string, unknown>> {
  if (!('caches' in globalThis)) return {};
  try {
    const cache = await caches.open(CACHE);
    const held = await cache.match(MANIFEST);
    if (!held) return {};
    const manifest = readManifest(await held.json());
    if (!manifest) return {};
    const tables: Record<string, unknown> = {};
    for (const name of Object.keys(manifest.tables)) {
      const hit = await cache.match(`${name}.json`);
      if (!hit) continue;
      try {
        tables[name] = await hit.json();
      } catch {
        // A stored table that no longer parses is simply not offered.
      }
    }
    return tables;
  } catch {
    return {};
  }
}

/**
 * Check the published pack and store whatever moved, for the next launch.
 *
 * 'updated' when new tables landed, 'kept' when there was nothing to do or
 * anything at all went wrong (the two are deliberately one answer: either
 * way the next launch runs on what is already verified), 'skipped' where
 * there is no cache to store into.
 */
export async function refreshPack(base = './pack/'): Promise<'updated' | 'kept' | 'skipped'> {
  if (!('caches' in globalThis)) return 'skipped';
  try {
    const answer = await fetch(`${base}${MANIFEST}`, { cache: 'no-cache' });
    if (!answer.ok) return 'kept';
    const manifest = readManifest(await answer.json());
    if (!manifest) return 'kept';

    const cache = await caches.open(CACHE);
    const heldHit = await cache.match(MANIFEST);
    const held = heldHit ? readManifest(await heldHit.json()) : null;
    const stale = staleTables(held?.tables ?? {}, manifest);
    if (!stale.length) return 'kept';

    for (const name of stale) {
      const table = await fetch(`${base}${name}.json`, { cache: 'no-cache' });
      if (!table.ok) return 'kept';
      const bytes = await table.arrayBuffer();
      if ((await sha16(bytes)) !== manifest.tables[name].hash) return 'kept';
      // Must parse now, or it is refused now — a stored table is a promise
      // to the next launch.
      JSON.parse(new TextDecoder().decode(bytes));
      await cache.put(
        `${name}.json`,
        new Response(bytes, { headers: { 'content-type': 'application/json' } }),
      );
    }
    await cache.put(
      MANIFEST,
      new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } }),
    );
    return 'updated';
  } catch {
    return 'kept';
  }
}
