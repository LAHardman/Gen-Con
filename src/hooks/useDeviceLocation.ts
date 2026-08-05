/**
 * Where the device thinks it is, while something is asking.
 *
 * `watchPosition` rather than `getCurrentPosition`: a route from where you are
 * standing should follow you across the campus, and a single reading taken at
 * the exhibit hall doors is wrong by the time you have crossed the hall.
 *
 * The watch only runs while a route actually has "my location" as one of its
 * ends. Nothing here asks for permission on load: a map of a convention centre
 * has no business prompting for your position until you have asked it to take
 * you somewhere.
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

export function useDeviceLocation(active: boolean): DeviceLocation {
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
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );

    return () => navigator.geolocation.clearWatch(watch);
  }, [active]);

  return state;
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
