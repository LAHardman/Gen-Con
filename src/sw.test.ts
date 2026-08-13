/**
 * The offline cache, driven directly.
 *
 * `public/sw.js` cannot be imported — it is a service worker, it talks to
 * globals a page does not have, and it registers its handlers as a side effect
 * of loading. So this evaluates it in a scope built for the purpose and calls
 * the handlers it registered. That is more machinery than a test usually
 * deserves, and it is here because every branch in it fails silently:
 *
 *   Cache the wrong thing and the app is merely slower. Cache *nothing* and it
 *   still works perfectly, online, right up to the moment somebody reloads it
 *   in a hall with fifty thousand phones in it — which is the only moment that
 *   matters and the one nobody tests by hand.
 *
 * The opaque-response case below is not hypothetical: it is the bug this file
 * found. `cache.add` refuses a cross-origin tile, because it insists on a
 * readable 200 and an opaque response reports status 0, so the tile cache
 * stayed empty while everything else looked right.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Read as text rather than imported: it is a service worker, and importing it
// would run it against the test's own globals.
import SOURCE from '../public/sw.js?raw';

/* ------------------------------------------------------------ a fake browser */

interface Entry {
  url: string;
  response: FakeResponse;
}

class FakeResponse {
  constructor(
    readonly type: 'basic' | 'opaque' | 'error',
    readonly ok: boolean,
    readonly status: number,
    readonly body = '',
  ) {}
  clone() {
    return this;
  }
  static error() {
    return new FakeResponse('error', false, 0);
  }
}

const SCOPE = 'https://example.test/';

/** As the real Cache API does: a bare string is a URL relative to the scope. */
const resolve = (request: { url: string } | string) =>
  new URL(typeof request === 'string' ? request : request.url, SCOPE).href;

class FakeCache {
  entries: Entry[] = [];
  async match(request: { url: string } | string) {
    const url = resolve(request);
    return this.entries.find((entry) => entry.url === url)?.response;
  }
  async put(request: { url: string } | string, response: FakeResponse) {
    const url = resolve(request);
    this.entries = this.entries.filter((entry) => entry.url !== url);
    this.entries.push({ url, response });
  }
  async add(request: { url: string } | string) {
    const url = resolve(request);
    const response = await world.fetch(new FakeRequest(url));
    // The real `Cache.add` rejects anything that is not a readable 2xx. That
    // includes an opaque cross-origin response, which is what a map tile is.
    if (!response.ok) throw new Error(`add(${url}) refused a ${response.status}`);
    await this.put(url, response);
  }
  async addAll(urls: string[]) {
    for (const url of urls) await this.add(url);
  }
  async keys() {
    return this.entries.map((entry) => new FakeRequest(entry.url));
  }
  async delete(request: { url: string } | string) {
    const url = resolve(request);
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.url !== url);
    return this.entries.length !== before;
  }
}

class FakeRequest {
  method = 'GET';
  mode: string;
  constructor(
    readonly url: string,
    init: { mode?: string } = {},
  ) {
    this.mode = init.mode ?? 'cors';
  }
}

/** Everything the worker is allowed to see, rebuilt for each test. */
const world = {
  caches: new Map<string, FakeCache>(),
  fetch: async (_request: FakeRequest): Promise<FakeResponse> => FakeResponse.error(),
  handlers: new Map<string, (event: never) => void>(),
  skipWaiting: vi.fn(),
  claim: vi.fn(),
};

const cacheStore = {
  open: async (name: string) => {
    if (!world.caches.has(name)) world.caches.set(name, new FakeCache());
    return world.caches.get(name)!;
  },
  keys: async () => [...world.caches.keys()],
  delete: async (name: string) => world.caches.delete(name),
  match: async (request: { url: string } | string) => {
    for (const cache of world.caches.values()) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    return undefined;
  },
};

