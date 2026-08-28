/**
 * The retreat a frozen copy makes when a tileset dies.
 *
 * The decision is what gets tested, because it is what goes wrong invisibly
 * in the one direction that matters: a phone offline in a concrete hall
 * fails every tile fetch, and a rule that read that as "the provider is
 * dead" would throw away the cached tileset — the only map that phone still
 * has — for a rescue it cannot fetch either. jsdom never loads or errors a
 * tile, so `MapView` cannot show any of this happening; the rule is asked
 * directly, the same way the label-size rule is.
 */

import { describe, expect, it } from 'vitest';
import { BASEMAPS, BASEMAP_RESCUES, nextRescue } from './basemaps';

describe('when to abandon a tileset', () => {
  it('retreats only once the failures leave no doubt', () => {
    expect(nextRescue(null, false, 5, true)).toBeNull();
    expect(nextRescue(null, false, 6, true)).toBe(0);
  });

  it('never retreats while offline, where the cache is the only map left', () => {
    expect(nextRescue(null, false, 100, false)).toBeNull();
  });

  it('never retreats from a layer that has loaded even one tile', () => {
    // One success means the provider is alive and the failures are the
    // network's; swapping would trade a working cache for a cold one.
    expect(nextRescue(null, true, 100, true)).toBeNull();
  });

  it('walks the ladder one rung at a time and stops on the last', () => {
    expect(nextRescue(0, false, 6, true)).toBe(1);
    // The last rescue failing leaves it in place: a broken layer is still a
    // map frame, and its cache may yet answer.
    expect(nextRescue(BASEMAP_RESCUES.length - 1, false, 6, true)).toBe(BASEMAP_RESCUES.length - 1);
  });
});

describe('every tile host the worker must know about', () => {
  /**
   * The coupling that broke once and would break silently again.
   *
   * `sw.js` caches tiles by hostname, and that cache is the whole reason the
   * map works in a hall with no signal. Swap a provider here and forget that
   * list, and the map is perfect online and blank offline — the one place
   * nobody tests and the one place it matters.
   */
  const hosts = async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('public/sw.js', 'utf8');
    const list = /const TILE_HOSTS = \[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
    // Comments first: an apostrophe in prose — "it isn't" — otherwise reads
    // as a quote and swallows the hostnames between it and the next one.
    const code = list.replace(/\/\/[^\n]*/g, '');
    return [...code.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };

  const hostOf = (template: string) => new URL(template.replace('{s}', 'a')).hostname;

  it('covers every style the map can draw', async () => {
    const known = await hosts();
    for (const basemap of Object.values(BASEMAPS)) {
      for (const url of [basemap.url, basemap.labelsUrl]) {
        if (!url) continue;
        expect(known.some((h) => hostOf(url).endsWith(h)), `${hostOf(url)} is not in sw.js TILE_HOSTS`).toBe(true);
      }
    }
  });

  it('covers every rung of the rescue ladder too', async () => {
    // A retreat that lands on an uncached host would work online and undo
    // the offline map, which is the situation the ladder exists for.
    const known = await hosts();
    for (const rescue of BASEMAP_RESCUES) {
      expect(known.some((h) => hostOf(rescue.url).endsWith(h)), `${hostOf(rescue.url)} is not in sw.js TILE_HOSTS`).toBe(true);
    }
  });

  it('asks for no CARTO tile, which now wants a key', async () => {
    // On 2026-08-28 every CARTO basemap style began returning its map with
    // "API KEY REQUIRED" written across it — a normal 200, a valid PNG, the
    // right content type, and unusable. Nothing automated here can read a
    // watermark, so the guard is the rule rather than the picture.
    const drawn = [
      ...Object.values(BASEMAPS).flatMap((b) => [b.url, b.labelsUrl]),
      ...BASEMAP_RESCUES.map((r) => r.url),
    ].filter(Boolean) as string[];
    for (const url of drawn) {
      expect(url, 'CARTO tiles need an API key and come back watermarked without one').not.toContain('cartocdn');
    }
  });
});

describe('serving real tiles at the zoom the app is read at', () => {
  it('draws every style natively at the zoom a building opens to', () => {
    /*
     * The defect this holds shipped and was reported as "the building
     * outlines don't line up with the map's outlines of what is there".
     *
     * Esri's canvas — which all three styles used — has no tiles past zoom
     * 16. Every deeper request comes back as a placeholder reading "Map data
     * not yet available", so `maxNativeZoom: 16` was set and Leaflet upscaled
     * instead. Opening a building flies to zoom 19, which meant a zoom-16
     * tile blown up eight times: a grey smear with no building edges in it.
     * The app's own outlines are surveyed and exact, so drawn over that they
     * looked wrong, and the map was the thing that was wrong.
     *
     * A basemap that stops above this number is not a styling choice, it is
     * the map going blurry exactly where the app is used.
     */
    const OPENS_TO = 19;
    for (const basemap of Object.values(BASEMAPS)) {
      expect(
        basemap.maxNativeZoom,
        `${basemap.id} upscales at the zoom a building opens to`,
      ).toBeGreaterThanOrEqual(OPENS_TO);
    }
  });

  it('lets a rescue be shallow, because a shallow map beats none', () => {
    // The ladder only runs when the real provider has stopped answering, and
    // there the bar is "any map at all" rather than a sharp one.
    for (const rescue of BASEMAP_RESCUES) {
      expect(rescue.maxNativeZoom).toBeGreaterThan(0);
    }
  });
});

describe('the rescues themselves', () => {
  it('are real tile templates with their attribution attached', () => {
    for (const rescue of BASEMAP_RESCUES) {
      // All three placeholders, in whatever order the provider numbers them:
      // Esri serves {z}/{y}/{x}, which is not Leaflet's default.
      for (const token of ['{z}', '{x}', '{y}']) expect(rescue.url).toContain(token);
      expect(rescue.url).toMatch(/^https:\/\//);
      expect(rescue.attribution.length).toBeGreaterThan(10);
      // Every rescue bakes its names in; a labels layer would 404 for ever.
      expect(rescue.labelsUrl).toBeNull();
    }
  });

  it('ends somewhere other than the provider it is rescuing from', () => {
    // What usually goes is a whole provider rather than one style — which is
    // exactly how CARTO went — and if that provider is the one serving the
    // configured basemaps, every one of them goes at once. So the last rung
    // must stand on a different host entirely.
    const last = BASEMAP_RESCUES[BASEMAP_RESCUES.length - 1];
    const defaultHost = new URL(BASEMAPS.dark.url.replace('{s}', 'a')).hostname;
    expect(new URL(last.url.replace('{s}', 'a')).hostname).not.toBe(defaultHost);
  });
});
