/**
 * Do the basemap tiles still answer?
 *
 * The tile URLs in `basemaps.ts` are the one hard-coded thing that would
 * strand every installed copy at once: a provider retiring a style leaves
 * the app drawing rooms on a void. So each configured tileset is asked for
 * one real tile of downtown Indianapolis — and on failure the probe goes
 * looking for a substitute among the styles the same provider is known to
 * serve, so the finding arrives with a working URL attached rather than
 * with homework.
 */

import type { Probe, ProbeResult } from '../lib';
import { Unreachable } from '../lib';
import { BASEMAPS } from '../../../src/data/basemaps';

/** Downtown Indianapolis at zoom 11 — a real tile every style must have. */
const Z = 11;
const X = 533;
const Y = 777;

/**
 * Where to look when the configured style dies. All three styles are one
 * OpenStreetMap raster now, so a substitute has to be a different provider
 * entirely — Esri's canvas, which is where they used to live.
 *
 * NOTE THE BLIND SPOT THIS PROBE HAS. It asks for a status and a content
 * type, which is all a HEAD gives you — and on 2026-08-28 CARTO began
 * serving every style as a normal 200 image PNG with "API KEY REQUIRED"
 * composited into the map. This probe called that healthy, correctly and
 * uselessly. A watermark is only visible to somebody looking at the tile,
 * so `basemaps.test.ts` carries the rule that keeps CARTO out; if a
 * provider ever does this again, expect to find it by eye first.
 */
const SUBSTITUTES: ReadonlyArray<{ name: string; url: string; note: string }> = [
  {
    name: 'Esri light canvas',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    note: 'numbered {z}/{y}/{x}, not Leaflet\'s order; names baked in; NOTHING PAST ZOOM 16 — deeper tiles are a "Map data not yet available" placeholder, which is why the app left it',
  },
  {
    name: 'Esri dark canvas',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    note: 'same shape and the same zoom-16 ceiling as the light one',
  },
];

const tileUrl = (template: string) =>
  template
    .replace('{s}', 'a')
    .replace('{z}', String(Z))
    .replace('{x}', String(X))
    .replace('{y}', String(Y))
    .replace('{r}', '');

export const probe: Probe = {
  id: 'basemaps',
  title: 'Basemap tile providers',
  async run(ctx) {
    const dead: string[] = [];
    const details: string[] = [];
    let reachedAnything = false;

    for (const basemap of Object.values(BASEMAPS)) {
      for (const [half, template] of [
        ['map', basemap.url],
        ['labels', basemap.labelsUrl],
      ] as const) {
        const url = tileUrl(template);
        try {
          const { status, contentType } = await ctx.head(url);
          reachedAnything = true;
          const alive = status === 200 && contentType.startsWith('image/');
          if (!alive) {
            dead.push(`${basemap.id} (${half})`);
            details.push(`${url} → HTTP ${status}${contentType ? `, ${contentType}` : ''}`);
          }
        } catch (error) {
          if (!(error instanceof Unreachable)) throw error;
          details.push(error.message);
          dead.push(`${basemap.id} (${half}) — unreachable`);
        }
      }
    }

    if (!reachedAnything) {
      return {
        status: 'skip',
        summary: 'no tile host was reachable from here',
        details,
        instructions: ['Re-run `npm run season:check` somewhere with open network access.'],
      } satisfies ProbeResult;
    }
    if (!dead.length) {
      return { status: 'ok', summary: 'every configured tileset served a real tile of downtown' };
    }

    // A style died. Go looking for what still works, so the report carries a
    // substitute and not just a absence.
    const repair: string[] = [];
    for (const substitute of SUBSTITUTES) {
      try {
        const { status, contentType } = await ctx.head(tileUrl(substitute.url));
        if (status === 200 && contentType.startsWith('image/')) {
          repair.push(`Working now: ${substitute.name} — \`${substitute.url}\` (${substitute.note}).`);
        }
      } catch {
        // A dead substitute is just not offered.
      }
    }

    return {
      status: 'fail',
      summary: `${dead.length} tile layer${dead.length === 1 ? '' : 's'} stopped answering: ${dead.join(', ')}`,
      details,
      repair: repair.length
        ? repair
        : ['None of the known substitutes answered either — this looks network-wide rather than a retired style.'],
      instructions: [
        'Swap the dead URL in `src/data/basemaps.ts` for a working substitute above; each entry needs its `url` and `labelsUrl` pair, and the attribution its terms require must stay.',
        'For installed apps this is why the plan moves these URLs into `pack/config.json` — once that ships, the same fix is a pack publish instead of a release.',
        'The three-provider layout and the split-label reasoning are documented at the top of `basemaps.ts`; keep any replacement to the same shape.',
      ],
    };
  },
};
