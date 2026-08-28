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
 * Web and native differ in exactly two places, both behind `src/platform/`:
 * where the bytes are kept (an evictable cache; a file that outlives a
 * low-disk morning) and where they are fetched from — a native shell has no
 * origin of its own to be relative to, so it needs a pack host, and because
 * that host could one day move under copies nobody can update, the config
 * table can rewrite it.
 */

import { CONFIG } from './config';
import { fetchText } from '../platform/http';
import { packStore } from '../platform/storage';
import { readManifest, staleTables } from './pack';

const MANIFEST = 'manifest.json';

/**
 * Where this copy's pack lives.
 *
 * Beside the app on the web, which is both right and free. A native shell
 * is served from `file://`, where a relative path would find only the
 * tables baked into the bundle — so it takes the host compiled in at build
 * time (`VITE_PACK_HOST`), and the config table can override that later for
 * the day the pack moves house.
 */
export function packBase(): string {
  const configured = CONFIG.packHost ?? import.meta.env.VITE_PACK_HOST ?? '';
  const base = String(configured).trim();
  if (!base) return './pack/';
  return base.endsWith('/') ? base : `${base}/`;
}

/** First 16 hex characters of SHA-256 — the manifest's own hash format. */
async function sha16(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/**
 * Every table the stored pack holds, keyed by name, for the boot stash.
 *
 * `{}` on any failure — nowhere to store, nothing stored yet, a manifest
 * that no longer reads. The caller treats an empty answer as "snapshot
 * only", which is always sound.
 */
export async function loadStoredPack(): Promise<Record<string, unknown>> {
  if (!packStore.available()) return {};
  try {
    const held = await packStore.read(MANIFEST);
    if (!held) return {};
    const manifest = readManifest(JSON.parse(held));
    if (!manifest) return {};
    const tables: Record<string, unknown> = {};
    for (const name of Object.keys(manifest.tables)) {
      const body = await packStore.read(`${name}.json`);
      if (body === null) continue;
      try {
        tables[name] = JSON.parse(body);
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
 * there is nowhere to store.
 */
export async function refreshPack(base = packBase()): Promise<'updated' | 'kept' | 'skipped'> {
  if (!packStore.available()) return 'skipped';
  try {
    const answer = await fetchText(`${base}${MANIFEST}`);
    if (answer.status !== 200) return 'kept';
    const manifest = readManifest(JSON.parse(answer.body));
    if (!manifest) return 'kept';

    const heldRaw = await packStore.read(MANIFEST);
    const held = heldRaw ? readManifest(JSON.parse(heldRaw)) : null;
    const stale = staleTables(held?.tables ?? {}, manifest);
    if (!stale.length) return 'kept';

    const fetched: Array<[string, string]> = [];
    for (const name of stale) {
      const table = await fetchText(`${base}${name}.json`);
      if (table.status !== 200) return 'kept';
      if ((await sha16(table.body)) !== manifest.tables[name].hash) return 'kept';
      // Must parse now, or it is refused now — a stored table is a promise
      // to the next launch.
      JSON.parse(table.body);
      fetched.push([name, table.body]);
    }

    for (const [name, body] of fetched) await packStore.write(`${name}.json`, body);
    await packStore.write(MANIFEST, JSON.stringify(manifest));
    return 'updated';
  } catch {
    return 'kept';
  }
}
