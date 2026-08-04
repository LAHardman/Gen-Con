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
