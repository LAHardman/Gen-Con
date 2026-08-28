/**
 * Keeping the app on screen when the network isn't.
 *
 * Gen Con is fifty thousand people in four buildings, all holding a phone. The
 * schedule already survives that — it is baked into the page — but until this
 * existed nothing else did: a reload on bad convention Wi-Fi got the browser's
 * offline page, and the map, the plans and the whole 9 MB of events with it.
 * The one thing worse than an app that needs signal is an app that *had* the
 * answer and threw it away on a refresh.
 *
 * Two caches, because the two things behave differently.
 *
 * THE APP, which is same-origin: the page, its JavaScript, its stylesheet and
 * `events.json`. Served **stale-while-revalidate** — answer from the cache
 * immediately and fetch a fresh copy in the background for next time. On a
 * connection that is present but hopeless, which is what a convention hall
 * actually has, waiting for the network to fail is most of the wait.
 *
 * WITH ONE EXCEPTION, WHICH COST A DEPLOY. The page itself is served
 * **network-first**, with the cached copy as a fallback after a short wait.
 * Stale-while-revalidate is right for everything whose filename carries a
 * content hash — a hashed asset at a given URL is the same bytes for ever, so
 * serving it from the cache is not staleness at all. `index.html` is the one
 * file that must *not* work that way: its URL never changes and its contents
 * name which hashed assets to load. Served stale, it names the old build, so
 * the old build is what loads — and because it also then re-caches the old
 * assets, the app pins itself to that build and stays there. Every deploy after
 * that is invisible. The page is about a kilobyte and the wait below is capped,
 * so the hall keeps its offline mode and the reader stops getting last week's
 * app.
 *
 * THE TILES, which are somebody else's: **cache-first**, because a map tile
 * for a city block does not change during a convention and re-fetching one is
 * pure cost. Capped, because panning around downtown at every zoom would
 * otherwise fill the disk quota and get the whole origin's storage evicted —
 * the app with it.
 *
 * Nothing is precached by name. The built filenames carry a content hash, so a
 * list written here would be wrong on the next deploy. Instead the page tells
 * the worker what it just loaded, and the worker caches that — which is the
 * same set by definition, and is also the fix for a real hole: a worker does
 * not control the page during its own installation, so on a first visit the
 * JavaScript, the stylesheet, `events.json` and every tile go straight past it.
 * Without the hand-over, one visit is not enough and nothing says so; the app
 * looks cached because the browser's own HTTP cache is answering, until it
 * isn't.
 *
 * So: the first visit needs a network. Every one after it does not.
 */

/**
 * Bump to throw away everything cached under the old name.
 *
 * The hashes in the asset filenames already make a new build a new URL, so this
 * is not for ordinary deploys — it is for changing what is cached or how, when
 * the entries already on somebody's phone were made under different rules.
 *
 * v2 is exactly that, and is also the only way to reach the phones the v1 bug
 * stranded. A worker is replaced when its own bytes change, so a build that
 * touches nothing here installs no new worker and the stale `index.html` in
 * `gencon-app-v1` keeps answering for ever. Renaming the cache abandons it.
 */
const VERSION = 'v2';

const APP_CACHE = `gencon-app-${VERSION}`;
const TILE_CACHE = `gencon-tiles-${VERSION}`;

/**
 * How many map tiles to keep. A 256-pixel PNG is 5–15 KB, so this is roughly
 * 10 MB — enough for the campus at every zoom somebody walks it at, and far
 * enough inside a typical origin quota that the browser will not start
 * evicting things to make room.
 */
const TILE_LIMIT = 900;

/** The hosts whose tiles are worth keeping. Everything else is passed through. */
const TILE_HOSTS = ['basemaps.cartocdn.com'];

self.addEventListener('install', (event) => {
  // The shell, by the names that do not change. Everything else — the hashed
  // JavaScript and stylesheet, and events.json — arrives on the first load and
  // is cached as it goes.
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(['./', './manifest.webmanifest', './icon.svg']))
      // A shell entry that will not fetch must not stop the worker installing:
      // without it the app has no cache at all, which is the thing being fixed.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== APP_CACHE && name !== TILE_CACHE).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * What the page loaded before this worker was in charge of anything.
 *
 * Sent once, on the first load that installs the worker. Everything after that
 * goes through `fetch` above and needs no help.
 */
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache' || !Array.isArray(event.data.urls)) return;
  event.waitUntil(adopt(event.data.urls));
});

