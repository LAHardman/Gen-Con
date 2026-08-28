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

describe('the rescues themselves', () => {
  it('are real tile templates with their attribution attached', () => {
    for (const rescue of BASEMAP_RESCUES) {
      expect(rescue.url).toMatch(/^https:\/\/.+\{z\}.+\{x\}.+\{y\}/);
      expect(rescue.attribution).toContain('OpenStreetMap');
      // Every rescue bakes its names in; a labels layer would 404 for ever.
      expect(rescue.labelsUrl).toBeNull();
    }
  });

  it('ends somewhere other than the provider it is rescuing from', () => {
    // If the whole of CARTO goes, every configured basemap goes with it — so
    // the last rung must stand on a different host entirely.
    const last = BASEMAP_RESCUES[BASEMAP_RESCUES.length - 1];
    const cartoHost = new URL(BASEMAPS.dark.url.replace('{s}', 'a')).hostname;
    expect(new URL(last.url.replace('{s}', 'a')).hostname).not.toBe(cartoHost);
  });
});
