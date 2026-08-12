/**
 * The hand-written ties, checked against the data they claim to describe.
 *
 * A table of hand-written answers rots in one direction: the world moves and
 * nobody notices, because a stale alias fails by quietly doing nothing. These
 * tests are the noticing. They run against the real `partners.ts` and
 * `lodging.ts`, so a hotel that leaves the block or a building that leaves the
 * hotel list fails the build rather than the page.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { auditAliases, NOT_IN_BLOCK, TIES } from './block-aliases.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const partners = [
  ...read('src/data/partners.ts').matchAll(
    /blockName: ("(?:[^"\\]|\\.)*"), placeId: (null|'[^']+')/g,
  ),
].map((row) => ({
  blockName: JSON.parse(row[1]),
  placeId: row[2] === 'null' ? null : row[2].slice(1, -1),
}));

const places = [
  ...read('src/data/lodging.ts').matchAll(
    /\{ id: '([^']+)', name: ("(?:[^"\\]|\\.)*"), kind: '([^']+)', metres: (\d+)/g,
  ),
].map((row) => ({
  id: row[1],
  name: JSON.parse(row[2]),
  kind: row[3],
  metres: Number(row[4]),
}));

const byId = new Map(places.map((place) => [place.id, place]));

describe('the alias table', () => {
  it('reads both files it is written against', () => {
    expect(partners.length).toBeGreaterThan(50);
    expect(places.length).toBeGreaterThan(100);
  });

  it('agrees with the block and the hotel list as they stand', () => {
    expect(
      auditAliases(
        partners.map((one) => one.blockName),
        places.map((one) => one.id),
      ),
    ).toEqual([]);
  });

  it('names a hotel that is really in the block', () => {
    // The audit is only as good as its inputs, so prove it can fail.
    expect(auditAliases([], places.map((one) => one.id)).length).toBe(Object.keys(TIES).length);
  });

  it('names a building that is really in the hotel list', () => {
    const withPlace = Object.values(TIES).filter((tie) => tie.placeId).length;
    expect(auditAliases(partners.map((one) => one.blockName), []).length).toBe(
      withPlace + Object.keys(NOT_IN_BLOCK).length,
    );
  });

  it('refuses to give one building to two hotels', () => {
    expect(
      auditAliases(
        ['Somewhere', 'Somewhere Else'],
        ['way1'],
        { Somewhere: { placeId: 'way1', why: '…' }, 'Somewhere Else': { placeId: 'way1', why: '…' } },
        {},
      ),
    ).toEqual(['way1 is claimed by both Somewhere and Somewhere Else']);
  });

  it('refuses to both tie a hotel and excuse it', () => {
    expect(
      auditAliases(
        ['Somewhere'],
        ['way1'],
        { Somewhere: { placeId: 'way1', why: '…' } },
        { way1: 'not in the block' },
      ),
    ).toEqual(['way1 is tied to Somewhere and excused from the block at the same time']);
  });

  it('lets a checked "this app has not got it" pass', () => {
    // `placeId: null` is an answer, not a gap — it must not look like a fault.
    expect(auditAliases(['Somewhere'], [], { Somewhere: { placeId: null, why: '…' } }, {})).toEqual([]);
  });

  it('was actually applied — every tie is in the generated file', () => {
    for (const [blockName, tie] of Object.entries(TIES)) {
      const partner = partners.find((one) => one.blockName === blockName);
      expect(partner, blockName).toBeDefined();
      expect(partner.placeId, blockName).toBe(tie.placeId);
    }
  });

  it('explains every entry, because a bare id cannot be checked by the next person', () => {
    for (const [blockName, tie] of Object.entries(TIES)) {
      expect(tie.why, blockName).toMatch(/\w/);
      expect(tie.why.length, blockName).toBeGreaterThan(30);
    }
    for (const [placeId, why] of Object.entries(NOT_IN_BLOCK)) {
      expect(why.length, placeId).toBeGreaterThan(30);
    }
  });

  it('ties downtown hotels to downtown buildings', () => {
    // A plausible-looking id from the wrong side of the city is the failure
    // mode a name-based check cannot see, and distance can.
    const downtown = ['Hotel Indy', 'The Alexander Hotel', 'Sheraton Indianapolis City Center Hotel'];
    for (const name of downtown) {
      expect(byId.get(TIES[name].placeId).metres, name).toBeLessThan(1600);
    }
  });

  it('excuses hotels that exist and are walkable', () => {
    for (const placeId of Object.keys(NOT_IN_BLOCK)) {
      const place = byId.get(placeId);
      expect(place, placeId).toBeDefined();
      // Only walkable hotels are ever suspected, so an excuse for anything else
      // is an excuse nothing will ever ask for.
      expect(place.metres, place.name).toBeLessThan(1600);
    }
  });

  it('leaves nothing merely suspected', () => {
    // The whole point: with the table filled in, no walkable hotel is still a
    // maybe. If this fails, `fetch-block-rates.mjs` printed the names to add.
    expect(read('src/data/partners.ts')).toContain('SUSPECTED_IN_BLOCK: ReadonlySet<string> = new Set([])');
  });
});