async function adopt(urls) {
  const [app, tiles] = await Promise.all([caches.open(APP_CACHE), caches.open(TILE_CACHE)]);
  await Promise.all(
    urls.map(async (raw) => {
      let url;
      try {
        url = new URL(raw, self.location.href);
      } catch {
        return;
      }
      const isTile = TILE_HOSTS.some((host) => url.hostname.endsWith(host));
      if (!isTile && url.origin !== self.location.origin) return;
      const cache = isTile ? tiles : app;
      // Already held is the common case on every load after the first.
      if (await cache.match(url.href)) return;
      try {
        // Fetched and `put` rather than `add`, because a tile comes back
        // *opaque* — a cross-origin response with no CORS headers, which is all
        // an `<img>` needs and all Leaflet ever asks for. `add` rejects those:
        // it insists on a readable 200, and an opaque response reports status
        // 0. That one detail is the difference between a map that works
        // offline and a blank grid, and it fails silently in the direction of
        // caching nothing.
        const request = new Request(url.href, isTile ? { mode: 'no-cors' } : undefined);
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') await cache.put(request, response);
      } catch {
        // One tile that has scrolled out of the CDN must not take the rest of
        // the list with it.
      }
    }),
  );
  await trim(tiles);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (TILE_HOSTS.some((host) => url.hostname.endsWith(host))) {
    event.respondWith(tile(request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // The data pack is the page's own affair: `pack-store.ts` fetches it with
  // its own freshness rules, verifies it against its manifest, and keeps it
  // in its own cache to apply on the next launch. Answering these from the
  // app cache would hand that refresher the very staleness it exists to
  // beat, and store every table twice.
  if (url.pathname.includes('/pack/')) return;
  event.respondWith(request.mode === 'navigate' ? shell(request, event) : app(request, event));
});

/**
 * The page: the network if it answers promptly, otherwise the copy we have.
 *
 * Always stored under `./` whatever was asked for, because there is one page —
 * a deep link is the same app with a different path, and caching it by its own
 * URL would fill the cache with copies and still miss the next path.
 *
 * The wait is what keeps this honest in a hall. Network-first with no cap means
 * a connection that is present but hopeless blocks the app for as long as the
 * browser is willing to wait, which is the failure this whole file exists to
 * avoid. A second and a half is long enough for a kilobyte on a working
 * connection and short enough not to be a hang on a broken one.
 */
const SHELL_WAIT = 1500;

async function shell(request, event) {
  const cache = await caches.open(APP_CACHE);

  const fresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put('./', response.clone());
      return response;
    })
    .catch(() => null);
  // Held open explicitly: without this the browser may stop the worker the
  // moment the cached page is handed back, and the copy it was fetching to
  // replace it never lands. See `app` below, where the same mistake was worse.
  event.waitUntil(fresh);

  const cached = (await cache.match(request)) ?? (await cache.match('./'));
  if (!cached) return (await fresh) ?? Response.error();

  const wait = new Promise((resolve) => {
    setTimeout(resolve, SHELL_WAIT);
  });
  return (await Promise.race([fresh, wait])) ?? cached;
}

/**
 * Everything else same-origin: the cached copy now, a fresh one for next time.
 *
 * `event.waitUntil` is not decoration. A worker is stopped when the last thing
 * it was asked for has been answered, and answering from the cache is instant —
 * so without this the background fetch is started and then killed, every time,
 * and the cache never refreshes at all. Stale-while-revalidate with no
 * revalidate is just stale, and it fails silently: the app is fast and correct
 * and one build behind for ever.
 */
async function app(request, event) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);

  const fresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(fresh);
    return cached;
  }
  return (await fresh) ?? Response.error();
}

/** Somebody else's tiles: whatever is cached, and only otherwise the network. */
async function tile(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // Opaque responses (no CORS) are cacheable and unreadable, which is fine —
    // Leaflet only ever puts them in an <img>.
    if (response.ok || response.type === 'opaque') {
      await cache.put(request, response.clone());
      void trim(cache);
    }
    return response;
  } catch {
    return Response.error();
  }
}

/**
 * Keep the tile cache under its cap, oldest first.
 *
 * `cache.keys()` is in insertion order, so the front of it is the least
 * recently *added* — not the least recently used, which the Cache API will not
 * tell us. Close enough: the tiles somebody added first are the ones they
 * panned away from.
 */
async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= TILE_LIMIT) return;
  await Promise.all(keys.slice(0, keys.length - TILE_LIMIT).map((key) => cache.delete(key)));
}
