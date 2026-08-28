/**
 * Basemap tile providers.
 *
 * All of these are key-free and load directly from the viewer's browser, so
 * there is nothing to sign up for and no token to keep out of the repo. Each
 * carries the attribution its terms require — Leaflet renders it in the corner,
 * and it must not be removed.
 *
 * Two of the three come in halves: the map without its writing, and the
 * writing on its own. The app draws the first under everything and the second
 * over everything, because the rooms and floor plans are opaque enough to bury
 * a street name, and a convention map you can't read the streets off is no help
 * getting from one building to another. Taking a split tileset rather than
 * adding names over a map that already has them is also what keeps every name
 * drawn exactly once. Where a provider bakes its names in, `labelsUrl` is null
 * and the map simply draws no second layer.
 *
 * WHICHEVER PROVIDER IS HERE, `public/sw.js` HAS TO KNOW ITS HOST, or the
 * tiles stop being cached and the map stops working offline — silently, and
 * only in the place it matters. `basemaps.test.ts` holds the two together.
 */

import { CONFIG } from './config';

export interface Basemap {
  id: string;
  label: string;
  /** The map with no writing on it. */
  url: string;
  /**
   * The same tileset's writing alone, transparent everywhere else — or null
   * where the provider bakes its names into the map and there is no second
   * half to draw on top.
   */
  labelsUrl: string | null;
  attribution: string;
  /** Highest zoom the provider actually serves; beyond it tiles are upscaled. */
  maxNativeZoom: number;
  subdomains?: string;
}

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Esri's own credit line for the canvas basemaps, which their terms require.
 *
 * CARTO's tiles used to be here and are not any more: on 2026-08-28 every
 * CARTO basemap style began coming back with "API KEY REQUIRED" written
 * across it — as a normal 200, a valid PNG, the right content type, and the
 * watermark composited into the map itself. Nothing a status check can see;
 * the map simply reads as vandalised to anybody looking at it. Esri's
 * canvas layers are the replacement because they are key-free *and* split
 * into a base and a reference layer, which is what lets street names draw
 * over the floor plans instead of under them.
 */
const ESRI_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Esri, DeLorme, NAVTEQ';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
/** Esri numbers its tiles {z}/{y}/{x}, which is not Leaflet's default order. */
const esri = (service: string) => `${ESRI}/${service}/MapServer/tile/{z}/{y}/{x}`;

/**
 * One tileset, three treatments — and the reason it is one tileset.
 *
 * The three styles used to be three different services. CARTO's, until it
 * began watermarking every tile; then Esri's canvas, which is key-free and
 * came in a base and a labels half, so street names could be lifted above
 * the floor plans. That split was worth having and is now given up, for a
 * reason that only shows at the zoom the app is actually used at.
 *
 * ESRI'S CANVAS STOPS AT ZOOM 16. Every deeper tile is a placeholder image
 * reading "Map data not yet available" — checked at 17, 18, 19 and 20, on
 * both the dark and the light service. `maxNativeZoom: 16` kept those off
 * the screen, so what you got instead was a zoom-16 tile blown up eight
 * times: a grey smear with no building edges in it and a street name the
 * height of a block. That is where this app spends its time. You open a
 * building at zoom 19.
 *
 * It also made the app look wrong in a way that was not its fault. The
 * venue outlines here are OpenStreetMap's own footprints, surveyed and
 * exact; drawn over a smeared upscale whose buildings are blobs, they read
 * as not lining up with the map underneath, and that is what was reported.
 *
 * OpenStreetMap's raster has real data to zoom 19, and — the part that
 * settles it — the buildings on it are the same data these outlines come
 * from. They line up by construction rather than by luck.
 *
 * WHAT IT COSTS, stated plainly. OSM bakes its labels into the tile, so
 * there is no separate writing layer to draw over the rooms any more, and
 * `labelsUrl` is null throughout. That trick is missed. It was also already
 * lost in practice: the labels half stopped at zoom 16 with the base half,
 * so above that it was an upscale being drawn over a floor plan.
 *
 * The styles are therefore one tileset filtered three ways, in
 * `styles.css` against `map__tiles--<id>`: dark is inverted, light is
 * desaturated, streets is left alone. Which means a tile fetched for one
 * style is the same tile for all three — the offline cache now covers every
 * style at once instead of a third of each.
 */
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/**
 * How deep OpenStreetMap's raster really goes. Above this Leaflet upscales
 * rather than asking for a tile that is not there — and unlike the canvas
 * this app left behind, that only starts one step past the deepest zoom
 * anybody reads a floor plan at.
 */