/** Load the worker, capturing the handlers it registers. */
function loadWorker() {
  world.caches = new Map();
  world.handlers = new Map();
  const self = {
    addEventListener: (type: string, handler: (event: never) => void) => world.handlers.set(type, handler),
    location: { origin: 'https://example.test', href: 'https://example.test/' },
    skipWaiting: world.skipWaiting,
    clients: { claim: world.claim },
  };
  const run = new Function(
    'self',
    'caches',
    'fetch',
    'Response',
    'Request',
    'URL',
    `${SOURCE}\n//# sourceURL=sw.js`,
  );
  run(
    self,
    cacheStore,
    (request: FakeRequest) => world.fetch(request),
    FakeResponse,
    FakeRequest,
    URL,
  );
}

/**
 * Fire one of the worker's handlers and answer as the browser would.
 *
 * `kept` is the point of the return value as much as the response is. A browser
 * stops a worker once everything it was asked for has been answered, and work
 * the worker did not hand to `waitUntil` is killed there — so a test that
 * simply awaits the background fetch proves nothing about whether the browser
 * would have let it finish. Only what went through `waitUntil` survives, and
 * only that is what these tests may await.
 */
async function fire(type: string, event: Record<string, unknown>) {
  const kept: Promise<unknown>[] = [];
  let responded: Promise<FakeResponse> | undefined;
  const handler = world.handlers.get(type);
  expect(handler, `no ${type} handler`).toBeTruthy();
  handler!({
    ...event,
    waitUntil: (promise: Promise<unknown>) => kept.push(promise),
    respondWith: (promise: Promise<FakeResponse>) => {
      responded = promise;
    },
  } as never);
  const response = responded ? ((await responded) as FakeResponse) : null;
  await Promise.all(kept);
  return { response, kept: kept.length };
}

/** Most tests only want the response. */
const answer = async (type: string, event: Record<string, unknown>) => (await fire(type, event)).response;

const app = () => world.caches.get('gencon-app-v2');
const tiles = () => world.caches.get('gencon-tiles-v2');
const TILE = 'https://a.basemaps.cartocdn.com/dark_nolabels/16/17081/24865.png';

beforeEach(() => {
  loadWorker();
  world.fetch = async (request) =>
    /cartocdn/.test(request.url)
      ? new FakeResponse('opaque', false, 0)
      : new FakeResponse('basic', true, 200, `fresh:${request.url}`);
});

/* ------------------------------------------------------------------ the tests */

describe('installing', () => {
  it('takes over straight away rather than waiting for every tab to close', async () => {
    await fire('install', {});
    expect(world.skipWaiting).toHaveBeenCalled();
  });

  it('installs even when the shell will not fetch', async () => {
    // A worker that fails to install leaves no cache at all, which is the whole
    // thing being fixed. A missing icon must not cost the app its offline mode.
    world.fetch = async () => {
      throw new Error('offline');
    };
    await expect(answer('install', {})).resolves.toBeNull();
    expect(world.skipWaiting).toHaveBeenCalled();
  });

  it('throws away caches from an older version of these rules', async () => {
    await cacheStore.open('gencon-app-v1');
    await cacheStore.open('gencon-app-v2');
    await fire('activate', {});
    expect(await cacheStore.keys()).not.toContain('gencon-app-v1');
    expect(await cacheStore.keys()).toContain('gencon-app-v2');
    expect(world.claim).toHaveBeenCalled();
  });
});

