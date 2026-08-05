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

  return pairUp(out);
}

/**
 * One mark for a pair of facilities, put between them.
 *
 * A plan draws the men's and the women's as two rooms, because they are two
 * rooms — but they are one place to go, off the same bit of corridor, signed
 * together. Two marks a few metres apart say "there are two of these here",
 * which is not what anyone is asking. So anything within `TOGETHER` of another
 * on the same floor collapses into a single mark at the middle of the group.
 *
 * The threshold comes from the drawings rather than from taste. Measured across
 * the convention centre, the gap from one restroom to its nearest neighbour
 * falls in two lots: 23–29 m, which is a pair either side of one entrance, and
 * 34 m and up, which is the next facility down the concourse. Thirty metres
 * sits in the space between them.
 */
const TOGETHER = 30;

function pairUp(all: Amenity[]): Amenity[] {
  const metres = (a: LatLng, b: LatLng) => {
    const lat = (a.lat - b.lat) * 111320;
    const lng = (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
    return Math.hypot(lat, lng);
  };

  const out: Amenity[] = [];
  const taken = new Set<Amenity>();
  for (const amenity of all) {
    if (taken.has(amenity)) continue;

    // Grow the group until nothing else is within reach of anything in it, so
    // a row of three cubicles is one mark and not a pair plus a straggler.
    const group = [amenity];
    taken.add(amenity);
    for (let at = 0; at < group.length; at += 1) {
      for (const other of all) {
        if (taken.has(other)) continue;
        if (other.kind !== amenity.kind || other.venueId !== amenity.venueId) continue;
        if (other.level !== amenity.level) continue;
        if (metres(group[at].position, other.position) > TOGETHER) continue;
        group.push(other);
        taken.add(other);
      }
    }

    out.push({
      ...amenity,
      position: {
        lat: group.reduce((sum, one) => sum + one.position.lat, 0) / group.length,
        lng: group.reduce((sum, one) => sum + one.position.lng, 0) / group.length,
      },
    });
  }
  return out;
}

export const AMENITIES: Amenity[] = build();

