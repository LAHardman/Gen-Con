/**
 * Where a copy of this app keeps what it has downloaded.
 *
 * THE DIFFERENCE THAT MATTERS. A browser's Cache API is storage the browser
 * may take back: under disk pressure an origin's caches are evicted, whole,
 * without asking. That is survivable on the web, where the site is one
 * request away. It is not survivable in an installed app whose whole promise
 * is that it keeps working when nothing can be fetched again — so on native
 * the pack is a file in the app's own data directory, which the system does
 * not reclaim while the app is installed.
 *
 * Text in, text out, and every failure answers null or resolves quietly. A
 * store that throws would push a `try` into every caller, and each of those
 * callers already has exactly one right answer to any storage failure: carry
 * on with the compiled snapshot.
 */

import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { isNative } from './index';

export interface Store {
  /** Whether anything can be kept here at all. */
  available(): boolean;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

/** The pack's own cache, kept apart from the service worker's. */
const CACHE = 'gencon-pack-1';
/** A directory rather than the data root, so the pack is deletable as one thing. */
const DIRECTORY = 'pack';

const webStore: Store = {
  available: () => typeof caches !== 'undefined',
  async read(key) {
    try {
      const cache = await caches.open(CACHE);
      const held = await cache.match(key);
      return held ? await held.text() : null;
    } catch {
      return null;
    }
  },
  async write(key, value) {
    try {
      const cache = await caches.open(CACHE);
      await cache.put(
        key,
        new Response(value, { headers: { 'content-type': 'application/json' } }),
      );
    } catch {
      // Storage full, or a private window that refuses caches: the app is
      // complete on its snapshot, so there is nothing to report and nothing
      // to do.
    }
  },
};

const nativeStore: Store = {
  available: () => true,
  async read(key) {
    try {
      const file = await Filesystem.readFile({
        path: `${DIRECTORY}/${key}`,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return typeof file.data === 'string' ? file.data : null;
    } catch {
      // Not written yet is the ordinary case on a first launch.
      return null;
    }
  },
  async write(key, value) {
    try {
      await Filesystem.writeFile({
        path: `${DIRECTORY}/${key}`,
        data: value,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    } catch {
      // Same as the web: the snapshot is the floor.
    }
  },
};

/** The store this copy uses, decided once at load. */
export const packStore: Store = isNative() ? nativeStore : webStore;
