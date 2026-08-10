/**
 * Where the device thinks it is, while something is asking.
 *
 * `watchPosition` rather than `getCurrentPosition`: a route from where you are
 * standing should follow you across the campus, and a single reading taken at
 * the exhibit hall doors is wrong by the time you have crossed the hall.
 *
 * NOTHING HERE EVER PROMPTS ON LOAD. A map of a convention centre has no
 * business asking for your whereabouts before you have asked it for anything.
 * The watch runs when a route has "my location" as one of its ends — which is
 * you asking — or when `useLocationGranted` reports that the permission was
 * already given, which is you having asked before. A permission already granted
 * raises no dialog, so the second case adds a use of your location and never a
 * question about it.
 *
 * PRECISION IS ASKED FOR ONLY WHEN IT IS NEEDED. Following somebody along a
 * route wants GPS and a fresh reading; putting a rough walking time beside a
 * search result does not — it is snapped to the nearest doorway and rounded to
 * a minute, so a cell-tower fix a minute old answers it just as well. Those are
 * very different amounts of battery to spend on a phone somebody is carrying
 * round a convention all day, so `precise` picks between them.
 */

import { useEffect, useState } from 'react';
import type { DeviceFix } from '../data/navigation';

export type DeviceStatus =
  /** Nothing has asked yet. */
  | 'idle'
  /** Asked, and no reading has arrived. */
  | 'locating'
  /** A fix is in hand — possibly an old one, while a newer is awaited. */
  | 'ready'
  /** The browser, or the operating system, refused. */
  | 'denied'
  /** The browser has no geolocation at all. */
  | 'unavailable'
  /** Served over plain HTTP, where browsers withhold geolocation entirely. */
  | 'insecure'
  /** It tried and could not: no signal indoors, or it timed out. */
  | 'error';

export interface DeviceLocation {
  status: DeviceStatus;
  fix: DeviceFix | null;
}

/**
 * How hard to work for a reading.
 *
 * `precise` is the route-following watch: GPS, and a reading no more than ten
 * seconds old, because the whole point is that the line keeps up with somebody
 * walking. The other is for the walking times beside search results, which are
 * snapped to the nearest doorway and printed to the minute — a two-minute-old
 * fix from the network changes none of them, and costs a fraction as much.
 */
const HOW_HARD = {
  precise: { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
  rough: { enableHighAccuracy: false, maximumAge: 120_000, timeout: 30_000 },
} as const;

export function useDeviceLocation(active: boolean, precise = true): DeviceLocation {
  const [state, setState] = useState<DeviceLocation>({ status: 'idle', fix: null });

  useEffect(() => {
    if (!active) {
      setState({ status: 'idle', fix: null });
      return;
    }

    if (!('geolocation' in navigator)) {
      setState({ status: 'unavailable', fix: null });
      return;
    }

    // Every browser withholds geolocation outside a secure context. The
    // published site is HTTPS, but the dev server's LAN address — the one you
    // open on a phone to try this on the actual campus — is not, and the
    // failure there is silent unless it is named.
    if (!window.isSecureContext) {
      setState({ status: 'insecure', fix: null });
      return;
    }

    setState((current) => ({ status: current.fix ? 'ready' : 'locating', fix: current.fix }));

    const watch = navigator.geolocation.watchPosition(
      (position) =>
        setState({
          status: 'ready',
          fix: {
            position: { lat: position.coords.latitude, lng: position.coords.longitude },
            accuracy: position.coords.accuracy,
          },
        }),
      (error) =>
        // A reading already in hand beats an error about the next one: indoors
        // the watch times out repeatedly while still knowing roughly where you
        // are, and blanking the route each time it did would be useless.
        setState((current) =>
          current.fix
            ? current
            : {
                status: error.code === error.PERMISSION_DENIED ? 'denied' : 'error',
                fix: null,
              },
        ),
      precise ? HOW_HARD.precise : HOW_HARD.rough,
    );

    return () => navigator.geolocation.clearWatch(watch);
  }, [active, precise]);

  return state;
}

/**
 * Whether this site already has permission to know where you are.
 *
 * The point of asking is to be able to *use* a location without *requesting*
 * one. `permissions.query` reports the standing answer without raising
 * anything: "granted" means somebody already said yes to this site, so reading
 * a position now shows no dialog and surprises nobody.
 *
 * It follows the answer rather than sampling it, so revoking the permission in
 * the browser's site settings turns the watch off in the same moment rather
 * than at the next reload.
 *
 * Where the query does not exist this stays false and everything carries on
 * behaving as it did — Safari only gained it in 16, and the cost of being wrong
 * in the cautious direction is a walking time that is not shown.
 */
export function useLocationGranted(): boolean {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let live = true;
    let permission: PermissionStatus | null = null;
    const onChange = () => {
      if (live && permission) setGranted(permission.state === 'granted');
    };

    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((state) => {
        // Unmounted before the promise settled: do not adopt the listener, or
        // it outlives the cleanup that was supposed to remove it.
        if (!live) return;
        permission = state;
        setGranted(state.state === 'granted');
        state.addEventListener('change', onChange);
      })
      // A browser that has the method but refuses the name. Nothing to do but
      // behave as though it were absent.
      .catch(() => undefined);

    return () => {
      live = false;
      permission?.removeEventListener('change', onChange);
    };
  }, []);

  return granted;
}

/** What to tell someone when there is no fix to draw a route from. */
export function deviceMessage(status: DeviceStatus): string | null {
  switch (status) {
    case 'locating':
      return 'Finding your location…';
    case 'denied':
      return 'Location is blocked for this site. Allow it in your browser’s site settings, or pick a starting point on the map instead.';
    case 'unavailable':
      return 'This browser can’t report a location. Pick a starting point on the map instead.';
    case 'insecure':
      return 'Location needs a secure (https) connection, so it is unavailable here. Pick a starting point on the map instead.';
    case 'error':
      return 'Couldn’t get a location — indoors this often fails. Pick a starting point on the map instead.';
    default:
      return null;
  }
}
