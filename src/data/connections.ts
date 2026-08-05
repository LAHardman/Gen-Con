/**
 * The ways between buildings that aren't the street.
 *
 * Downtown Indianapolis is stitched together above ground: a skywalk network
 * links the convention centre to the hotels around it and on to the mall, and
 * a tunnel runs south from Union Station. In August that is not a curiosity —
 * it is how most people get between their hotel and their game without going
 * outside, and none of it shows on a map of the streets.
 *
 * WHAT THESE ARE, exactly: the **spans**. OpenStreetMap has each bridge and the
 * tunnel as a way of its own, tagged `bridge=yes` or `tunnel=yes`, but it does
 * not have the corridors inside the buildings that join them up. So this is not
 * a route you can follow end to end on the map; it is where a covered crossing
 * exists, which is the part you can't work out by looking at the street.
 *
 *     [out:json];
 *     way["highway"~"footway|pedestrian|corridor|steps"]
 *       (39.7600,-86.1690,39.7680,-86.1590);
 *     out geom;
 *
 * Every bridge that query returns is here except one 20 m span well south of
 * the stadium, which is nothing to do with the convention. The two 5 m tunnel
 * stubs it returns are left out for the same reason — too short to be a way
 * anywhere. The OSM way id is kept against each so any of them can be checked.
 *
 * © OpenStreetMap contributors, ODbL.
 */

import { VENUES, VENUE_LEVELS, venueOutline } from './venues';

/** [latitude, longitude], the order the map draws in. */
export type Line = ReadonlyArray<readonly [number, number]>;

export interface Connection {
  /** Above the street or below it — they are drawn and named differently. */
  kind: 'skywalk' | 'tunnel';
  /** The OpenStreetMap way this came from. */
  way: number;
  line: Line;
}

export const CONNECTIONS: Connection[] = [
  { kind: 'skywalk', way: 340480897, line: [[39.766827, -86.165174], [39.766835, -86.165553]] },
  { kind: 'skywalk', way: 340480898, line: [[39.765936, -86.16361], [39.765644, -86.163617]] },
  { kind: 'skywalk', way: 340480899, line: [[39.765942, -86.166091], [39.765674, -86.166098]] },
  { kind: 'skywalk', way: 340480900, line: [[39.765958, -86.164613], [39.765651, -86.164642]] },
  { kind: 'skywalk', way: 340480901, line: [[39.765574, -86.160886], [39.765861, -86.160878]] },
  { kind: 'skywalk', way: 340480902, line: [[39.766027, -86.166923], [39.766044, -86.167415]] },
  { kind: 'skywalk', way: 340480903, line: [[39.76439, -86.159131], [39.764123, -86.159141]] },
  { kind: 'skywalk', way: 340480904, line: [[39.762834, -86.162021], [39.762827, -86.161732]] },
  { kind: 'skywalk', way: 340480905, line: [[39.765463, -86.160128], [39.765458, -86.159818]] },
  { kind: 'skywalk', way: 340480907, line: [[39.764123, -86.159082], [39.764123, -86.159141], [39.764124, -86.159209]] },
  { kind: 'skywalk', way: 340480908, line: [[39.766769, -86.165555], [39.766835, -86.165553], [39.766874, -86.165551]] },
  { kind: 'tunnel', way: 524099194, line: [[39.762024, -86.161795], [39.762918, -86.16176]] },
];

/* ------------------------------------------------- which building, which floor */

/**
 * A skywalk is only a way out of the building you are standing in if you are on
 * the floor it leaves from. Downtown's network runs at the second level
 * throughout, so a bridge drawn across the room you are looking at is either
 * the way to the next hotel or a line over your head, and which one it is
 * depends entirely on the floor.
 *
 * So an open building draws only the spans that reach it, and only while it is
 * showing the floor they reach it on. With no building open they all draw:
 * that view is the campus, and where the covered crossings are is the most
 * useful thing on it.
 *
 * The floors are named building by building because every building names them
 * differently — the convention centre's skywalk level is its Level 2, Union
 * Station's is the mezzanine over the Grand Hall. A building with one floor
 * needs no entry: there is nowhere else its skywalk could arrive.
 */
export const ENTERS_ON: Record<string, string> = {
  icc: 'Level 2',
  'marriott-downtown': '2nd floor',
  westin: '2nd floor',
  'jw-marriott': '2nd floor',
  hyatt: '2nd floor',
  omni: '2nd floor',
  'le-meridien': '2nd floor',
  'crowne-plaza': 'Mezzanine',
};

/** How near a span has to pass a building to be counted as a way into it. */
const REACH = 35;

/** Metres from a point to a segment, flat-earth, which over 35 m is exact enough. */
function toSegment(point: readonly [number, number], from: readonly [number, number], to: readonly [number, number]) {
  const perLng = 111320 * Math.cos((point[0] * Math.PI) / 180);
  const px = point[1] * perLng;
  const py = point[0] * 111320;
  const ax = from[1] * perLng;
  const ay = from[0] * 111320;
  const bx = to[1] * perLng;
  const by = to[0] * 111320;
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const along = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - (ax + along * dx), py - (ay + along * dy));
}

/** For each span, the buildings it reaches and the floor it reaches them on. */
const REACHES = new Map<Connection, Map<string, string>>(
  CONNECTIONS.map((connection) => {
    const ends = [connection.line[0], connection.line[connection.line.length - 1]];
    const found = new Map<string, string>();
    for (const venue of VENUES) {
      const ring = venueOutline(venue);
      let nearest = Infinity;
      for (const end of ends) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
          nearest = Math.min(nearest, toSegment(end, ring[j], ring[i]));
        }
      }
      if (nearest > REACH) continue;
      const levels = VENUE_LEVELS[venue.id] ?? [];
      const level = ENTERS_ON[venue.id] ?? (levels.length === 1 ? levels[0] : undefined);
      if (level) found.set(venue.id, level);
    }
    return [connection, found];
  }),
);

/**
 * The buildings a span joins, and the floor it joins each of them on.
 *
 * The same table the drawing rule below reads, exposed because a route needs it
 * for a different reason: to know that stepping onto this bridge in one
 * building puts you on a named floor of another.
 */
export function reachesOf(connection: Connection): ReadonlyMap<string, string> {
  return REACHES.get(connection) ?? new Map();
}

/**
 * Whether a span is drawn: always with nothing open, and otherwise only where
 * it reaches the open building on the floor being shown.
 */
export function connectionShown(
  connection: Connection,
  openVenueId: string | null,
  level: string | undefined,
): boolean {
  if (!openVenueId) return true;
  return REACHES.get(connection)?.get(openVenueId) === level;
}
