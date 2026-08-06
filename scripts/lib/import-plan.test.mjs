/**
 * What an import keeps, where it resumes, and when it may say it finished.
 *
 * These three decisions used to live inline in `fetch-events.mjs`, which takes
 * a lock and starts fetching on import, so the only way to check them was to
 * run the importer against the live site. They are now pure, and this is what
 * that bought.
 *
 * Each of them fails silently when it is wrong, and in a different direction:
 *
 *   keep too much   — a full pull refreshes nothing and reports success
 *   keep too little — an interrupted full pull starts over every time and can
 *                     never finish, however often it is run
 *   finish early    — the watermark moves past change sets covering events
 *                     this run never read, and the feed keeps whatever it last
 *                     said about them for ever
 *   ship the wrong   — a bookkeeping field on every event makes the download
 *   fields             bigger for nothing; dropping one the app reads makes
 *                      every session lose it, with no error either way
 *
 * The second is not hypothetical; it is the bug this file's subject was
 * written to fix.
 */

import { describe, expect, it } from 'vitest';
import { keepFromCache, pullComplete, resumeFrom, shipped } from './import-plan.mjs';

/** A cache of records, keyed by game code, with the times they were pulled. */
const cache = (entries) =>
  new Map(Object.entries(entries).map(([code, pulledAt]) => [code, { pulledAt }]));

const HELD = cache({
  'BGM26ND000001': '2026-08-01T09:00:00.000Z', // before this pull began
  'BGM26ND000002': '2026-08-01T09:30:00.000Z', // before
  'BGM26ND000003': '2026-08-01T11:00:00.000Z', // after — this pull fetched it
  'BGM26ND000004': '2026-08-01T12:00:00.000Z', // after
});
const BEGAN = '2026-08-01T10:00:00.000Z';

describe('what a full pull may keep', () => {
  it('throws away what it held before it started', () => {
    // The whole point of a full pull is the edits the source's change sets
    // never mention. Trusting the cache would mean never finding them.
    const { keep, held, kept } = keepFromCache(HELD, { refresh: true, since: BEGAN });
    expect(held).toBe(4);
    expect(kept).toBe(2);
    expect([...keep].sort()).toEqual(['BGM26ND000003', 'BGM26ND000004']);
  });

  it('keeps what it fetched itself, so an interrupted pull can finish', () => {
    // This is the bug. A full pull interrupted halfway left a cache full of
    // pages and nothing to say they belonged to a pull still running. The next
    // run threw them all away and asked again — and interrupting that one too
    // meant it never finished, however many times it was run.
    //
    // Run the decision twice over, as two interrupted attempts: the second
    // keeps everything the first fetched.
    const first = keepFromCache(HELD, { refresh: true, since: BEGAN });
    const afterFirst = cache({
      'BGM26ND000003': '2026-08-01T11:00:00.000Z',
      'BGM26ND000004': '2026-08-01T12:00:00.000Z',
      'BGM26ND000005': '2026-08-01T13:00:00.000Z', // fetched by the first attempt
    });
    const second = keepFromCache(afterFirst, { refresh: true, since: BEGAN });
    expect(first.kept).toBe(2);
    expect(second.kept).toBe(3);
    expect(second.keep.has('BGM26ND000005')).toBe(true);
  });

  it('keeps nothing at all when the pull is genuinely starting now', () => {
    // No `since` means no pull in progress, so there is nothing this pull has
    // already refreshed and the cache is worth nothing to it.
    const { keep, kept } = keepFromCache(HELD, { refresh: true, since: null });
    expect(kept).toBe(0);
    expect(keep.size).toBe(0);
  });

  it('counts a record with no pull time as one it did not fetch', () => {
    // A record from before the importer stamped them. It cannot have come from
    // this pull, so a full pull may not trust it.
    const older = cache({ 'BGM26ND000009': undefined });
    expect(keepFromCache(older, { refresh: true, since: BEGAN }).kept).toBe(0);
  });
});

describe('what a top-up may keep', () => {
  it('trusts the cache except where the source said otherwise', () => {
    const { keep, held, kept, stale, dropped } = keepFromCache(HELD, {
      invalidate: new Set(['BGM26ND000002']),
      drop: new Set(['BGM26ND000004']),
    });
    expect(held).toBe(4);
    expect(kept).toBe(2);
    expect(stale).toBe(1);
    expect(dropped).toBe(1);
    expect([...keep].sort()).toEqual(['BGM26ND000001', 'BGM26ND000003']);
  });

  it('re-pulls what a change set touched rather than trusting it', () => {
    // The one thing the source does tell us, and ignoring it is how an edited
    // event keeps its old room until the next full pull, months later.
    const { keep } = keepFromCache(HELD, { invalidate: new Set(['BGM26ND000001']) });
    expect(keep.has('BGM26ND000001')).toBe(false);
  });

  it('keeps everything when the source has said nothing', () => {
    expect(keepFromCache(HELD, {}).kept).toBe(4);
  });
});

