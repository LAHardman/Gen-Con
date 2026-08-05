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

import { deviceMessage, useDeviceLocation, type DeviceStatus } from './useDeviceLocation';

type SuccessFn = Parameters<Geolocation['watchPosition']>[0];
type ErrorFn = NonNullable<Parameters<Geolocation['watchPosition']>[1]>;

/**
 * A geolocation whose callbacks this test fires by hand, so a watch can be made
 * to answer late, twice, or not at all.
 */
function stubGeolocation() {
  const watchers = new Map<number, { onSuccess: SuccessFn; onError: ErrorFn }>();
  let nextId = 1;
  const cleared: number[] = [];

  const geolocation = {
    watchPosition: vi.fn((onSuccess: SuccessFn, onError: ErrorFn) => {
      const id = nextId++;
      watchers.set(id, { onSuccess, onError });
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
