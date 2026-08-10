/**
 * How far away something is, before anybody commits to walking to it.
 *
 * WHY THIS IS NOT JUST A CALL TO THE ROUTER. Routing a pair costs about 128 ms:
 * the campus graph is copied, both ends are joined to everything on their
 * floors, and Dijkstra runs twice. That is a fair price for the one route
 * somebody asked for. It is not a price you can pay eight times per keystroke
 * to put a time against a list of search results, and it is certainly not one
 * you can pay a hundred and forty-nine times to sort a hall by how near it is.
 *
 * So the room-to-room answers are measured once, at build time, by the same
 * router — see `scripts/build-distances.mjs` — and this reads them out. A
 * lookup is an array index. The whole table is 11,026 pairs and 9.3 KB
 * gzipped, and the metres in it are the metres `walkBetween` finds — to within
 * the 16 m the table is stored to, which is seven seconds' walking. The build
 * refuses to ship a table that disagrees by more than that.
 *
 * WHAT IS APPROXIMATE, then, is only the ends. A room's row was measured from
 * its doorway, so a room asked about as a room is exact. Anything that is not
 * a room — where the phone says you are, a point tapped on the map — has no
 * row, and is answered by the nearest doorway plus the gap to it. That is a
 * real estimate with real error, which is what `ROUGHLY` is for.
 *
 * A BOOTH IS ITS HALL. There is no row for stand 1229, and there should not be:
 * the halls are one open floor with air walls across them, a stand is a table
 * inside one, and the walk is to the hall. `hallForBooth` does that step, and
 * search results already carry the hall as their room.
 */

import { DISTANCE_DOORS, DISTANCE_ROOMS, DISTANCE_STEP, DISTANCE_TABLE, NO_ROUTE } from './distances';
import { distanceMetres, walkingMinutes, type LatLng } from '../utils/geo';

/**
 * The minute added to every estimate.
 *
 * Not a fudge factor and not a safety margin on the metres — the metres are
 * exact. It is the difference between the two questions. The table answers
 * "how far is that doorway from this one", and somebody reading a search result
 * is asking "how long until I am there", which also contains finding the door
 * you are nearest, reading a sign, and the last few metres inside a room the
 * size of a street. A minute is the smallest unit this is reported in, so a
 * minute is the smallest honest admission that the two are not the same
 * question.
 *
 * It is deliberately not applied to the route somebody has actually committed
 * to. That one is drawn leg by leg and can be read; this one cannot.
 */
const ROUGHLY = 1;

/**
 * What an unmapped straight line really costs, matching `OUTDOOR_DETOUR` in
 * `route.ts`.
 *
 * A position that is not a room is joined to the nearest doorway by a straight
 * line, and downtown Indianapolis is a grid you cannot walk a diagonal across.
 * The router charges its own unmapped lines at this, and an estimate that
 * charged less would systematically read short for exactly the people using it
 * — the ones walking, with the phone out.
 */
const GRID_DETOUR = 1.3;

/**
 * An end of the estimate: a room, a position, or a room *and* a position.
 *
 * Both, because a search result knows its room and the device knows only where
 * it is, and the pair of them is the common case — "how far is Hall I from
 * here". Where a room is given and the table knows it, the room wins: it is
 * the exact answer and the position is a guess at the same thing.
 */
export interface Spot {
  /** The room, where there is one. A booth's hall counts as its room. */
  roomId?: string | null;
  /** Where it is, for the things that are not rooms. */
  at?: LatLng | null;
}

const INDEX = new Map(DISTANCE_ROOMS.map((id, i) => [id, i]));

let PAIRS: Uint8Array | null = null;

/** The packed triangle, decoded on first use. One byte a pair, so no byte order. */
function pairs(): Uint8Array {
  if (PAIRS) return PAIRS;
  const binary = atob(DISTANCE_TABLE);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  PAIRS = bytes;
  return bytes;
}

