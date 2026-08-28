/**
 * The pack reader, tested on its refusals.
 *
 * The reading is trivial; the *refusing* is the feature. Every case here is
 * a way a copy of this app that can never update again could be handed
 * something half-right — and the assertion is always that it answers "keep
 * the snapshot" rather than a best effort, because a working snapshot
 * exchanged for a misread download is a broken app with no way back.
 */

import { describe, expect, it } from 'vitest';
import { PACK_SCHEMA, readManifest, staleTables } from './pack';

const table = { hash: 'abcdef0123456789', bytes: 100 };
const good = { schema: PACK_SCHEMA, tables: { exhibitors: table } };

describe('reading a manifest', () => {
  it('reads a well-formed one, ignoring fields it has never heard of', () => {
    const read = readManifest({ ...good, someFutureField: true });
    expect(read).not.toBeNull();
    expect(read!.tables.exhibitors.hash).toBe(table.hash);
  });

  it('refuses a future schema wholesale rather than half-reading it', () => {
    // The contract that makes bumping the schema safe for installed copies:
    // an old reader keeps its snapshot, it does not guess.
    expect(readManifest({ ...good, schema: PACK_SCHEMA + 1 })).toBeNull();
  });

  it('refuses everything a broken host could serve as a manifest', () => {
    expect(readManifest(null)).toBeNull();
    expect(readManifest('<!doctype html>')).toBeNull();
    expect(readManifest({})).toBeNull();
    expect(readManifest({ schema: PACK_SCHEMA })).toBeNull();
    // One malformed table poisons the whole manifest — a partial read would
    // refresh some tables against a source already known to be wrong.
    expect(readManifest({ ...good, tables: { exhibitors: { hash: 'short', bytes: 1 } } })).toBeNull();
    expect(readManifest({ ...good, tables: { exhibitors: { hash: table.hash, bytes: 0 } } })).toBeNull();
  });
});

describe('deciding what to fetch', () => {
  it('names what moved and only what moved', () => {
    const remote = {
      schema: PACK_SCHEMA,
      tables: { exhibitors: table, partners: { hash: '0123456789abcdef', bytes: 5 } },
    };
    expect(staleTables({ exhibitors: table }, remote)).toEqual(['partners']);
    expect(staleTables(remote.tables, remote)).toEqual([]);
  });

  it('offers a table this build has never held, for the reader that may exist', () => {
    expect(staleTables({}, good)).toEqual(['exhibitors']);
  });
});
