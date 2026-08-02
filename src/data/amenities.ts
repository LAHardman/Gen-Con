/**
 * Restrooms and water, marked on the map.
 *
 * WHERE THESE COME FROM, which differs by building:
 *
 *  - The convention centre's are **measured**. Its official plans key spaces by
 *    colour and one of those colours is "Restrooms", so `plan-geometry.ts`
 *    already carries 25 of them as real outlines; this module just puts a mark
 *    at the middle of each. Nothing is authored for that building.
 *  - Every other venue's are **read off Gen Con's plans** of it, which draw a
 *    pictogram rather than a shape. So the position is where the pictogram is,
 *    at the same schematic grade as those buildings' rooms.
 *
 * WHAT IS MISSING, and it is not an oversight: **water fountains are not
 * marked, because no plan marks them.** The convention centre's legend has
 * four categories and water is not one; its drawings carry no "fountain" or
 * "water" label anywhere; and Gen Con's own map draws no such icon. Rather
 * than scatter plausible-looking dots, this ships restrooms only. `kind`
 * already allows for water, so the day a source turns up — the venue's own
 * amenities map, or Gen Con's app — the entries drop straight in.
 */

import type { LatLng } from '../utils/geo';
import { offsetLatLng } from '../utils/geo';
import { PLAN_DETAIL } from './plan-geometry';
import { VENUES_BY_ID } from './venues';

export type AmenityKind = 'restroom' | 'water';

export interface Amenity {
  id: string;
  kind: AmenityKind;
  venueId: string;
  /** Matched against `Room.level`, so amenities fade with the floor they're on. */
  level: string;
  position: LatLng;
}

/**
 * A pictogram's position in its venue's local grid, as the rooms use.
 * `[x, y]` — west to east, north to south, 0–100.
 */
type Placed = readonly [number, number];

/**
 * Restroom pictograms on Gen Con's plans, by venue and floor.
 *
 * Turned through half a turn like everything else read off those plans: they
 * are drawn with south at the top. See the note in `venues.ts`.
 */
const DRAWN: Record<string, Record<string, Placed[]>> = {
  'marriott-downtown': {
    '1st floor': [[40, 37]],
    '2nd floor': [[80, 13]],
  },
  westin: {
    '1st floor': [[64, 64]],
    '2nd floor': [[70, 52]],
  },
  omni: {
    '1st floor': [[30, 30]],
    '2nd floor': [[38, 32], [55, 60]],
  },
  'crowne-plaza': {
    '1st floor': [[70, 45], [30, 74]],
  },
  'jw-marriott': {
    '1st floor': [[88, 84]],
    '2nd floor': [[60, 88]],
    '3rd floor': [[88, 20]],
  },
  hyatt: {
    '2nd floor': [[26, 22]],
    '3rd floor': [[30, 76]],
  },
  hilton: {
    '2nd floor': [[70, 40]],
  },
  'embassy-suites': {
    '5th floor': [[70, 55], [30, 45]],
  },
  'le-meridien': {
    '2nd floor': [[35, 40]],
  },
};

/** The centre of a ring, for putting one mark on a drawn restroom. */
function centre(ring: ReadonlyArray<readonly [number, number]>): LatLng {
  let lat = 0;
  let lng = 0;
  for (const [a, b] of ring) {
    lat += a;
    lng += b;
  }
  return { lat: lat / ring.length, lng: lng / ring.length };
}

function fromGrid(venueId: string, [x, y]: Placed): LatLng | null {
  const venue = VENUES_BY_ID[venueId];
  if (!venue) return null;
  const { grid, anchor } = venue;
  return offsetLatLng(
    anchor.nw,
    ((x - grid.x) / grid.width) * anchor.widthMetres,
    ((y - grid.y) / grid.height) * anchor.heightMetres,
  );
}

function build(): Amenity[] {
  const out: Amenity[] = [];

  // The convention centre, from the outlines its plans actually draw.
  for (const [key, shapes] of Object.entries(PLAN_DETAIL)) {
    const [venueId, level] = key.split('/');
    shapes.forEach((shape, position) => {
      if (shape.kind !== 'restroom') return;
      out.push({
        id: `${venueId}-${level}-restroom-${position}`,
        kind: 'restroom',
        venueId,
        level,
        position: centre(shape.ring),
      });
    });
  }

  // Everywhere else, from where the pictogram sits.
  for (const [venueId, levels] of Object.entries(DRAWN)) {
    for (const [level, points] of Object.entries(levels)) {
      points.forEach((point, position) => {
        const at = fromGrid(venueId, point);
        if (at) {
          out.push({ id: `${venueId}-${level}-restroom-${position}`, kind: 'restroom', venueId, level, position: at });
        }
      });
    }
  }

  return out;
}

export const AMENITIES: Amenity[] = build();