/**
 * The walk between two rooms in metres, or null where the table has no answer.
 *
 * To the nearest `DISTANCE_STEP`, which is 16 m — seven seconds' walking, under
 * an answer printed in whole minutes. The table is stored a byte a pair for it,
 * and halves in size for the trouble.
 *
 * Null means one of three things and the caller cannot tell them apart, which
 * is correct: the id is not a room, the room is newer than the table, or
 * nothing walkable joins the two. All three come to "do not print a time".
 */
export function metresBetweenRooms(a: string, b: string): number | null {
  const i = INDEX.get(a);
  const j = INDEX.get(b);
  if (i === undefined || j === undefined) return null;
  if (i === j) return 0;
  const [low, high] = i < j ? [i, j] : [j, i];
  const n = DISTANCE_ROOMS.length;
  const stored = pairs()[low * n - (low * (low + 1)) / 2 + (high - low - 1)];
  return stored === NO_ROUTE ? null : stored * DISTANCE_STEP;
}

/** The doorway a room's row was measured from. */
export function roomDoorway(roomId: string): LatLng | null {
  const i = INDEX.get(roomId);
  if (i === undefined) return null;
  const [lat, lng] = DISTANCE_DOORS[i];
  return { lat, lng };
}

/**
 * The doorway a position is nearest, and how far off it is.
 *
 * There is no cap on that distance. Somebody four blocks away is genuinely
 * going to walk to the nearest way in and carry on from there, so the estimate
 * degrades gently instead of falling off a threshold nobody could have chosen
 * honestly. Measured over all 149 rooms, standing on a room's own doorway
 * picks that room every time, so the snap is not a source of error where
 * anybody actually stands.
 */
export function nearestDoorway(at: LatLng): { roomId: string; metres: number } | null {
  let best: { roomId: string; metres: number } | null = null;
  for (let i = 0; i < DISTANCE_ROOMS.length; i += 1) {
    const [lat, lng] = DISTANCE_DOORS[i];
    const metres = distanceMetres(at, { lat, lng });
    if (!best || metres < best.metres) best = { roomId: DISTANCE_ROOMS[i], metres };
  }
  return best;
}

/** A spot as the table can answer for it: a row, and the walk to reach that row. */
function onto(spot: Spot): { roomId: string; extraMetres: number } | null {
  if (spot.roomId && INDEX.has(spot.roomId)) return { roomId: spot.roomId, extraMetres: 0 };
  if (!spot.at) return null;
  const near = nearestDoorway(spot.at);
  return near ? { roomId: near.roomId, extraMetres: near.metres * GRID_DETOUR } : null;
}

/**
 * Roughly how far it is between two spots, in metres, or null when nothing says.
 *
 * The two ends snapping to the same room is not zero: two positions at opposite
 * ends of Exhibit Hall A both find the same doorway, and calling that no walk
 * at all would be wrong by the length of a hall. Where both know where they
 * are, the line between them is the answer; where they do not, there is nothing
 * left to measure and it really is zero.
 */
export function roughMetres(from: Spot, to: Spot): number | null {
  const here = onto(from);
  const there = onto(to);
  if (!here || !there) return null;

  if (here.roomId === there.roomId) {
    return from.at && to.at ? distanceMetres(from.at, to.at) * GRID_DETOUR : 0;
  }

  const between = metresBetweenRooms(here.roomId, there.roomId);
  if (between === null) return null;
  return here.extraMetres + between + there.extraMetres;
}

/**
 * Roughly how many minutes it is between two spots, or null when nothing says.
 *
 * Zero when there is nothing to walk, because padding "you are here" by a
 * minute would be a lie in the one case somebody can check by looking up.
 */
export function roughMinutes(from: Spot, to: Spot): number | null {
  const metres = roughMetres(from, to);
  if (metres === null) return null;
  if (metres === 0) return 0;
  return walkingMinutes(metres) + ROUGHLY;
}

/** "4 min", or "under a minute" — what goes beside a search result. */
export function formatRough(minutes: number): string {
  return minutes === 0 ? 'you are here' : `${minutes} min`;
}
