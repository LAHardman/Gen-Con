/** Where this copy signs in: same-origin unless the config names a host. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { stashPack } from '../data/pack-runtime';

afterEach(() => {
  stashPack({});
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  return import('./useGenConAccount');
}

describe('where the sign-in endpoints are', () => {
  it('are same-origin by default', async () => {
    const { accountBase, canSignIn } = await load();
    expect(accountBase()).toBe('');
    expect(canSignIn()).toBe(true);
  });

  it('are wherever the config says', async () => {
    stashPack({
      config: {
        basemaps: {},
        rescues: null,
        eventsMirror: null,
        packHost: null,
        accountHost: 'https://gencontrip.example/',
      },
    });
    const { accountBase, canSignIn } = await load();
    // Trailing slash trimmed, because every caller appends one.
    expect(accountBase()).toBe('https://gencontrip.example');
    expect(canSignIn()).toBe(true);
  });
});
