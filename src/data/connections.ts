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

/* ------------------------------------------------------------------ landings */

/**
 * A building a skywalk crosses that is not somewhere anyone is going.
 *
 * The network was drawn span by span, and a span joins whatever is on either
 * side of the street it crosses — which is not always a venue. Leaving the JW
 * Marriott the bridge lands in the Government Center's car park, and it is the
 * *second* bridge, off the far side of that car park, that reaches the
 * convention centre. Both are in `CONNECTIONS`; neither joined anything,
 * because the thing in the middle is a car park and a car park is not a venue.
 *
 * That is the whole of what a landing is: a footprint a span may reach, so that
 * two spans reaching the same one are known to be two halves of one covered
 * walk. There is no plan of the inside, so a route through it is a straight
 * line and named as one — but it is a straight line indoors, which is the fact
 * that was missing.
 *
 * Both of them are car parks, which is not a coincidence: downtown's skywalks
 * were built to get people from a garage to a building without crossing a road,
 * so the garage is the middle of the chain rather than an end of it.
 *
 * How to find another: take a span that reaches exactly one venue, and ask what
 * building the other end of it stands on. If a second span stands on that
 * building too, it belongs here; if not, it is a dead end and a landing would
 * chain nothing. Rings come from the same Overpass extract as the spans:
 *
 *     [out:json];
 *     (way(340480879); way(340480885););
 *     out geom;
 *
 * © OpenStreetMap contributors, ODbL.
 */
export interface Landing {
  id: string;
  /** As it reads in a direction: "Through the Government Center car park". */
  name: string;
  /** The OpenStreetMap way this came from. */
  way: number;
  /** Its footprint, thinned to 2 m — a span either touches it or it doesn't. */
  ring: Line;
}

export const LANDINGS: Landing[] = [
  {
    id: 'government-center-parking',
    name: 'the Government Center car park',
    way: 340480879,
    ring: [
      [39.766714, -86.166897], [39.766734, -86.166892], [39.766754, -86.166885],
      [39.766772, -86.166877], [39.766790, -86.166866], [39.766795, -86.166812],
      [39.766795, -86.166778], [39.766769, -86.165555], [39.766768, -86.165498],
      [39.766693, -86.165500], [39.766514, -86.165507], [39.766358, -86.165513],
      [39.766182, -86.165520], [39.766009, -86.165526], [39.765984, -86.165532],
      [39.765960, -86.165542], [39.765937, -86.165557], [39.765942, -86.166091],
      [39.765957, -86.166735], [39.765984, -86.166752], [39.766000, -86.166786],
      [39.766001, -86.166825], [39.765986, -86.166860], [39.765960, -86.166879],
      [39.765961, -86.166925], [39.766027, -86.166923],
    ],
  },
  {
    id: 'world-of-wonders-garage',
    name: 'the World of Wonders garage',
    way: 340480885,
    ring: [
      [39.765045, -86.160861], [39.765572, -86.160837], [39.765552, -86.160127],
      [39.765463, -86.160128], [39.764459, -86.160157], [39.764423, -86.160168],
      [39.764424, -86.160292], [39.764414, -86.160380], [39.764415, -86.160479],
      [39.764415, -86.160578], [39.764466, -86.160577], [39.764470, -86.160879],
    ],
  },
];

export const LANDINGS_BY_ID: Record<string, Landing> = Object.fromEntries(
  LANDINGS.map((landing) => [landing.id, landing]),
);

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

/** Metres from a point to the nearest edge of a closed ring. */
function toRing(point: readonly [number, number], ring: Line) {
  let nearest = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    nearest = Math.min(nearest, toSegment(point, ring[j], ring[i]));
  }
  return nearest;
}

/** The end of a span nearer a footprint, and how near it gets. */
function endsAt(connection: Connection, ring: Line) {
  const ends = [connection.line[0], connection.line[connection.line.length - 1]];
  const away = ends.map((end) => toRing(end, ring));
  const which = away[0] <= away[1] ? 0 : 1;
  return { end: ends[which], away: away[which] };
}

/** For each span, the buildings it reaches and the floor it reaches them on. */
const REACHES = new Map<Connection, Map<string, string>>(
  CONNECTIONS.map((connection) => {
    const found = new Map<string, string>();
    for (const venue of VENUES) {
      if (endsAt(connection, venueOutline(venue)).away > REACH) continue;
      const levels = VENUE_LEVELS[venue.id] ?? [];
      const level = ENTERS_ON[venue.id] ?? (levels.length === 1 ? levels[0] : undefined);
      if (level) found.set(venue.id, level);
    }
    return [connection, found];
  }),
);

/** For each span, the landings it reaches and where on each it comes down. */
const LANDS_ON = new Map<Connection, Map<string, readonly [number, number]>>(
  CONNECTIONS.map((connection) => {
    const found = new Map<string, readonly [number, number]>();
    for (const landing of LANDINGS) {
      const { end, away } = endsAt(connection, landing.ring);
      if (away <= REACH) found.set(landing.id, end);
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
 * The landings a span comes down on, and the point on each where it does.
 *
 * A landing has no plan and so no floor to name — what a route needs from it is
 * only the place, so that the next span off the same building can be joined to
 * this one.
 */
export function landingsOf(connection: Connection): ReadonlyMap<string, readonly [number, number]> {
  return LANDS_ON.get(connection) ?? new Map();
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
