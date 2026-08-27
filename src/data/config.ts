/**
 * Runtime configuration: the constants that must not be constants.
 *
 * Most of what could strand an installed copy for ever is not a table, it
 * is a hard-coded string — a tile URL whose provider retires it, a mirror
 * that moves. Each of those lives here as a pack table of *overrides*,
 * empty in the ordinary case, so the repair for something external dying
 * under a copy nobody can update is one edit to `config.json` and a deploy:
 * every running copy picks it up with its next pack refresh, web and
 * (eventually) native alike.
 *
 * The compiled snapshot of this file is the floor, like every pack table —
 * a copy that never reaches a pack again behaves exactly as built — and the
 * guard refuses a malformed override wholesale rather than half-applying
 * it, because a config half-applied is a map drawn on one provider's tiles
 * with another's attribution.
 */

import raw from './config.json';
import { packTable } from './pack-runtime';

export interface BasemapOverride {
  url?: string;
  labelsUrl?: string;
  attribution?: string;
  maxNativeZoom?: number;
  subdomains?: string;
}

export interface RescueOverride {
  url: string;
  attribution: string;
  maxNativeZoom: number;
  subdomains?: string;
}

export interface RuntimeConfig {
  /** Partial overrides per basemap id (dark, light, streets). */
  basemaps: Record<string, BasemapOverride>;
  /** A full replacement for the tile rescue ladder, or null for the built-in one. */
  rescues: RescueOverride[] | null;
  /** Where a schedule can be fetched when the main host is gone, or null. */
  eventsMirror: string | null;
}

const optionalString = (value: unknown) => value === undefined || typeof value === 'string';
const optionalNumber = (value: unknown) => value === undefined || typeof value === 'number';

export function isRuntimeConfig(candidate: unknown): candidate is RuntimeConfig {
  const config = candidate as Partial<RuntimeConfig> | null;
  if (!config || typeof config !== 'object') return false;
  if (config.eventsMirror !== null && typeof config.eventsMirror !== 'string') return false;
  if (!config.basemaps || typeof config.basemaps !== 'object' || Array.isArray(config.basemaps)) return false;
  for (const override of Object.values(config.basemaps)) {
    if (!override || typeof override !== 'object') return false;
    const entry = override as BasemapOverride;
    if (!optionalString(entry.url) || !optionalString(entry.labelsUrl)) return false;
    if (!optionalString(entry.attribution) || !optionalString(entry.subdomains)) return false;
    if (!optionalNumber(entry.maxNativeZoom)) return false;
  }
  if (config.rescues !== null) {
    if (!Array.isArray(config.rescues) || config.rescues.length === 0) return false;
    for (const rescue of config.rescues) {
      if (!rescue || typeof rescue !== 'object') return false;
      if (typeof rescue.url !== 'string' || typeof rescue.attribution !== 'string') return false;
      if (typeof rescue.maxNativeZoom !== 'number' || !optionalString(rescue.subdomains)) return false;
    }
  }
  return true;
}

/** The pack's config when one is held and reads; else exactly what was built. */
export const CONFIG: RuntimeConfig = packTable('config', isRuntimeConfig) ?? (raw as RuntimeConfig);
