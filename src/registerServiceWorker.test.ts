/**
 * Registering the worker, and knowing when to reload for a new one.
 *
 * None of this can be seen in development, which is the point of testing it.
 * The worker does not register there at all — deliberately — so every branch
 * below is code that only ever runs on somebody's phone, where the failures are
 * an app that silently never updates and an app that reloads itself in a loop.
 * The second is worse: it is unusable and there is no obvious way out of it
 * short of clearing site data, which nobody on a convention floor will do.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './registerServiceWorker';

type Listener = (event?: unknown) => void;

/** Just enough of the two APIs this file touches. */
function stub({ controller = null as unknown }: { controller?: unknown } = {}) {
  const listeners = new Map<string, Listener[]>();
  const docListeners = new Map<string, Listener[]>();
  const update = vi.fn(() => Promise.resolve());
  const active = { postMessage: vi.fn() };
  const registration = { update, active } as unknown as ServiceWorkerRegistration;
  const register = vi.fn(() => Promise.resolve(registration));

  const container = {
    controller,
    register,
    ready: Promise.resolve(registration),
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
  };
  vi.stubGlobal('navigator', { serviceWorker: container });

  let visibility = 'visible';
  vi.stubGlobal('document', {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (type: string, fn: Listener) => {
      docListeners.set(type, [...(docListeners.get(type) ?? []), fn]);
    },
  });

  const reload = vi.fn();
  const windowListeners = new Map<string, Listener[]>();
  vi.stubGlobal('window', {
    location: { reload },
    addEventListener: (type: string, fn: Listener) => {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]);
    },
  });
  vi.stubGlobal('PerformanceObserver', undefined);
  vi.stubGlobal('performance', { getEntriesByType: () => [] });

  const fire = (map: Map<string, Listener[]>, type: string) => {
    for (const fn of map.get(type) ?? []) fn();
  };
  return {
    register,
    update,
    reload,
    load: () => fire(windowListeners, 'load'),
    resume: () => fire(docListeners, 'visibilitychange'),
    takeOver: () => fire(listeners, 'controllerchange'),
    hide: () => {
      visibility = 'hidden';
    },
    /** Let the promise chain inside `register` settle. */
    settle: () => new Promise((done) => setTimeout(done, 0)),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('whether it registers at all', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stays out of the way in development', async () => {
    // A worker in front of the dev server serves yesterday's module while you
    // are editing today's, which is an afternoon of a change not taking effect.
    const sw = stub();
    registerServiceWorker(false);
    sw.load();
    await sw.settle();
    expect(sw.register).not.toHaveBeenCalled();
  });

  it('registers on a built site', async () => {
    const sw = stub();
    registerServiceWorker(true);
    sw.load();
    await sw.settle();
    expect(sw.register).toHaveBeenCalledWith('./sw.js');
  });
});

describe('picking up a new build', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks for one every time the app comes back to the foreground', async () => {
    // The whole reason this exists. Installed on a phone, the app is resumed
    // from the app switcher rather than navigated to, and the browser only
    // checks for a new worker on a navigation — so without this, nothing ever
    // asks and somebody keeps a build from before the convention.
    const sw = stub({ controller: {} });
    registerServiceWorker(true);
    sw.load();
    await sw.settle();
    expect(sw.update).not.toHaveBeenCalled();
    sw.resume();
    expect(sw.update).toHaveBeenCalledTimes(1);
    sw.resume();
    expect(sw.update).toHaveBeenCalledTimes(2);
  });

  it('does not ask while the app is in the background', async () => {
    // `visibilitychange` fires on the way out as well as the way in, and
    // checking then spends a request nobody is waiting on.
    const sw = stub({ controller: {} });
    registerServiceWorker(true);
    sw.load();
    await sw.settle();
    sw.hide();
    sw.resume();
    expect(sw.update).not.toHaveBeenCalled();
  });

  it('reloads when a new worker takes over', async () => {
    const sw = stub({ controller: {} });
    registerServiceWorker(true);
    sw.load();
    await sw.settle();
    sw.takeOver();
    expect(sw.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on the first install, which also changes the controller', async () => {
    // `clients.claim()` fires `controllerchange` going from no worker to one.
    // That is not a new version arriving, and reloading for it means every
    // first visit to the site reloads itself in front of the person.
    const sw = stub({ controller: null });
    registerServiceWorker(true);
    sw.load();
    await sw.settle();
    sw.takeOver();
    expect(sw.reload).not.toHaveBeenCalled();
  });

  it('reloads once and never again', async () => {
    // The failure that matters. `controllerchange` can fire again while the
    // page is already on its way out, and an app that reloads itself forever
    // cannot be used and cannot easily be got rid of.
    const sw = stub({ controller: {} });
    registerServiceWorker(true);
    sw.load();
    await sw.settle();
    sw.takeOver();
    sw.takeOver();
    sw.takeOver();
    expect(sw.reload).toHaveBeenCalledTimes(1);
  });

  it('survives being offline when it asks', async () => {
    // Which is the state this whole file exists for. A rejected update must not
    // reach anybody as an unhandled rejection.
    const sw = stub({ controller: {} });
    sw.update.mockRejectedValueOnce(new Error('offline'));
    registerServiceWorker(true);
    sw.load();
    await sw.settle();
    expect(() => sw.resume()).not.toThrow();
    await sw.settle();
  });
});