const OSM_MAX_NATIVE = 19;

export type BasemapId = 'dark' | 'light' | 'streets';

const COMPILED: Record<BasemapId, Basemap> = {
  dark: {
    id: 'dark',
    label: 'Dark',
    url: OSM,
    labelsUrl: null,
    attribution: OSM_ATTRIBUTION,
    maxNativeZoom: OSM_MAX_NATIVE,
  },
  light: {
    id: 'light',
    label: 'Light',
    url: OSM,
    labelsUrl: null,
    attribution: OSM_ATTRIBUTION,
    maxNativeZoom: OSM_MAX_NATIVE,
  },
  streets: {
    id: 'streets',
    label: 'Streets',
    url: OSM,
    labelsUrl: null,
    attribution: OSM_ATTRIBUTION,
    maxNativeZoom: OSM_MAX_NATIVE,
  },
};

/**
 * The compiled styles, with any overrides the pack's config carries laid on
 * top. The override channel exists for exactly one story: a provider
 * retires a style out from under installed copies, and the repair is a
 * config edit and a deploy rather than an app release. With the config
 * empty — the ordinary case — this is `COMPILED`, byte for byte.
 */
export const BASEMAPS: Record<BasemapId, Basemap> = Object.fromEntries(
  (Object.keys(COMPILED) as BasemapId[]).map((id) => [
    id,
    { ...COMPILED[id], ...CONFIG.basemaps[id] },
  ]),
) as Record<BasemapId, Basemap>;

export const BASEMAP_IDS = Object.keys(BASEMAPS) as BasemapId[];

/* ------------------------------------------------------------------ rescue */

/**
 * Where the map goes when a tileset dies under an app nobody can update.
 *
 * A copy installed on a phone keeps these URLs for ever, and a provider
 * retiring a style would otherwise leave rooms drawn on a void — the one
 * hard-coded thing that could quietly end every frozen copy at once. So the
 * map carries its own line of retreat: the same provider's plain styles
 * first (labels baked into the tile — the split-label trick is lost, but the
 * map survives), then OpenStreetMap's own raster, which is the tileset most
 * likely to outlive everything else here.
 *
 * `labelsUrl` is null throughout because every rescue bakes its names in;
 * the map skips its label layer rather than fetching one that isn't there.
 */
export interface RescueBasemap {
  id: string;
  url: string;
  labelsUrl: null;
  attribution: string;
  maxNativeZoom: number;
  subdomains?: string;
}

const COMPILED_RESCUES: readonly RescueBasemap[] = [
  // Esri's canvas, which is where this app's styles used to live. It is
  // shallow — nothing past zoom 16 — but a shallow map is an enormous
  // improvement on no map, and this rung only ever runs when OpenStreetMap
  // itself has stopped answering.
  {
    id: 'rescue-esri-light',
    url: esri('World_Light_Gray_Base'),
    labelsUrl: null,
    attribution: ESRI_ATTRIBUTION,
    maxNativeZoom: 16,
  },
  {
    id: 'rescue-esri-dark',
    url: esri('World_Dark_Gray_Base'),
    labelsUrl: null,
    attribution: ESRI_ATTRIBUTION,
    maxNativeZoom: 16,
  },
];

/**
 * The ladder in force: the pack's replacement when its config carries one,
 * else the compiled rungs. A replacement is all-or-nothing — the ladder is
 * an ordered argument about where to retreat, and splicing two arguments
 * makes neither.
 */
export const BASEMAP_RESCUES: readonly RescueBasemap[] =
  CONFIG.rescues?.map((rescue, at) => ({ id: `rescue-config-${at}`, labelsUrl: null, ...rescue })) ??
  COMPILED_RESCUES;

/**
 * Whether a run of tile failures means the tileset is dead, and where to go.
 *
 * The judgement worth being careful about: failures alone prove nothing. A
 * phone in a concrete hall fails every fetch, and swapping tilesets there
 * would throw away the cache that is the only thing still drawing the map.
 * So a retreat needs all three — the browser believes it is online, not one
 * tile of this layer has ever loaded, and the failures have piled up past
 * doubt. Anything less returns `current` unchanged, and so does running out
 * of rescues: a broken layer is still a map frame, and the cache may yet
 * answer.
 */
export function nextRescue(
  current: number | null,
  anyLoaded: boolean,
  failures: number,
  online: boolean,
): number | null {
  if (anyLoaded || !online || failures < 6) return current;
  const next = current === null ? 0 : current + 1;
  return next < BASEMAP_RESCUES.length ? next : current;
}
