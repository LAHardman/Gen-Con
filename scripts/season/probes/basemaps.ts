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
 * Where to look when a configured style dies: the same CARTO family first
 * (labels baked in — the split-layer trick is lost but the map survives),
 * then OSM's own raster as the last resort everybody serves.
 */
const SUBSTITUTES: ReadonlyArray<{ name: string; url: string; note: string }> = [
  {
    name: 'CARTO dark, labels baked in',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    note: 'street names can no longer be lifted above the floor plans',
  },
  {
    name: 'CARTO light, labels baked in',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    note: 'street names can no longer be lifted above the floor plans',
  },
  {
    name: 'CARTO voyager, labels baked in',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    note: 'street names can no longer be lifted above the floor plans',
  },
  {
    name: 'OpenStreetMap standard',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    note: 'no {s} subdomains, no {r} retina, names baked in — and check the tile usage policy before shipping it as a default',
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
