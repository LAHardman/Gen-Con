/**
 * The mirror's rules, which are mostly about what it refuses.
 *
 * What it stores may be the last copy of the schedule anybody ever sees — that
 * is the entire reason it exists — so the interesting behaviour is not serving
 * a file, it is declining to replace a good file with a bad one, and declining
 * to let anybody but the deploy replace it at all.
 */

import { describe, expect, it } from 'vitest';
import worker from './worker.js';

/** A KV namespace, in a Map. */
const kv = (start = {}) => {
  const store = new Map(Object.entries(start));
  return {
    store,
    async get(key, kind) {
      const value = store.get(key);
      if (value === undefined) return null;
      return kind === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
};

const feed = (n) => JSON.stringify({
  source: { name: 'x', url: 'y' },
  year: 2026,
  events: Array.from({ length: n }, (_, i) => ({ id: `E${i}`, title: 't', start: '2026-07-30T10:00:00-04:00' })),
});

const call = (method, path, { body, token, env } = {}) => worker.fetch(
  new Request(`https://mirror.example${path}`, {
    method,
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }),
  env ?? { SCHEDULE: kv(), UPLOAD_SECRET: 'letmein' },
);

describe('handing the schedule out', () => {
  it('lets a browser on any origin read it, which is the whole point', async () => {
    // The app is served from a different origin to this one. Without this
    // header the mirror is unreadable and therefore useless.
    const env = { SCHEDULE: kv({ 'events.json': feed(2000) }), UPLOAD_SECRET: 's' };
    const response = await call('GET', '/events.json', { env });
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await response.json()).events).toHaveLength(2000);
  });

  it('answers the preflight, so a cross-origin PUT is possible at all', async () => {
    const response = await call('OPTIONS', '/events.json');
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
  });

  it('says so plainly when it has nothing yet', async () => {
    const response = await call('GET', '/events.json');
    expect(response.status).toBe(404);
  });

  it('reports what it is holding and how stale it is', async () => {
    // So that "the mirror is fine" is checkable without downloading 8.5 MB.
    const stored = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const env = {
      SCHEDULE: kv({ 'events.meta': JSON.stringify({ events: 27467, year: 2026, storedAt: stored }) }),
      UPLOAD_SECRET: 's',
    };
    const body = await (await call('GET', '/health', { env })).json();
    expect(body.events).toBe(27467);
    expect(body.ageHours).toBe(48);
  });
});

describe('what it refuses to store', () => {
  it('turns away an upload with no secret', async () => {
    const response = await call('PUT', '/events.json', { body: feed(2000) });
    expect(response.status).toBe(401);
  });

  it('turns away an upload with the wrong secret', async () => {
    const response = await call('PUT', '/events.json', { body: feed(2000), token: 'letmeinn' });
    expect(response.status).toBe(401);
  });

  it('turns away every upload when no secret is configured', async () => {
    // A worker deployed without its secret set must be closed, not open. The
    // opposite — treating "no secret" as "no check" — is how a mirror becomes
    // anybody's to overwrite.
    const env = { SCHEDULE: kv(), UPLOAD_SECRET: undefined };
    const response = await call('PUT', '/events.json', { body: feed(2000), token: '', env });
    expect(response.status).toBe(401);
  });

  it('refuses a short feed rather than replacing a good one with it', async () => {
    // The failure this exists for. A fetch that half worked produces a feed
    // that parses, has the right shape, and is missing most of the convention —
    // and here that would overwrite the last good copy in existence.
    const env = { SCHEDULE: kv({ 'events.json': feed(27467) }), UPLOAD_SECRET: 'letmein' };
    const response = await call('PUT', '/events.json', { body: feed(12), token: 'letmein', env });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('12 events');
    // And the good copy is still there.
    expect(JSON.parse(env.SCHEDULE.store.get('events.json')).events).toHaveLength(27467);
  });

  it('refuses something that is not a feed at all', async () => {
    const env = { SCHEDULE: kv(), UPLOAD_SECRET: 'letmein' };
    for (const body of ['not json at all', JSON.stringify({ nope: true })]) {
      expect((await call('PUT', '/events.json', { body, token: 'letmein', env })).status).toBe(400);
    }
  });

  it('stores a good one, and records what it stored', async () => {
    const env = { SCHEDULE: kv(), UPLOAD_SECRET: 'letmein' };
    const response = await call('PUT', '/events.json', { body: feed(27467), token: 'letmein', env });
    expect(response.status).toBe(200);
    expect((await response.json()).stored).toBe(27467);
    const meta = JSON.parse(env.SCHEDULE.store.get('events.meta'));
    expect(meta.events).toBe(27467);
    expect(meta.year).toBe(2026);
    expect(Date.parse(meta.storedAt)).toBeGreaterThan(0);
  });
});
