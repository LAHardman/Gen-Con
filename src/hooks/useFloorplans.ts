/**
 * Loads the optional floor-plan manifest.
 *
 * Neither OpenStreetMap nor the event database publishes interior plans for
 * these buildings — OSM has no rooms mapped inside any Gen Con venue, and Gen
 * Con's own plans are drawn by a JavaScript map application rather than served
 * as images. So the app draws schematic interiors by default, and this is the
 * hook for replacing them with the real thing when you have it: drop plan
 * images into `public/floorplans/`, list them in `public/floorplans.json`, and
 * each one is drawn over its venue at the level it belongs to.
 *
 * The manifest is read at runtime rather than bundled, so plans can be added to
 * a deployed site by uploading two files — no rebuild.
 *
 * A missing manifest is the normal case, not an error.
 */

import { useEffect, useState } from 'react';

export interface Floorplan {
  /** Must match a `Room.level` on that venue, so a selected room finds its plan. */
  level: string;
  /** Relative to the app, e.g. `./floorplans/icc-level-1.png`. */
  url: string;
  /** 0–1; defaults to 0.85. Lower it when the plan hides the basemap. */
  opacity?: number;
  /** Shown in the map's attribution, since these are somebody else's drawings. */
  credit?: string;
  /**
   * Where the image's corners sit in the world. A plan usually covers a little
   * more or less than the building's own outline, so it needs its own corners
   * rather than being stretched to the venue's. Falls back to the venue's
   * footprint bounds when absent.
   */
  bounds?: { north: number; west: number; south: number; east: number };
}

/** venueId → its plans, one per level. */
export type FloorplanManifest = Record<string, Floorplan[]>;

export function useFloorplans(url = './floorplans.json'): FloorplanManifest {
  const [manifest, setManifest] = useState<FloorplanManifest>({});

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) return;
        // A dev server that rewrites unknown paths to index.html answers 200
        // with HTML; treat that as "no manifest" rather than a parse crash.
        if (!(response.headers.get('content-type') ?? '').includes('json')) return;

        const data = (await response.json()) as FloorplanManifest;
        if (!cancelled && data && typeof data === 'object') setManifest(data);
      } catch {
        // No manifest, or it isn't readable. Schematic interiors stand.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return manifest;
}

/**
 * Every plan to draw right now: one per venue that has any.
 *
 * A building's plans are drawn without being asked for, because a floor plan
 * you have to discover by clicking is a floor plan most people never see. Each
 * venue shows its first plan — the ground floor, as the manifest lists them —
 * until a room in that building is selected, at which point it switches to the
 * floor that room is on.
 */
export function activeFloorplans(
  manifest: FloorplanManifest,
  selected?: { venueId: string; level: string },
): Array<{ venueId: string; plan: Floorplan }> {
  // A local binding, so the check below narrows inside the callback too.
  const chosen = selected;

  return Object.entries(manifest).flatMap(([venueId, plans]) => {
    // The example manifest documents itself under a `__doc__` key; skip
    // anything that isn't actually a list of plans.
    if (!Array.isArray(plans) || typeof plans[0]?.url !== 'string') return [];

    const onThisFloor =
      chosen && chosen.venueId === venueId
        ? plans.find((plan) => plan.level === chosen.level)
        : undefined;

    return [{ venueId, plan: onThisFloor ?? plans[0] }];
  });
}
