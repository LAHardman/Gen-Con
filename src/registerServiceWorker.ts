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
 *
 * AND IT LOOKS FOR A NEW BUILD WHEN THE APP COMES BACK, which "on the next
 * load" quietly does not cover. Installed on a phone, this is opened from the
 * home screen and resumed from the app switcher, and neither is a navigation:
 * the browser checks for a new worker when the page loads, and that page may
 * not load again for a week. Somebody can sit on a build from before the
 * convention started with nothing anywhere to say so.
 *
 * So every time the app is brought to the foreground it asks. On resume rather
 * than on a timer, because the reload that follows is only unobtrusive if it
 * happens before anybody has touched anything — a timer would fire mid-route.
 *
 * MEASURED, in Chromium against a built site, because none of this can be seen
 * in development and the unit tests below only prove that *this file* does its
 * part. Deploy a new `sw.js`, resume the app, and it reloads on to it in about
 * ten seconds.
 *
 * The delay is the hand-over below. A worker cannot be replaced while the old
 * one still has an `event.waitUntil()` outstanding, and `handOver` opens one to
 * cache what the page fetched — so the new build waits for that to finish.
 * Warm, that is the ten seconds. On a *first* visit, where the hand-over is
 * pulling the shell and 9 MB of events, the same measurement is 35 seconds —
 * but a first visit is by definition not an update, so it is the warm number
 * that describes what anybody will actually experience.
 */

/** Where the worker is served from, relative so the app works under a subpath. */
const WORKER = './sw.js';

export function registerServiceWorker(enabled = import.meta.env.PROD) {
  if (!enabled || !('serviceWorker' in navigator)) return;
  // Captured before registering, because `clients.claim()` fires
  // `controllerchange` on the very first install too — going from no worker to
  // one. That is not a new version arriving, and reloading for it would mean
  // every first visit reloads itself.
  const wasControlled = Boolean(navigator.serviceWorker.controller);
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(WORKER)
      .then((registration) => {
        watchForUpdates(registration, wasControlled);
        return navigator.serviceWorker.ready;
      })
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
 * Ask for a new worker whenever the app is brought back, and reload once when
 * one takes over.
 *
 * `registration.update()` is the only way to make the check happen off a
 * navigation. It is a conditional request against `sw.js` and costs nothing
 * when there is nothing new.
 *
 * The reload is guarded twice over. `wasControlled` keeps a first install from
 * reloading the page that installed it. `reloading` keeps the reload from
 * happening more than once — `controllerchange` can fire again while the page
 * is on its way out, and a service worker that reloads its own page in a loop
 * is an app nobody can use and cannot easily uninstall.
 */
function watchForUpdates(registration: ServiceWorkerRegistration, wasControlled: boolean) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!wasControlled || reloading) return;
    reloading = true;
    window.location.reload();
  });

  const check = () => {
    if (document.visibilityState !== 'visible') return;
    void registration.update().catch(() => {
      // Offline, which is the state this whole file exists for. There will be
      // another resume.
    });
  };
  document.addEventListener('visibilitychange', check);
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
