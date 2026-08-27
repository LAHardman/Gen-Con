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
  /**
   * Where the pack is published, for a copy with no origin of its own to be
   * relative to. Null means "beside the app", which is right on the web and
   * never right in a native shell, where the compiled-in default takes over.
   */
  packHost: string | null;
}

const optionalString = (value: unknown) => value === undefined || typeof value === 'string';
const optionalNumber = (value: unknown) => value === undefined || typeof value === 'number';
/** Absent, or null, or a string: the three ways "nothing to override" arrives. */
const nullableString = (value: unknown) =>
  value === undefined || value === null || typeof value === 'string';

/**
 * Whether a config is safe to apply — validating what is *present* and
 * accepting what is absent.
 *
 * That asymmetry is the whole additive-change contract, and it runs in both
 * directions. A copy built before a field existed must ignore it rather
 * than choke (the reason unknown keys are never inspected); and a copy
 * built after must still read a config written before, or the first field
 * ever added would strand every older pack. Only a field that is present
 * and wrong condemns the config — and then wholly, because a config
 * half-applied is a map drawn on one provider's tiles under another's
 * attribution.
 */
export function isRuntimeConfig(candidate: unknown): candidate is Partial<RuntimeConfig> {
  const config = candidate as Partial<RuntimeConfig> | null;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  if (!nullableString(config.eventsMirror)) return false;
  if (!nullableString(config.packHost)) return false;
  if (config.basemaps === undefined) return true;
  if (!config.basemaps || typeof config.basemaps !== 'object' || Array.isArray(config.basemaps)) return false;
  for (const override of Object.values(config.basemaps)) {
    if (!override || typeof override !== 'object') return false;
    const entry = override as BasemapOverride;
    if (!optionalString(entry.url) || !optionalString(entry.labelsUrl)) return false;
    if (!optionalString(entry.attribution) || !optionalString(entry.subdomains)) return false;
    if (!optionalNumber(entry.maxNativeZoom)) return false;
  }
  if (config.rescues !== null && config.rescues !== undefined) {
    if (!Array.isArray(config.rescues) || config.rescues.length === 0) return false;
    for (const rescue of config.rescues) {
      if (!rescue || typeof rescue !== 'object') return false;
      if (typeof rescue.url !== 'string' || typeof rescue.attribution !== 'string') return false;
      if (typeof rescue.maxNativeZoom !== 'number' || !optionalString(rescue.subdomains)) return false;
    }
  }
  return true;
}

/**
 * The compiled config, with whatever the pack's own carries laid over it.
 *
 * Layered rather than replaced, so a config written before a field existed
 * keeps that field's compiled default instead of blanking it — the other
 * half of the additive contract the guard above describes. A refused
 * config contributes nothing, which leaves exactly what was built.
 */
export const CONFIG: RuntimeConfig = {
  ...(raw as RuntimeConfig),
  ...(packTable('config', isRuntimeConfig) ?? {}),
};
