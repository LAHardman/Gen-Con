/**
 * Basemap tile providers.
 *
 * All of these are key-free and load directly from the viewer's browser, so
 * there is nothing to sign up for and no token to keep out of the repo. Each
 * carries the attribution its terms require — Leaflet renders it in the corner,
 * and it must not be removed.
 *
 * Each comes in two halves: the map without its writing, and the writing on its
 * own. The app draws the first under everything and the second over everything,
 * because the rooms and floor plans are opaque enough to bury a street name, and
 * a convention map you can't read the streets off is no help getting from one
 * building to another. Taking the split tileset rather than adding names over a
 * map that already has them is also what keeps every name drawn exactly once.
 */

import { CONFIG } from './config';

export interface Basemap {
  id: string;
  label: string;
  /** The map with no writing on it. */
  url: string;
  /** The same tileset's writing alone, transparent everywhere else. */
  labelsUrl: string;
  attribution: string;
  /** Highest zoom the provider actually serves; beyond it tiles are upscaled. */
  maxNativeZoom: number;
  subdomains?: string;
}

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION}, &copy; <a href="https://carto.com/attributions">CARTO</a>`;

export type BasemapId = 'dark' | 'light' | 'streets';

const COMPILED: Record<BasemapId, Basemap> = {
  dark: {
    id: 'dark',
    label: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
    labelsUrl: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
    maxNativeZoom: 20,
  },
  light: {
    id: 'light',
    label: 'Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
    labelsUrl: 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
    maxNativeZoom: 20,
  },
  // This used to be OpenStreetMap's own raster, which bakes its names into the
  // tile — so there is no way to lift them above the buildings, which is the
  // whole point of the split. Same data, rendered by CARTO, in two halves.
  streets: {
    id: 'streets',
    label: 'Streets',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
    labelsUrl: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
    maxNativeZoom: 20,
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
  {
    id: 'rescue-voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    labelsUrl: null,
    attribution: CARTO_ATTRIBUTION,
    maxNativeZoom: 20,
  },
  {
    id: 'rescue-osm',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    labelsUrl: null,
    attribution: OSM_ATTRIBUTION,
    maxNativeZoom: 19,
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
