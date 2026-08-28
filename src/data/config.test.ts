/**
 * The config overrides, tested where they earn their keep: applied to the
 * real modules the way a pack refresh would apply them, and refused whole
 * when malformed.
 *
 * The stakes are the frozen copy's: these overrides are the only way a
 * retired tileset or a moved mirror ever reaches an app nobody can update,
 * so "a valid override lands" and "an invalid one changes nothing" are both
 * load-bearing — a half-applied config is a map drawn on one provider's
 * tiles under another's attribution.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRuntimeConfig } from './config';
import { stashPack } from './pack-runtime';

afterEach(() => {
  stashPack({});
  vi.resetModules();
});

const EMPTY = { basemaps: {}, rescues: null, eventsMirror: null };

describe('the guard', () => {
  it('accepts the compiled snapshot and honest overrides', () => {
    expect(isRuntimeConfig(EMPTY)).toBe(true);
    expect(
      isRuntimeConfig({
        basemaps: { dark: { url: 'https://x/{z}/{x}/{y}.png' } },
        rescues: [{ url: 'https://y/{z}/{x}/{y}.png', attribution: 'OSM', maxNativeZoom: 19 }],
        eventsMirror: 'https://mirror.example/events.json',
      }),
    ).toBe(true);
  });

  it('tolerates a config written before a field existed, in both directions', () => {
    // The additive contract, and it has to run both ways: an old copy must
    // ignore a field it has never heard of, and a new copy must read a
    // config written before that field was added — otherwise the first
    // field ever added strands every pack already out there.
    expect(isRuntimeConfig({ basemaps: {}, rescues: null })).toBe(true);
    expect(isRuntimeConfig({})).toBe(true);
    expect(isRuntimeConfig({ ...EMPTY, aFieldFromTheFuture: { nested: true } })).toBe(true);
  });

  it('refuses a malformed config whole', () => {
    expect(isRuntimeConfig({ ...EMPTY, basemaps: { dark: { url: 42 } } })).toBe(false);
    expect(isRuntimeConfig({ ...EMPTY, rescues: [] })).toBe(false);
    expect(isRuntimeConfig({ ...EMPTY, rescues: [{ url: 'x' }] })).toBe(false);
    expect(isRuntimeConfig({ ...EMPTY, eventsMirror: 42 })).toBe(false);
    expect(isRuntimeConfig(null)).toBe(false);
  });
});

describe('applied to the real modules', () => {
  it('an override rewrites one basemap field and leaves the rest standing', async () => {
    stashPack({
      config: { ...EMPTY, basemaps: { dark: { url: 'https://new-host/{z}/{x}/{y}.png' } } },
    });
    const { BASEMAPS } = await import('./basemaps');
    expect(BASEMAPS.dark.url).toBe('https://new-host/{z}/{x}/{y}.png');
    // Only the named field moves: labels, attribution and the other styles
    // are exactly as compiled.
    expect(BASEMAPS.dark.labelsUrl).toContain('cartocdn');
    expect(BASEMAPS.dark.attribution).toContain('CARTO');
    expect(BASEMAPS.light.url).toContain('cartocdn');
  });

  it('a replacement rescue ladder takes over whole', async () => {
    stashPack({
      config: {
        ...EMPTY,
        rescues: [{ url: 'https://survivor/{z}/{x}/{y}.png', attribution: 'OSM', maxNativeZoom: 19 }],
      },
    });
    const { BASEMAP_RESCUES } = await import('./basemaps');
    expect(BASEMAP_RESCUES).toHaveLength(1);
    expect(BASEMAP_RESCUES[0].url).toBe('https://survivor/{z}/{x}/{y}.png');
    expect(BASEMAP_RESCUES[0].labelsUrl).toBeNull();
  });

  it('the pack mirror outranks the build-time one, because it is newer', async () => {
    stashPack({ config: { ...EMPTY, eventsMirror: 'https://moved.example/events.json' } });
    const { EVENTS_MIRROR } = await import('../hooks/useEventFeed');
    expect(EVENTS_MIRROR).toBe('https://moved.example/events.json');
  });

  it('an older config keeps the compiled default for what it does not mention', async () => {
    // Layered, not replaced: a config from before `packHost` existed must
    // leave the compiled pack host standing rather than blanking it.
    stashPack({ config: { basemaps: {}, rescues: null, eventsMirror: null } });
    const { CONFIG } = await import('./config');
    expect(CONFIG.packHost).toBe(null);
    expect(CONFIG.basemaps).toEqual({});
  });

  it('a refused config changes nothing at all', async () => {
    stashPack({ config: { basemaps: { dark: { url: 42 } } } });
    const { BASEMAPS, BASEMAP_RESCUES } = await import('./basemaps');
    expect(BASEMAPS.dark.url).toContain('cartocdn');
    expect(BASEMAP_RESCUES.length).toBeGreaterThan(1);
  });
});
