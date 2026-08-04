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

export const BASEMAPS: Record<BasemapId, Basemap> = {
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

export const BASEMAP_IDS = Object.keys(BASEMAPS) as BasemapId[];