describe('the app itself', () => {
  const page = (url = 'https://example.test/assets/index-abc.js', mode = 'cors') => ({
    request: new FakeRequest(url, { mode }),
  });

  it('answers a hashed asset from the cache and refreshes behind you', async () => {
    // Stale-while-revalidate, and the "stale" half is the point: on a
    // connection that is present but hopeless — a convention hall — most of the
    // wait is waiting for the network to fail. It is safe here because the
    // filename carries a content hash, so this URL is these bytes for ever.
    const cache = await cacheStore.open('gencon-app-v2');
    await cache.put('https://example.test/assets/index-abc.js', new FakeResponse('basic', true, 200, 'cached'));
    const { response } = await fire('fetch', page());
    expect(response?.body).toBe('cached');
    expect((await cache.match('https://example.test/assets/index-abc.js'))?.body).toContain('fresh:');
  });

  it('holds the worker open for the refresh, or there is no refresh', async () => {
    // The bug that hid three deploys. A browser stops a worker once the last
    // thing asked of it has been answered, and answering from the cache is
    // instant — so a background fetch that was never handed to `waitUntil` is
    // started and killed, every single time. The cache then never updates, and
    // nothing anywhere reports it: the app is fast, correct, and one build
    // behind for ever.
    const cache = await cacheStore.open('gencon-app-v2');
    await cache.put('https://example.test/assets/index-abc.js', new FakeResponse('basic', true, 200, 'cached'));
    expect((await fire('fetch', page())).kept).toBe(1);
  });

  it('takes the page from the network even when it has one cached', async () => {
    // The other half of the same bug, and the half that pinned the app. Every
    // asset URL carries a content hash except this one: `index.html` keeps its
    // URL and names which hashed assets to load. Served from the cache it names
    // the old build, so the old build loads — and re-caches itself — and the
    // deploy that went out an hour ago is invisible for ever.
    const cache = await cacheStore.open('gencon-app-v2');
    await cache.put('https://example.test/', new FakeResponse('basic', true, 200, 'last week'));
    const { response } = await fire('fetch', page('https://example.test/', 'navigate'));
    expect(response?.body).toContain('fresh:');
    expect((await cache.match('https://example.test/'))?.body).toContain('fresh:');
  });

  it('keeps one page however it was reached, not one per path', async () => {
    // A deep link is the same app with a different path. Filing it under its
    // own URL fills the cache with copies of one file and still misses the next
    // path somebody opens.
    await fire('fetch', page('https://example.test/deep/link', 'navigate'));
    expect(app()?.entries.map((entry) => entry.url)).toEqual(['https://example.test/']);
  });

  it('falls back to the page when a navigation has no network', async () => {
    // A map with a stale schedule beats a browser error page.
    const cache = await cacheStore.open('gencon-app-v2');
    await cache.put('https://example.test/', new FakeResponse('basic', true, 200, 'the app'));
    world.fetch = async () => {
      throw new Error('offline');
    };
    const { response } = await fire('fetch', page('https://example.test/deep/link', 'navigate'));
    expect(response?.body).toBe('the app');
  });

  it('does not wait on a connection that is present but hopeless', async () => {
    // Which is exactly what a hall with fifty thousand phones in it has, and
    // why the page is network-*first* rather than network-only. An uncapped
    // wait would hand the whole app back to the failure this file exists to
    // avoid.
    vi.useFakeTimers();
    try {
      const cache = await cacheStore.open('gencon-app-v2');
      await cache.put('https://example.test/', new FakeResponse('basic', true, 200, 'the app'));
      world.fetch = async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        return new FakeResponse('basic', true, 200, `fresh:${request.url}`);
      };
      const pending = fire('fetch', page('https://example.test/', 'navigate'));
      await vi.advanceTimersByTimeAsync(60_000);
      expect((await pending).response?.body).toBe('the app');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not keep a failure, which it would then serve for ever', async () => {
    // The worst thing a cache can do. One deploy where `events.json` answers
    // 404 for a second, and stale-while-revalidate would hand that 404 back on
    // every load afterwards — the schedule gone, from a blip that lasted a
    // second, with nothing on screen to say why.
    world.fetch = async () => new FakeResponse('basic', false, 404);
    await fire('fetch', page('https://example.test/events.json'));
    expect(app()?.entries ?? []).toHaveLength(0);
  });

  it('leaves other origins alone', async () => {
    // Anything that is not ours and not a tile is somebody else's business, and
    // answering for it is how a service worker breaks a page it has never heard
    // of.
    const response = await answer('fetch', { request: new FakeRequest('https://elsewhere.test/x.js') });
    expect(response).toBeNull();
  });

  it('ignores anything that is not a GET', async () => {
    const request = new FakeRequest('https://example.test/x');
    request.method = 'POST';
    expect(await answer('fetch', { request })).toBeNull();
  });
});

