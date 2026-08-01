/**
 * Basemap tile providers.
 *
 * All of these are key-free and load directly from the viewer's browser, so
 * there is nothing to sign up for and no token to keep out of the repo. Each
 * carries the attribution its terms require — Leaflet renders it in the corner,
 * and it must not be removed.
 */

export interface Basemap {
  id: string;
  label: string;
  url: string;
  attribution: string;
  /** Highest zoom the provider actually serves; beyond it tiles are upscaled. */
  maxNativeZoom: number;
  subdomains?: string;
  /** Darkens a light tileset with a CSS filter to match the app's theme. */
  filtered?: boolean;
}

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION}, &copy; <a href="https://carto.com/attributions">CARTO</a>`;

export type BasemapId = 'dark' | 'light' | 'streets';

export const BASEMAPS: Record<BasemapId, Basemap> = {
  dark: {
    id: 'dark',
    label: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
    maxNativeZoom: 20,
  },
  light: {
    id: 'light',
    label: 'Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
    maxNativeZoom: 20,
  },
  streets: {
    id: 'streets',
    label: 'Streets',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTRIBUTION,
    maxNativeZoom: 19,
    subdomains: '',
  },
};

export const BASEMAP_IDS = Object.keys(BASEMAPS) as BasemapId[];
