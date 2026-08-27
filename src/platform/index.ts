/**
 * The seam between the web app and the native shells.
 *
 * One codebase produces the website and both store apps, so everything that
 * genuinely differs between them lives behind these three modules and
 * nowhere else. Each exports one small interface with two implementations
 * chosen at runtime, so a component or a data module never asks which
 * platform it is on — the map, the search, the router and the schedule are
 * the same code in all three places, which is what keeps feature parity
 * from being a promise somebody has to keep by hand.
 *
 * What actually differs, and why each is here:
 *
 *   http     native requests leave from native code, so no CORS and no
 *            preflight. That is not a nicety: it is the whole reason a
 *            phone can import the schedule straight from gencon.com when
 *            this project's own hosting is gone.
 *   storage  the web has the Cache API, which a browser may evict under
 *            pressure; a native app has a filesystem, which it may not.
 *            An installed copy's last good pack must outlive a low-disk
 *            morning, so on native it is a file.
 *
 * `isNative()` is deliberately the only platform question the rest of the
 * app can ask, and almost nothing asks it.
 */

import { Capacitor } from '@capacitor/core';

/** Whether this copy is running inside a native shell rather than a browser. */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    // Tests, server-side rendering, anything without the bridge: the web
    // implementations are the safe answer everywhere.
    return false;
  }
}

export { fetchText, fetchJson } from './http';
export { packStore, type Store } from './storage';
