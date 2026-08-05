/**
 * Where you change floor: the stairs, escalators and lifts.
 *
 * **None of this is surveyed, and the map says so wherever it draws it.** No
 * source this repository has marks a staircase. The convention centre's plans
 * key their spaces by colour and the five colours are exhibit halls, meeting
 * rooms, prefunction, restrooms and service — vertical circulation is not one
 * of them. Gen Con's own drawings of the hotels *do* draw escalators and lift
 * banks, and reading those is the right way to do this (see the note at the
 * foot of this file); until that is done, what is here is inferred.
 *
 * The inference is weak but not arbitrary, and it is worth being precise about
 * what it can and cannot claim. A staircase between two floors has to land on
 * walkable floor at both ends — it cannot arrive inside a locked ballroom — so
 * it must lie within the overlap of the two floors' circulation. That much is
 * certain. What is *not* certain is where in that overlap it is: for a hotel
 * whose corridors stack along their whole length, the overlap is the corridor,
 * and the middle of it is a guess.
 *
 * So a link is placed at the centre of the largest piece of that overlap, and
 * carries `certainty: 'region'` to say that the *area* is right and the point
 * within it is not. The map draws these differently from anything measured, and
 * a route that uses one says "somewhere along here" rather than naming a
 * staircase that may not be there.
 */

import { VENUE_LEVELS } from './venues';
import { between, cellCentre, cellOf, floorOf, toLatLng, toPoint, type Floor } from './walkable';
import type { LatLng } from '../utils/geo';

export interface Vertical {
  venueId: string;
  /** The two floors it joins, in the building's own names for them. */
  from: string;
  to: string;
  at: LatLng;
  /**
   * `region` — the overlap it lies in is certain, the point within it is not.
   * `plan` — read off a drawing that draws the thing itself. Nothing is `plan`
   * yet; the reader for it is described at the foot of this file.
   */
  certainty: 'region' | 'plan';
}

/** Below this, an overlap is two corridors clipping past each other. Square metres. */
const MIN_OVERLAP = 12;

/** A flight of stairs costs about this much walking, one floor. Metres. */
export const FLOOR_CHANGE_METRES = 25;

/** Cells open on both floors, as a grid in the upper floor's frame. */
function coincident(lower: Floor, upper: Floor) {
  const both = new Uint8Array(upper.width * upper.height);
  for (let cy = 0; cy < upper.height; cy += 1) {
    for (let cx = 0; cx < upper.width; cx += 1) {
      if (!upper.open[cy * upper.width + cx]) continue;
      const point = cellCentre(upper, cx, cy);
      const down = cellOf(lower, point);
      if (down.cx < 0 || down.cy < 0 || down.cx >= lower.width || down.cy >= lower.height) continue;
      if (lower.open[down.cy * lower.width + down.cx]) both[cy * upper.width + cx] = 1;
    }
  }
  return both;
}

/** The biggest connected piece of that overlap, and where its middle is. */
function largestPiece(upper: Floor, both: Uint8Array) {
  const seen = new Uint8Array(both.length);
  let best: { cells: number[]; size: number } | null = null;

  for (let start = 0; start < both.length; start += 1) {
    if (!both[start] || seen[start]) continue;
    const queue = [start];
    const cells: number[] = [];
    seen[start] = 1;
    while (queue.length) {
      const i = queue.pop()!;
      cells.push(i);
      const cx = i % upper.width;
      const cy = Math.floor(i / upper.width);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= upper.width || ny >= upper.height) continue;
        const next = ny * upper.width + nx;
        if (!both[next] || seen[next]) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    if (!best || cells.length > best.size) best = { cells, size: cells.length };
  }
  return best;
}

function linkBetween(venueId: string, lowerLevel: string, upperLevel: string): Vertical | null {
  const lower = floorOf(venueId, lowerLevel);
  const upper = floorOf(venueId, upperLevel);
  if (lower.empty || upper.empty) return null;

  const both = coincident(lower, upper);
  const piece = largestPiece(upper, both);
  if (!piece) return null;
  // CELL is 1.5 m, so a cell is 2.25 m².
  if (piece.size * 2.25 < MIN_OVERLAP) return null;

  let x = 0;
  let y = 0;
  for (const i of piece.cells) {
    const centre = cellCentre(upper, i % upper.width, Math.floor(i / upper.width));
    x += centre.x;
    y += centre.y;
  }
  const middle = { x: x / piece.cells.length, y: y / piece.cells.length };

  // The mean of a bent corridor can fall outside it, so take the cell of the
  // piece nearest that mean rather than the mean itself.
  let at = middle;
  let nearest = Infinity;
  for (const i of piece.cells) {
    const centre = cellCentre(upper, i % upper.width, Math.floor(i / upper.width));
    const away = between(centre, middle);
    if (away < nearest) {
      nearest = away;
      at = centre;
    }
  }

  return { venueId, from: lowerLevel, to: upperLevel, at: toLatLng(at), certainty: 'region' };
}

const CACHE = new Map<string, Vertical[]>();

/** Every floor change this building offers, between floors the map can draw. */
export function verticalsOf(venueId: string): Vertical[] {
  const held = CACHE.get(venueId);
  if (held) return held;

  const levels = VENUE_LEVELS[venueId] ?? [];
  const links: Vertical[] = [];
  // Only between floors that are adjacent in the building's own ordering: a
  // link from the 2nd to the 9th would be a lift shaft this cannot see.
  for (let i = 0; i + 1 < levels.length; i += 1) {
    const link = linkBetween(venueId, levels[i], levels[i + 1]);
    if (link) links.push(link);
  }
  CACHE.set(venueId, links);
  return links;
}

/** All of them, for the map to draw. */
export function allVerticals(): Vertical[] {
  return Object.keys(VENUE_LEVELS).flatMap((venueId) => verticalsOf(venueId));
}

export const verticalPoint = (link: Vertical) => toPoint(link.at);

/*
 * ---------------------------------------------------------------------------
 * How to replace this with something measured
 *
 * Gen Con's own plans of the hotels — the sheets in `plans/venues/`, which
 * `venue-plans.mjs` already reads for corridors — draw the vertical
 * circulation. An escalator is a hatched strip in two greys, #616264 and
 * #949599, both very slightly blue (blue exceeds red by 3 or 4); the Westin's
 * 2nd-floor sheet even letters it DOWN TO 1ST FLOOR. A lift bank is a run of
 * small squares in a dull yellow around #ddd779. Neither collides with the
 * street grey on the same sheets, which is a much lighter #c8c9cd, or with the
 * road markings at a neutral #8a8a8a.
 *
 * So the reader is a fourth and fifth class in that script's PALETTE, clustered
 * the way its halls already are, and its output drops in here as
 * `certainty: 'plan'` links, replacing the inference for the nine buildings it
 * covers. The convention centre would still have none: its plans are the
 * architect's rather than Gen Con's, and they draw no stairs at all. Gen Con's
 * tile pyramid covers it and `gencon-tiles.mjs` fetches that — but the path it
 * knows, `/maps/v9/`, now answers 403 from CloudFront itself rather than from
 * any proxy, so that source has moved and the script needs pointing at wherever
 * it went.
 */
