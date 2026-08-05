/**
 * Where you change floor: the stairs, escalators and lifts.
 *
 * These come two ways, and which one a link came from is recorded on it,
 * because they are not worth the same.
 *
 * **Drawn** (`certainty: 'plan'`). Gen Con's own sheets of the hotels draw the
 * thing itself: an escalator is a hatched grey block, and beside the big ones
 * the sheet letters UP TO 2ND FLOOR. `venue-plans.mjs` reads those, and a block
 * read on two adjacent floors within `SAME_SHAFT` of the same spot is one
 * shaft seen twice. That is a measurement.
 *
 * **Inferred** (`certainty: 'region'`), where no sheet shows one. A staircase
 * has to land on walkable floor at both ends — it cannot arrive inside a locked
 * ballroom — so it must lie within the overlap of the two floors' circulation.
 * That much is certain. Where *in* that overlap is not: for a hotel whose
 * corridors stack along their whole length the overlap is the corridor, and the
 * middle of it is a guess. So the link goes at the centre of the largest piece
 * of the overlap, the map draws it as a ring rather than a pin, and a route
 * using one says "off this stretch" rather than naming a staircase.
 *
 * The convention centre is still inferred, and it is the one that matters most.
 * Its own plans are the architect's and key five kinds of space, none of them
 * vertical; Gen Con's campus sheets *do* draw its escalators — see the foot of
 * this file — but those cannot yet be placed on the map.
 */

import { VENUE_LEVELS } from './venues';
import { VENUE_VERTICAL } from './venue-plan';
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
   * `plan` — read off a sheet that draws the thing itself.
   */
  certainty: 'region' | 'plan';
}

/** Below this, an overlap is two corridors clipping past each other. Square metres. */
const MIN_OVERLAP = 12;

/**
 * How near two drawn marks must be to be the same shaft seen from two floors.
 *
 * A staircase is in the same place on both storeys, so the two readings of it
 * should land on top of each other; this is slack for the fit rather than for
 * the building.
 */
const SAME_SHAFT = 18;

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

/**
 * The stairs the plans actually draw, where they draw them.
 *
 * `venue-plans.mjs` reads the hatched grey blocks off Gen Con's own sheets —
 * the shapes it letters UP TO 2ND FLOOR — and a shaft read on two adjacent
 * floors is one shaft, so a mark on each within `SAME_SHAFT` of the other is a
 * link between them. This is the measured answer, and it is preferred to the
 * inference below wherever both floors have one.
 */
function drawnBetween(venueId: string, lowerLevel: string, upperLevel: string): Vertical[] {
  const below = VENUE_VERTICAL[`${venueId}/${lowerLevel}`] ?? [];
  const above = VENUE_VERTICAL[`${venueId}/${upperLevel}`] ?? [];
  if (!below.length || !above.length) return [];

  const links: Vertical[] = [];
  const taken = new Set<number>();
  for (const [lat, lng] of below) {
    let best: { at: LatLng; away: number; index: number } | null = null;
    for (let index = 0; index < above.length; index += 1) {
      if (taken.has(index)) continue;
      const [upLat, upLng] = above[index];
      const away = between(toPoint({ lat, lng }), toPoint({ lat: upLat, lng: upLng }));
      if (away > SAME_SHAFT) continue;
      if (!best || away < best.away) best = { at: { lat: upLat, lng: upLng }, away, index };
    }
    if (!best) continue;
    taken.add(best.index);
    // The two readings straddle the real shaft; halfway is the better guess at
    // it than either on its own.
    links.push({
      venueId,
      from: lowerLevel,
      to: upperLevel,
      at: { lat: (lat + best.at.lat) / 2, lng: (lng + best.at.lng) / 2 },
      certainty: 'plan',
    });
  }
  return links;
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
    // What the drawings show, and only failing that what the floors imply.
    const drawn = drawnBetween(venueId, levels[i], levels[i + 1]);
    if (drawn.length) {
      links.push(...drawn);
      continue;
    }
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
 * What is left: the convention centre
 *
 * The nine hotels are read from their own sheets. The convention centre is not,
 * and it is the building with the most floor-changing on it.
 *
 * Gen Con's tile pyramid does draw its escalators — `npm run plans:campus`
 * fetches it, and level 1 shows two of them hatched on the Hoosier and Speedway
 * concourses, each lettered UP TO 2ND FLOOR. `venue-plans.mjs` will read those
 * blocks the moment it can place the sheet. What it cannot yet do is place it:
 * `fit` puts a plan on the map by taking its coloured area to *be* the building
 * and aligning that box with the venue's, which is exactly right for a
 * screenshot of one hotel and hopeless for a sheet of a mile of downtown. Run
 * it with `--campus` and the convention centre lands at 0.05 m/px and 32%
 * overlap, against 76-89% for every hotel.
 *
 * The fix is a georeference rather than a fit, and these sheets can have one:
 * they are a single level of a pyramid at a fixed scale, drawn with south at
 * the top, so two landmarks with known coordinates fix scale and offset for
 * every building on the sheet at once — the same thing
 * `plans/georeference.json` already does for the PDFs. Until then the campus
 * sheets are behind `--campus` so a rebuild cannot quietly replace good hotel
 * geometry with a misplaced convention centre.
 */