describe('where a full pull resumes from', () => {
  const NOW = '2026-08-02T00:00:00.000Z';

  it('carries on a pull whose marker is still on disk', () => {
    expect(resumeFrom({ marker: BEGAN, watermark: { lastPullAt: 'x' }, now: NOW })).toEqual({
      startedAt: BEGAN,
      resumed: true,
    });
  });

  it('adopts a pull interrupted before the marker existed', () => {
    // No marker and no watermark, but records in the cache: that can only be a
    // full pull that never finished, and its own records date it. Starting
    // fresh instead would throw away everything it had fetched.
    expect(
      resumeFrom({ marker: null, watermark: null, earliestPulledAt: BEGAN, now: NOW }),
    ).toEqual({ startedAt: BEGAN, resumed: true });
  });

  it('starts now when a previous pull finished', () => {
    // A watermark means a pull has finished before, so a cache with no marker
    // is a completed one and this is a new full pull rather than a resumed
    // one. Adopting the old records' dates here would date this pull to
    // whenever the last one ran and keep the whole cache.
    expect(
      resumeFrom({ marker: null, watermark: { lastPullAt: BEGAN }, earliestPulledAt: BEGAN, now: NOW }),
    ).toEqual({ startedAt: NOW, resumed: false });
  });

  it('starts now when there is nothing to resume', () => {
    expect(resumeFrom({ marker: null, watermark: null, earliestPulledAt: null, now: NOW })).toEqual({
      startedAt: NOW,
      resumed: false,
    });
  });
});

describe('whether a run may say it got everything', () => {
  it('needs both nothing failing and nothing missing', () => {
    expect(pullComplete({ failed: 0, missing: 0 })).toBe(true);
    expect(pullComplete({ failed: 1, missing: 0 })).toBe(false);
    expect(pullComplete({ failed: 0, missing: 1 })).toBe(false);
  });

  it('asks about coverage rather than about the cap', () => {
    // A `--limit` run that happens to close the last gap counts, and one that
    // doesn't, doesn't. The watermark is what the *next* run reads to decide
    // what it still owes, so moving it early skips change sets covering events
    // this run never read.
    expect(pullComplete({ failed: 0, missing: 0 })).toBe(true);
    expect(pullComplete({ failed: 0, missing: 4_000 })).toBe(false);
  });

  it('treats not knowing as not finished', () => {
    // The cost of this default being wrong is one extra run. The cost of the
    // other default being wrong is events skipped for good.
    expect(pullComplete()).toBe(false);
    expect(pullComplete({ failed: 0 })).toBe(false);
    expect(pullComplete({ missing: 0 })).toBe(false);
  });
});

describe('what the feed carries', () => {
  /** An event as the cache holds it, with the importer's own field on it. */
  const cachedEvent = {
    id: 'BGM26ND306429',
    title: '12 Rivers',
    type: 'BGM',
    gameSystem: '12 Rivers',
    locationText: 'Stadium',
    roomText: 'Field : Fight in the Skies',
    tableText: 'HQ',
    start: '2026-07-30T20:00:00-04:00',
    end: '2026-07-30T22:00:00-04:00',
    cost: 2,
    ticketsAvailable: 0,
    ageRequirement: 'Everyone (6+)',
    url: 'https://www.gencon.com/events/306429',
    pulledAt: '2026-08-05T01:43:14.897Z',
  };

  it('leaves the importer’s own bookkeeping behind', () => {
    // 0.7 MB across 27,467 events, on the file a phone has to fetch before it
    // can show a single session — and `ConEvent` never declared the field, so
    // nothing in the app was reading it.
    const [event] = shipped([cachedEvent]);
    expect(event).not.toHaveProperty('pulledAt');
    expect(cachedEvent).toHaveProperty('pulledAt');
  });

  it('carries everything else through untouched', () => {
    // The other direction, and the worse one: a field dropped here is a field
    // every session loses, with no error — just a room gone blank in the app.
    const [event] = shipped([cachedEvent]);
    const { pulledAt, ...rest } = cachedEvent;
    expect(pulledAt).toBeTruthy();
    expect(event).toEqual(rest);
  });

  it('does not reach back into what it was given', () => {
    // The cache is written from the same records, and it is the cache that
    // `keepFromCache` reads `pulledAt` off. Stripping in place would leave a
    // full pull unable to tell what it had already refreshed.
    const held = [{ ...cachedEvent }];
    shipped(held);
    expect(held[0].pulledAt).toBe(cachedEvent.pulledAt);
    expect(keepFromCache(new Map([['x', held[0]]]), { refresh: true, since: '2026-08-01T00:00:00.000Z' }).kept).toBe(1);
  });
});
