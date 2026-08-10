/**
 * The device's position, and the four ways of not having it.
 *
 * The failure paths matter more here than the happy one. A refusal, a timeout
 * indoors, a browser without geolocation and a page served over plain HTTP all
 * look identical from the outside — no position — and the panel can only
 * explain which happened if this hook distinguishes them.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deviceMessage,
  useDeviceLocation,
  useLocationGranted,
  type DeviceStatus,
} from './useDeviceLocation';

type SuccessFn = Parameters<Geolocation['watchPosition']>[0];
type ErrorFn = NonNullable<Parameters<Geolocation['watchPosition']>[1]>;
type Options = PositionOptions | undefined;

/**
 * Node's unhandled-rejection channel, typed just enough to listen on.
 *
 * There is no DOM way to see this from inside a test, and what is being
 * asserted is exactly that a rejected promise never reaches it.
 */
const node = globalThis as unknown as {
  process: {
    on(event: 'unhandledRejection', fn: (reason: unknown) => void): void;
    off(event: 'unhandledRejection', fn: (reason: unknown) => void): void;
  };
};

/**
 * A geolocation whose callbacks this test fires by hand, so a watch can be made
 * to answer late, twice, or not at all.
 */
function stubGeolocation() {
  const watchers = new Map<number, { onSuccess: SuccessFn; onError: ErrorFn; options?: Options }>();
  let nextId = 1;
  const cleared: number[] = [];

  const geolocation = {
    watchPosition: vi.fn((onSuccess: SuccessFn, onError: ErrorFn, options?: Options) => {
      const id = nextId++;
      watchers.set(id, { onSuccess, onError, options });
      return id;
    }),
    clearWatch: vi.fn((id: number) => {
      cleared.push(id);
      watchers.delete(id);
    }),
    getCurrentPosition: vi.fn(),
  };

  vi.stubGlobal('navigator', { ...navigator, geolocation });
  vi.stubGlobal('isSecureContext', true);

  return {
    geolocation,
    cleared,
    /** The options the Nth watch was opened with. */
    asked: (n: number): Options => geolocation.watchPosition.mock.calls[n]?.[2],
    report(lat: number, lng: number, accuracy: number) {
      for (const { onSuccess } of watchers.values()) {
        act(() =>
          onSuccess({
            coords: { latitude: lat, longitude: lng, accuracy },
            timestamp: 0,
          } as GeolocationPosition),
        );
      }
    },
    fail(code: number) {
      for (const { onError } of watchers.values()) {
        act(() =>
          onError({
            code,
            message: '',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError),
        );
      }
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('useDeviceLocation', () => {
  it('asks the browser for nothing until something wants a position', () => {
    const device = stubGeolocation();
    const { result } = renderHook(() => useDeviceLocation(false));

    expect(device.geolocation.watchPosition).not.toHaveBeenCalled();
    expect(result.current).toEqual({ status: 'idle', fix: null });
  });

  it('watches rather than samples, so the position can follow you', () => {
    const device = stubGeolocation();
    const { result } = renderHook(() => useDeviceLocation(true));

    expect(device.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(device.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(result.current.status).toBe('locating');

    device.report(39.766, -86.165, 30);
    expect(result.current).toEqual({
      status: 'ready',
      fix: { position: { lat: 39.766, lng: -86.165 }, accuracy: 30 },
    });

    // A second reading replaces the first: this is what moves the route.
    device.report(39.767, -86.164, 12);
    expect(result.current.fix).toEqual({ position: { lat: 39.767, lng: -86.164 }, accuracy: 12 });
  });

  it('stops watching when nothing needs the position any more', () => {
    const device = stubGeolocation();
    const { rerender, result } = renderHook(({ active }) => useDeviceLocation(active), {
      initialProps: { active: true },
    });
    device.report(39.766, -86.165, 30);

    rerender({ active: false });
    expect(device.cleared).toHaveLength(1);
    expect(result.current).toEqual({ status: 'idle', fix: null });
  });

  it('stops watching when it unmounts', () => {
    const device = stubGeolocation();
    const { unmount } = renderHook(() => useDeviceLocation(true));
    unmount();
    expect(device.cleared).toHaveLength(1);
  });

  it('separates a refusal from a failure, because the advice differs', () => {
    const denied = stubGeolocation();
    const { result } = renderHook(() => useDeviceLocation(true));
    denied.fail(1); // PERMISSION_DENIED
    expect(result.current).toEqual({ status: 'denied', fix: null });

    vi.unstubAllGlobals();

    const failed = stubGeolocation();
    const second = renderHook(() => useDeviceLocation(true));
    failed.fail(3); // TIMEOUT
    expect(second.result.current.status).toBe('error');
  });

  it('keeps a reading it already has when the next one fails', () => {
    // Indoors the watch times out repeatedly while still knowing roughly where
    // you are. Blanking the route on each timeout would make it useless.
    const device = stubGeolocation();
    const { result } = renderHook(() => useDeviceLocation(true));

    device.report(39.766, -86.165, 30);
    device.fail(3);

    expect(result.current.status).toBe('ready');
    expect(result.current.fix).toEqual({ position: { lat: 39.766, lng: -86.165 }, accuracy: 30 });
  });

  it('does not ask at all over plain HTTP, where the browser would refuse', () => {
    // The dev server's LAN address — the one you open on a phone to try this on
    // the actual campus — is not a secure context, and the failure there is
    // silent unless it is named.
    const device = stubGeolocation();
    vi.stubGlobal('isSecureContext', false);

    const { result } = renderHook(() => useDeviceLocation(true));
    expect(result.current).toEqual({ status: 'insecure', fix: null });
    expect(device.geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it('reports a browser with no geolocation at all', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('isSecureContext', true);

    const { result } = renderHook(() => useDeviceLocation(true));
    expect(result.current).toEqual({ status: 'unavailable', fix: null });
  });

  it('spends GPS on following a route and network fixes on everything else', () => {
    // A phone carried round a convention all day cannot run a high-accuracy
    // watch to keep a rounded walking time beside a search result up to date.
    // The times are snapped to a doorway and printed to the minute; a coarse
    // reading two minutes old answers them exactly as well.
    const device = stubGeolocation();
    const { rerender } = renderHook(({ precise }) => useDeviceLocation(true, precise), {
      initialProps: { precise: true },
    });
    expect(device.asked(0)).toMatchObject({ enableHighAccuracy: true });

    rerender({ precise: false });
    const relaxed = device.asked(1)!;
    expect(relaxed).toMatchObject({ enableHighAccuracy: false });
    expect(relaxed.maximumAge!).toBeGreaterThan(60_000);
  });
});

describe('useLocationGranted', () => {
  /** A permissions API whose answer this test chooses, and can change later. */
  function stubPermissions(state: PermissionState | null) {
    const listeners = new Set<() => void>();
    const permission = {
      state,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    const query = vi.fn(() => (state === null ? Promise.reject(new TypeError()) : Promise.resolve(permission)));
    vi.stubGlobal('navigator', { ...navigator, permissions: { query } });
    return {
      query,
      settle: () => act(async () => undefined),
      becomes(next: PermissionState) {
        permission.state = next;
        act(() => listeners.forEach((fn) => fn()));
      },
      listening: () => listeners.size,
    };
  }

  it('says yes only when the permission is already standing', async () => {
    // The whole point: this is what lets a position be *used* without one being
    // *asked for*. Granted means somebody already said yes to this site, so
    // reading a position now raises no dialog and surprises nobody.
    const allowed = stubPermissions('granted');
    const { result } = renderHook(() => useLocationGranted());
    await allowed.settle();
    expect(result.current).toBe(true);

    vi.unstubAllGlobals();
    const asking = stubPermissions('prompt');
    const second = renderHook(() => useLocationGranted());
    await asking.settle();
    expect(second.result.current).toBe(false);
  });

  it('asks the standing question rather than requesting a position', async () => {
    const allowed = stubPermissions('granted');
    renderHook(() => useLocationGranted());
    await allowed.settle();
    expect(allowed.query).toHaveBeenCalledWith({ name: 'geolocation' });
  });

  it('lets go the moment the permission is revoked', async () => {
    // Revoking in the browser's site settings has to turn the watch off then,
    // not at the next reload.
    const allowed = stubPermissions('granted');
    const { result } = renderHook(() => useLocationGranted());
    await allowed.settle();
    expect(result.current).toBe(true);

    allowed.becomes('denied');
    expect(result.current).toBe(false);
  });

  it('stops following the answer when it unmounts', async () => {
    const allowed = stubPermissions('granted');
    const { unmount } = renderHook(() => useLocationGranted());
    await allowed.settle();
    expect(allowed.listening()).toBe(1);
    unmount();
    expect(allowed.listening()).toBe(0);
  });

  it('does not take up the answer that arrives after it has gone', async () => {
    // `permissions.query` is a promise, so a component that mounts and unmounts
    // before it settles would otherwise add a listener that the cleanup has
    // already run past — and hold a dead component alive for the life of the
    // page.
    const allowed = stubPermissions('granted');
    const { unmount } = renderHook(() => useLocationGranted());
    unmount();
    await allowed.settle();
    expect(allowed.listening()).toBe(0);
  });

  it('says no on a browser that cannot answer', async () => {
    // Safari only gained this in 16. Being wrong in the cautious direction
    // costs a walking time that is not shown, which is the right way round.
    vi.stubGlobal('navigator', {});
    const bare = renderHook(() => useLocationGranted());
    expect(bare.result.current).toBe(false);

    vi.unstubAllGlobals();
    const refuses = stubPermissions(null);
    // A refusal has to be swallowed, not merely survived. An unhandled
    // rejection is a red console on every load of a Safari that has the method
    // and not the permission name — the app works, and looks broken.
    const loose: unknown[] = [];
    const note = (reason: unknown) => loose.push(reason);
    node.process.on('unhandledRejection', note);
    const { result } = renderHook(() => useLocationGranted());
    await refuses.settle();
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    node.process.off('unhandledRejection', note);
    expect(loose).toEqual([]);
    expect(result.current).toBe(false);
  });
});

describe('deviceMessage', () => {
  it('says nothing when there is nothing to explain', () => {
    expect(deviceMessage('idle')).toBeNull();
    expect(deviceMessage('ready')).toBeNull();
  });

  it('explains every state that leaves the route undrawn', () => {
    const unexplained: DeviceStatus[] = ['locating', 'denied', 'unavailable', 'insecure', 'error'];
    for (const status of unexplained) {
      expect(deviceMessage(status), status).toBeTruthy();
    }
  });

  it('points at the way out that still works', () => {
    // Every dead end offers the map, which needs no permission from anyone.
    for (const status of ['denied', 'unavailable', 'insecure', 'error'] as const) {
      expect(deviceMessage(status), status).toContain('map');
    }
  });
});
