/**
 * Turning the offline cache on, and being able to leave it off.
 *
 * A service worker is the difference between an app that needs signal and one
 * that needed signal once. It is also the classic way to serve somebody a build
 * from three weeks ago for ever, so two things are deliberate here:
 *
 *   It only registers on a built site. In development the dev server *is* the
 *   source of truth, and a worker in front of it serves yesterday's module
 *   while you are editing today's — a whole afternoon of a change not taking
 *   effect.
 *
 *   The worker skips waiting and claims its clients, so a new deploy replaces
 *   the old one on the next load rather than the next time every tab is shut.
 *   Paired with `stale-while-revalidate`, that means at most one stale load.
 *
 * Registered late — after the page is interactive — because installing it
 * competes with the map for the same network and the same main thread, and the
 * map is what somebody is waiting for.
 */

/** Where the worker is served from, relative so the app works under a subpath. */
const WORKER = './sw.js';

export function registerServiceWorker(enabled = import.meta.env.PROD) {
  if (!enabled || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(WORKER)
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        if (registration.active) handOver(registration.active);
      })
      .catch(() => {
        // A failed registration is not worth telling anybody about: the app
        // works exactly as it did before service workers existed, only online.
      });
  });
}

/**
 * Tell the worker what this page fetched, as it fetches it.
 *
 * A worker does not control the page that installs it, so on a first visit the
 * JavaScript, the stylesheet, `events.json` and every map tile go straight past
 * it. The app then *looks* cached, because the browser's own HTTP cache is
 * answering — right up until it isn't. Handing the list over closes that, and
 * means one visit with a signal is enough rather than two.
 *
 * Watched rather than sampled, which took a second attempt: a snapshot taken
 * when the worker becomes ready is taken before the 9 MB of events have
 * arrived, so the one file the app cannot do without was the one file not
 * cached. An observer also picks up the tiles Leaflet fetches while somebody
 * pans, which is the other half of being useful offline — and the performance
 * timeline is the only place those appear at all, since Leaflet discards the
 * `<img>` elements as they leave the screen.
 */
function handOver(worker: ServiceWorker) {
  const sent = new Set<string>();
  const send = (urls: string[]) => {
    const fresh = urls.filter((url) => !sent.has(url));
    if (!fresh.length) return;
    for (const url of fresh) sent.add(url);
    worker.postMessage({ type: 'cache', urls: fresh });
  };

  send([location.href]);
  if (typeof PerformanceObserver === 'undefined') {
    send(performance.getEntriesByType('resource').map((entry) => entry.name));
    return;
  }
  // `buffered` replays what has already loaded, so this covers both halves.
  new PerformanceObserver((list) => send(list.getEntries().map((entry) => entry.name))).observe({
    type: 'resource',
    buffered: true,
  });
}