describe('the tiles', () => {
  it('answers from the cache without asking the network', async () => {
    // A map tile for a city block does not change during a convention.
    const cache = await cacheStore.open('gencon-tiles-v2');
    await cache.put(TILE, new FakeResponse('opaque', false, 0, 'held'));
    world.fetch = async () => {
      throw new Error('should not have been asked');
    };
    const response = await answer('fetch', { request: new FakeRequest(TILE) });
    expect(response?.body).toBe('held');
  });

  it('keeps an opaque tile, which is the only kind there is', async () => {
    // The bug this file found. A cross-origin tile comes back opaque — status
    // 0, unreadable, and all an `<img>` needs. Insisting on a readable 200
    // leaves the tile cache empty while every other cache fills up, so the app
    // looks cached and the map is a blank grid.
    const response = await answer('fetch', { request: new FakeRequest(TILE) });
    expect(response?.type).toBe('opaque');
    expect(tiles()?.entries).toHaveLength(1);
  });

  it('does not keep a tile that failed', async () => {
    world.fetch = async () => new FakeResponse('basic', false, 502);
    await fire('fetch', { request: new FakeRequest(TILE) });
    expect(tiles()?.entries ?? []).toHaveLength(0);
  });

  it('stays under its cap, oldest first', async () => {
    // Panning downtown at every zoom would otherwise fill the origin's quota
    // and get everything evicted — the app with it.
    const cache = await cacheStore.open('gencon-tiles-v2');
    for (let n = 0; n < 950; n += 1) {
      await cache.put(`https://a.basemaps.cartocdn.com/dark/16/${n}/1.png`, new FakeResponse('opaque', false, 0));
    }
    await fire('fetch', { request: new FakeRequest(TILE) });
    expect(cache.entries.length).toBeLessThanOrEqual(900);
    // The newest survived and the oldest went.
    expect(await cache.match(TILE)).toBeTruthy();
    expect(await cache.match('https://a.basemaps.cartocdn.com/dark/16/0/1.png')).toBeFalsy();
  });
});

describe('what the page hands over', () => {
  const handOver = (urls: string[]) => fire('message', { data: { type: 'cache', urls } });

  it('adopts what loaded before the worker was in charge', async () => {
    // A worker does not control the page that installs it, so on a first visit
    // the JavaScript, the stylesheet and the 9 MB of events go straight past
    // it. Without this the app looks cached because the browser's own HTTP
    // cache is answering, until it isn't.
    await handOver(['https://example.test/events.json', 'https://example.test/assets/index-abc.js']);
    expect(app()?.entries.map((entry) => entry.url).sort()).toEqual([
      'https://example.test/assets/index-abc.js',
      'https://example.test/events.json',
    ]);
  });

  it('files a tile as a tile, not as part of the app', async () => {
    // Two caches with two policies, and the tiles are the ones with a cap on
    // them. Putting them in with the app means no cap and no eviction order.
    await handOver([TILE, 'https://example.test/events.json']);
    expect(tiles()?.entries).toHaveLength(1);
    expect(app()?.entries).toHaveLength(1);
  });

  it('ignores an origin that is neither ours nor a tile host', async () => {
    // A page can load anything. Caching somebody else's analytics beacon fills
    // the quota that the app and the tiles are competing for.
    await handOver(['https://analytics.test/beacon.gif', 'https://fonts.example/x.woff2']);
    expect(app()?.entries ?? []).toHaveLength(0);
    expect(tiles()?.entries ?? []).toHaveLength(0);
  });

  it('does not re-fetch what it already holds', async () => {
    // The observer that feeds this repeats itself on every load; refetching
    // 9 MB of events each time would be worse than not caching them.
    const asked: string[] = [];
    world.fetch = async (request) => {
      asked.push(request.url);
      return new FakeResponse('basic', true, 200);
    };
    await handOver(['https://example.test/events.json']);
    await handOver(['https://example.test/events.json']);
    expect(asked).toHaveLength(1);
  });

  it('lets one failure through without losing the rest', async () => {
    world.fetch = async (request) => {
      if (request.url.includes('gone')) throw new Error('404');
      return new FakeResponse('basic', true, 200);
    };
    await handOver(['https://example.test/gone.js', 'https://example.test/events.json']);
    expect(app()?.entries.map((entry) => entry.url)).toEqual(['https://example.test/events.json']);
  });

  it('ignores a message that is not for it', async () => {
    await fire('message', { data: { type: 'something-else' } });
    await fire('message', { data: null });
    expect(world.caches.size).toBe(0);
  });
});
