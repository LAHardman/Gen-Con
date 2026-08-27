/**
 * The pack's fetch-verify-store loop, driven against a fake cache and host.
 *
 * What matters here is the all-or-nothing: a refresh must never leave the
 * stored pack describing tables it does not verifiably hold, because the
 * next launch trusts it blind — and the boot stash must hand the data
 * modules only tables their own guards accept. Every failure case asserts
 * the same outcome, "the snapshot still rules", which is the promise a copy
 * that can never update again lives on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStoredPack, refreshPack } from './pack-store';
import { packTable, stashPack } from './pack-runtime';
import { PACK_SCHEMA } from './pack';

/* ------------------------------------------------- a fake cache and host */

class FakeCache {
  store = new Map<string, { body: string; type: string }>();
  async match(key: string) {
    const held = this.store.get(key);
    return held ? new Response(held.body, { headers: { 'content-type': held.type } }) : undefined;
  }
  async put(key: string, response: Response) {
    this.store.set(key, {
      body: await response.text(),
      type: response.headers.get('content-type') ?? '',
    });
  }
}

let packCache: FakeCache;

// The same digest the module computes, so the fixtures are honest — and no
// node: import, which this tsconfig deliberately does not type.
async function sha16(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

const TABLE = JSON.stringify({ tags: ['X'], exhibitors: [{ name: 'A', kind: 'K', area: 'Ar', spot: 'S' }] });
const manifestFor = async (body: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: PACK_SCHEMA,
    tables: { exhibitors: { hash: await sha16(body), bytes: body.length } },
    ...over,
  });

/** The published pack, served by URL suffix. */
function host(files: Record<string, string | number>) {
  return vi.fn(async (url: string) => {
    const name = Object.keys(files).find((file) => url.endsWith(file));
    const held = name === undefined ? undefined : files[name];
    if (held === undefined) return new Response('', { status: 404 });
    return typeof held === 'number' ? new Response('', { status: held }) : new Response(held);
  });
}

beforeEach(() => {
  packCache = new FakeCache();
  vi.stubGlobal('caches', { open: async () => packCache });
  stashPack({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------- the tests */

describe('refreshing the pack', () => {
  it('stores what moved and hands it to the next launch', async () => {
    vi.stubGlobal('fetch', host({ 'manifest.json': await manifestFor(TABLE), 'exhibitors.json': TABLE }));
    expect(await refreshPack()).toBe('updated');
    const stored = await loadStoredPack();
    expect(stored.exhibitors).toEqual(JSON.parse(TABLE));
  });

  it('does nothing when nothing moved, without fetching a table', async () => {
    const fetcher = host({ 'manifest.json': await manifestFor(TABLE), 'exhibitors.json': TABLE });
    vi.stubGlobal('fetch', fetcher);
    await refreshPack();
    fetcher.mockClear();
    expect(await refreshPack()).toBe('kept');
    // One request — the manifest — and not a byte of table.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refuses a table whose bytes do not match the manifest', async () => {
    // A truncated or tampered download must never become the next launch's
    // data; the held manifest stays describing what is actually held.
    vi.stubGlobal(
      'fetch',
      host({ 'manifest.json': await manifestFor(TABLE), 'exhibitors.json': TABLE.slice(0, 40) }),
    );
    expect(await refreshPack()).toBe('kept');
    expect(await loadStoredPack()).toEqual({});
  });

  it('refuses a manifest from a schema this build does not know', async () => {
    const fetcher = host({
      'manifest.json': await manifestFor(TABLE, { schema: PACK_SCHEMA + 1 }),
      'exhibitors.json': TABLE,
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await refreshPack()).toBe('kept');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps the snapshot when the host is gone, which is the state it is for', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await refreshPack()).toBe('kept');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network down'))));
    expect(await refreshPack()).toBe('kept');
  });

  it('reports where there is no cache to store into', async () => {
    vi.unstubAllGlobals();
    // jsdom has no `caches` unless a test stubs one.
    expect(await refreshPack()).toBe('skipped');
    expect(await loadStoredPack()).toEqual({});
  });
});

describe('the boot stash', () => {
  const isTable = (raw: unknown): raw is { rows: number } =>
    !!raw && typeof (raw as { rows?: unknown }).rows === 'number';

  it('hands a module its table only when the module’s own guard accepts it', () => {
    stashPack({ good: { rows: 3 }, bad: { rows: 'three' } });
    expect(packTable('good', isTable)).toEqual({ rows: 3 });
    // The shape gate: bytes that arrived intact and parse as JSON can still
    // be the wrong shape, and the answer is the snapshot, not a half-read.
    expect(packTable('bad', isTable)).toBeNull();
    expect(packTable('absent', isTable)).toBeNull();
  });
});
