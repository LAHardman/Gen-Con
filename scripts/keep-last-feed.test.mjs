/**
 * Keeping the last published schedule when the import fails.
 *
 * What matters is that a bad answer (an error page, an empty schedule, no
 * network) never becomes the schedule, and that an existing file is never
 * replaced by the old one.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isUsableFeed, keepLastFeed } from './keep-last-feed.mjs';

const packed = { format: 'columns-1', count: 2, columns: { id: [0, 1] }, keys: { id: ['a', 'b'] } };
const plain = { events: [{ id: 'E1' }] };
const answer = (body, status = 200) => async () => new Response(body, { status });

async function target() {
  return join(await mkdtemp(join(tmpdir(), 'feed-')), 'public', 'events.json');
}

const read = (path) => readFile(path, 'utf8').catch(() => null);

describe('what counts as a usable feed', () => {
  it('accepts packed and plain feeds with events', () => {
    expect(isUsableFeed(packed)).toBe(true);
    expect(isUsableFeed(plain)).toBe(true);
  });

  it('rejects empty, malformed and unrelated JSON', () => {
    expect(isUsableFeed({ events: [] })).toBe(false);
    expect(isUsableFeed({ ...packed, count: 0 })).toBe(false);
    expect(isUsableFeed({ format: 'columns-1' })).toBe(false);
    expect(isUsableFeed(null)).toBe(false);
    expect(isUsableFeed({ hello: 'world' })).toBe(false);
  });
});

describe('seeding public/events.json from the published copy', () => {
  it('keeps a good published schedule', async () => {
    const output = await target();
    await keepLastFeed({ url: 'x', output, fetchImpl: answer(JSON.stringify(packed)) });
    expect(JSON.parse(await read(output))).toEqual(packed);
  });

  it('writes nothing for a 404, an error page, an empty feed or a dead network', async () => {
    for (const fetchImpl of [
      answer('nope', 404),
      answer('<html>Not found</html>'),
      answer(JSON.stringify({ events: [] })),
      async () => {
        throw new Error('offline');
      },
    ]) {
      const output = await target();
      await keepLastFeed({ url: 'x', output, fetchImpl });
      expect(await read(output)).toBeNull();
    }
  });

  it('never replaces a file that is already there', async () => {
    const output = await target();
    await keepLastFeed({ url: 'x', output, fetchImpl: answer(JSON.stringify(plain)) });
    await writeFile(output, 'fresh import');
    await keepLastFeed({ url: 'x', output, fetchImpl: answer(JSON.stringify(packed)) });
    expect(await read(output)).toBe('fresh import');
  });
});
