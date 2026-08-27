/**
 * The device import, driven end to end against a fake Gen Con.
 *
 * The decision is tested next door; this is the rest of the path — decide,
 * page, verify, store, and be readable again on the next launch — because
 * each piece passing on its own is not the same as the chain working, and
 * this chain is the one that runs when nothing else can.
 *
 * The property under test throughout is that a failure keeps what was
 * already held. An installed copy that trades a working schedule for a
 * half-imported one has no way back: there is no host left to re-fetch
 * from, which is why it was importing in the first place.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOGUE_API } from '../lib/import-events';

/** A store that keeps what it is given, like the native filesystem does. */
function fakeStore() {
  const held = new Map<string, string>();
  return {
    held,
    available: () => true,
    read: async (key: string) => held.get(key) ?? null,
    write: async (key: string, value: string) => {
      held.set(key, value);
    },
  };
}

/** Gen Con, as two events over one day. */
function fakeGenCon(over: { total?: number; records?: number } = {}) {
  const total = over.total ?? 2;
  const records = Array.from({ length: over.records ?? total }, (_, i) => ({
    _source: {
      game_code: `BGM26ND${i}`,
      title: `Event ${i}`,
      event_type: 'BGM - Board Game',
      location: 'ICC',
      room_name: 'Hall A',
      start_date: `2026-07-30T1${i}:00:00.000-04:00`,
    },
  }));
  return vi.fn(async (url: string) => {
    if (url.includes('meta_days')) return { status: 200, body: { 1: 'Thursday' } };
    if (url.includes('day[]=1')) return { status: 200, body: { total_count: total, records } };
    if (url.startsWith(CATALOGUE_API)) return { status: 200, body: { total_count: total, records: [] } };
    return { status: 404, body: null };
  });
}

async function load(native: boolean, fetchJson: ReturnType<typeof fakeGenCon>, store = fakeStore()) {
  vi.doMock('../platform', () => ({ isNative: () => native }));
  vi.doMock('../platform/http', () => ({ fetchJson, fetchText: vi.fn() }));
  vi.doMock('../platform/storage', () => ({ packStore: store }));
  vi.resetModules();
  return { module: await import('./schedule-import'), store };
}

const stale = { online: true, feedAgeDays: 400, sinceLastAttemptDays: 400, unmetered: true };

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../platform');
  vi.doUnmock('../platform/http');
  vi.doUnmock('../platform/storage');
});

describe('importing on the device', () => {
  it('pages Gen Con, keeps the result, and reads it back on the next launch', async () => {
    const gencon = fakeGenCon();
    const { module } = await load(true, gencon);
    const result = await module.runDeviceImport({ circumstances: stale });

    expect(result.status).toBe('imported');
    expect(result.events).toBe(2);
    // What the next launch sees — the same events, through the same reader.
    const held = await module.storedFeed();
    expect(held?.events).toHaveLength(2);
    expect(held?.year).toBe(2026);
    expect(held?.source.name).toContain('this device');
  });

  it('records the attempt before the work, so a crash cannot become a loop', async () => {
    // An import that dies half-way must still count as today's try; the
    // alternative is a copy that retries 1,100 requests on every launch,
    // for ever, against somebody else's server.
    const { module, store } = await load(true, fakeGenCon({ total: 5, records: 1 }));
    const result = await module.runDeviceImport({ circumstances: stale });
    expect(result.status).toBe('failed');
    expect(await module.lastAttempt()).not.toBeNull();
    // And nothing was kept: a short schedule looks exactly like a full one.
    expect(store.held.has('events.json')).toBe(false);
    expect(await module.storedFeed()).toBeNull();
  });

  it('does not touch the network when the rules say no', async () => {
    const gencon = fakeGenCon();
    const { module } = await load(true, gencon);
    const result = await module.runDeviceImport({
      circumstances: { ...stale, feedAgeDays: 1 },
    });
    expect(result.status).toBe('refused');
    expect(gencon).not.toHaveBeenCalled();
  });

  it('never runs in a browser, whatever the circumstances', async () => {
    const gencon = fakeGenCon();
    const { module } = await load(false, gencon);
    const result = await module.runDeviceImport({ circumstances: { ...stale, asked: true } });
    expect(result.status).toBe('refused');
    expect(gencon).not.toHaveBeenCalled();
  });

  it('keeps the schedule it already had when Gen Con stops mid-import', async () => {
    const store = fakeStore();
    store.held.set(
      'events.json',
      JSON.stringify({ source: { name: 'earlier', url: 'x', fetchedAt: '2026-01-01T00:00:00Z' }, events: [{ id: 'A' }] }),
    );
    const dies = vi.fn(async (url: string) => {
      if (url.includes('meta_days')) return { status: 200, body: { 1: 'Thursday' } };
      if (url.includes('day[]=1')) throw new TypeError('the network went away');
      return { status: 200, body: { total_count: 2, records: [] } };
    });
    const { module } = await load(true, dies as never, store);
    expect((await module.runDeviceImport({ circumstances: stale })).status).toBe('failed');
    // The old schedule is still there, whole.
    expect((await module.storedFeed())?.events).toHaveLength(1);
  });
});
