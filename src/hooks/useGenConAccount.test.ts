/**
 * Where this copy signs in, and whether it can at all.
 *
 * The web app needs its own small server for this — gencon.com sends no
 * CORS header, its session cookie is `HttpOnly`, and it is `SameSite=Lax`,
 * three walls all deliberate — so the endpoints are same-origin. A native
 * shell is served from `file://` and has no origin to be relative to, which
 * makes "same-origin" a 404 dressed as a rejected password. That is the
 * failure worth pinning: a sign-in form that cannot work reads as a wrong
 * password, and somebody will retype it until they lock themselves out.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { stashPack } from '../data/pack-runtime';

afterEach(() => {
  stashPack({});
  vi.resetModules();
  vi.doUnmock('../platform');
});

/** Load the hook module with `isNative()` answering as told. */
async function withPlatform(native: boolean) {
  vi.doMock('../platform', () => ({ isNative: () => native }));
  vi.resetModules();
  return import('./useGenConAccount');
}

describe('where the sign-in endpoints are', () => {
  it('are same-origin on the web, exactly as before', async () => {
    const { accountBase, canSignIn } = await withPlatform(false);
    expect(accountBase()).toBe('');
    expect(canSignIn()).toBe(true);
  });

  it('are nowhere in a shell that has not been given a host', async () => {
    // And the panel says so, rather than offering a form that 404s.
    const { accountBase, canSignIn } = await withPlatform(true);
    expect(accountBase()).toBeNull();
    expect(canSignIn()).toBe(false);
  });

  it('are wherever the config says, once a shell has been given one', async () => {
    stashPack({
      config: {
        basemaps: {},
        rescues: null,
        eventsMirror: null,
        packHost: null,
        accountHost: 'https://gencontrip.example/',
      },
    });
    const { accountBase, canSignIn } = await withPlatform(true);
    // Trailing slash trimmed, because every caller appends one.
    expect(accountBase()).toBe('https://gencontrip.example');
    expect(canSignIn()).toBe(true);
  });
});
