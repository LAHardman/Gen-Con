export interface Store {
  /** Whether anything can be kept here at all. */
  available(): boolean;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

/** The pack's own cache, kept apart from the service worker's. */
const CACHE = 'gencon-pack-1';
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

export const packStore = webStore;
