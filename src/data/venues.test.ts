/**
 * The places that are not rooms on a plan, and are drawn anyway.
 *
 * Almost every shape on this map is read off something: the halls and meeting
 * rooms are the outlines the architect drew, the buildings are OpenStreetMap
 * footprints. Three places Gen Con puts stands in are not on any plan — a
 * corridor, a hallway and a street — so their geometry is *constructed*, and
 * constructed geometry is the kind that can be quietly, plausibly wrong.
 *
 * The failure is not a crash. A rectangle a few metres out draws a corridor
 * halfway through the wall beside it, or a market hanging off the side of the
 * building, and it looks like a map either way. So each of these asserts the
 * thing the construction was supposed to guarantee, against the real geometry
 * rather than against the numbers that were typed in.
 */

import { describe, expect, it } from 'vitest';
import {
  NOT_A_BUILDING,
  ROOMS,
  ROOMS_BY_ID,
  VENUES_BY_ID,
  VENUE_LEVELS,
  roomBounds,
  roomShapes,
  venueOutline,
} from './venues';
import type { LatLng } from '../utils/geo';

/** Even-odd, on [lat, lng] rings — the form both footprints and shapes take. */
function within(ring: ReadonlyArray<readonly [number, number]>, lat: number, lng: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, aj] = [ring[i], ring[j]];
    if (ai[0] > lat !== aj[0] > lat && lng < ((aj[1] - ai[1]) * (lat - ai[0])) / (aj[0] - ai[0]) + ai[1]) {
      inside = !inside;
    }
  }
  return inside;
}

const corners = ([sw, ne]: [LatLng, LatLng]) => [
  [sw.lat, sw.lng],
  [sw.lat, ne.lng],
  [ne.lat, ne.lng],
  [ne.lat, sw.lng],
] as Array<[number, number]>;

/**
 * What is actually drawn for a room, as one ring per piece.
 *
 * `roomShapes` answers only for rooms that name shapes on a floor plan, and
 * returns nothing at all for the rest — so a test that reads it alone quietly
 * checks nothing about exactly the rooms this file is here to check. The
 * fallback is the room's own bounds, which is what the map falls back to too.
 */
const ringsOf = (id: string) => {
  const room = ROOMS_BY_ID[id];
  const drawn = roomShapes(room).map((ring) => ring.map((p) => [p[0], p[1]] as [number, number]));
  return drawn.length ? drawn : [corners(roomBounds(room))];
};

describe('the Makers Market, on the connector to the stadium', () => {
  it('is drawn on the arm of the building the plans leave out', () => {
    // The connector is a 23 m wide arm running 119 m south off the corner of a
    // 265 m building. It is in the convention centre's OpenStreetMap footprint
    // and not in its floor plans, which is why it is a venue of its own — and
    // the check that it is the *right* shape is that every corner of it is a
    // point the ICC's own footprint contains.
    const outline = VENUES_BY_ID.icc.footprint.map((p) => [p[0], p[1]] as [number, number]);
    const arm = VENUES_BY_ID['pedestrian-connector'].footprint;
    expect(arm.length).toBeGreaterThan(3);
    for (const [lat, lng] of arm) {
      // Half a metre in from the edge, since the ring runs along the ICC's own
      // boundary and a point exactly on a boundary belongs to neither side.
      const inward = lat > 39.7622 ? lat - 0.000005 : lat + 0.000005;
      expect(within(outline, lat, lng) || within(outline, inward, lng), `${lat},${lng}`).toBe(true);
    }
  });

  it('runs south of the whole convention centre, not through it', () => {
    // The arm is south of the building, so the market on it must be south of
    // every room in the building. A ring that crept north would be a corridor
    // drawn through the exhibit halls, and it would still look like a corridor.
    const north = Math.max(...ringsOf('makers-market').flat().map(([lat]) => lat));
    for (const room of ROOMS) {
      if (room.venueId !== 'icc') continue;
      const south = Math.min(...ringsOf(room.id).flat().map(([lat]) => lat));
      expect(south, `${room.id} is further south than the connector begins`).toBeGreaterThan(north);
    }
  });

  it('reaches the street the stadium is across, since that is the point of it', () => {
    // A connector that stopped short of South Street would be a corridor to
    // nowhere. Its south end and the Block Party's north kerb are the same
    // place, within the width of a pavement.
    const arm = VENUES_BY_ID['pedestrian-connector'].footprint;
    const kerb = Math.max(...VENUES_BY_ID['block-party'].footprint.map(([lat]) => lat));
    const foot = Math.min(...arm.map(([lat]) => lat));
    expect(Math.abs(foot - kerb) * 111_320).toBeLessThan(5);
  });
});

describe('Community Row, in the Sagamore Ballroom hallway', () => {
  it('fits in the gap between the ballroom and the meeting rooms, touching neither', () => {
    // The corridor is defined as what is left between two things the plan does
    // draw. If either of them moves, or if the 6 m band is mistyped, this
    // starts overlapping a room — and an overlap is invisible: the corridor is
    // simply drawn on top.
    const mine = ringsOf('community-row');
    for (const room of ROOMS) {
      if (room.venueId !== 'icc' || room.level !== 'Level 2' || room.id === 'community-row') continue;
      for (const theirs of ringsOf(room.id)) {
        for (const ring of mine) {
          for (const [lat, lng] of ring) expect(within(theirs, lat, lng), `${room.id}`).toBe(false);
          for (const [lat, lng] of theirs) expect(within(ring, lat, lng), `${room.id}`).toBe(false);
        }
      }
    }
  });

  it('is against the ballroom rather than merely on the same floor', () => {
    // "In the hallway outside the Sagamore" is the whole of what is known about
    // where it is, so a room that drifted to the other end of Level 2 would
    // still be on the right floor and still be wrong. Ten metres is a corridor;
    // anything more is a different part of the building.
    const mine = ringsOf('community-row').flat();
    const ballroom = ringsOf('sagamore-ballroom').flat();
    const gap = Math.min(
      ...mine.flatMap(([lat, lng]) =>
        ballroom.map(([bl, bg]) => Math.hypot((lat - bl) * 111_320, (lng - bg) * 85_657)),
      ),
    );
    expect(gap).toBeLessThan(10);
  });

  it('holds both names for it, because the tables run straight through', () => {
    const aliases = ROOMS_BY_ID['community-row'].aliases ?? [];
    expect(aliases).toContain('Community Row');
    expect(aliases).toContain('Educator Row');
  });
});

describe('the Block Party, which is a street', () => {
  it('is between the two buildings rather than inside either', () => {
    // Drawn from the kerbs of West South Street, so it must land in the gap.
    // A ring that crept into the convention centre or the stadium would be a
    // street party drawn indoors.
    const street = VENUES_BY_ID['block-party'].footprint.map((p) => [p[0], p[1]] as [number, number]);
    for (const id of ['icc', 'lucas-oil']) {
      const building = VENUES_BY_ID[id].footprint.map((p) => [p[0], p[1]] as [number, number]);
      for (const [lat, lng] of street) expect(within(building, lat, lng), `${id}`).toBe(false);
      for (const [lat, lng] of building) expect(within(street, lat, lng), `${id}`).toBe(false);
    }
  });

  it('is a long thin block of street, not a square of ground', () => {
    // Measured off the ring rather than read off the anchor, so it is a check
    // on the four corners taken from the pavement ways. A latitude and a
    // longitude transposed, or a digit dropped, stops making a street.
    const ring = VENUES_BY_ID['block-party'].footprint;
    const lats = ring.map(([lat]) => lat);
    const lngs = ring.map(([, lng]) => lng);
    const along = (Math.max(...lngs) - Math.min(...lngs)) * 85_657;
    const across = (Math.max(...lats) - Math.min(...lats)) * 111_320;
    expect(along).toBeGreaterThan(250);
    expect(across).toBeLessThan(40);
    // And the anchor agrees with it, since that is what the room is drawn from.
    const anchor = VENUES_BY_ID['block-party'].anchor;
    expect(Math.abs(anchor.widthMetres - along)).toBeLessThan(5);
    expect(Math.abs(anchor.heightMetres - across)).toBeLessThan(5);
    expect(anchor.nw.lat).toBe(Math.max(...lats));
    expect(anchor.nw.lng).toBe(Math.min(...lngs));
  });

  it('says it is not a building, since its outline is a judgement', () => {
    // The room pop-up reads this to decide what claim to make about the
    // outline. Left out, the Block Party would claim the accuracy of a
    // surveyed footprint for a closure whose extent nobody publishes.
    expect(NOT_A_BUILDING.has('block-party')).toBe(true);
    expect(NOT_A_BUILDING.has('icc')).toBe(false);
    // And it is still drawn: a venue with no outline is a venue nobody finds.
    expect(venueOutline(VENUES_BY_ID['block-party']).length).toBeGreaterThan(3);
  });

  it('draws the whole street rather than pretending to place each stand', () => {
    // 30 food trucks and 15 booths are numbered in the stand list and none of
    // the numbers is published against a pitch. One room for the street is the
    // honest shape of that.
    const room = ROOMS.filter((r) => r.venueId === 'block-party');
    expect(room).toHaveLength(1);
    expect(room[0].fillsVenue).toBe(true);
  });
});

describe('what the three have in common', () => {
  it('zooms each of them to somewhere its own building is', () => {
    // `roomBounds` is what "zoom to room" flies to, and it comes from `rect`
    // rather than from the drawn shape — so a rectangle that was right on the
    // plan and wrong in the grid draws in one place and flies to another.
    for (const id of ['makers-market', 'community-row', 'block-party-street']) {
      const room = ROOMS_BY_ID[id];
      const outline = venueOutline(VENUES_BY_ID[room.venueId]).map(
        (p) => [p[0], p[1]] as [number, number],
      );
      const lats = outline.map(([lat]) => lat);
      const lngs = outline.map(([, lng]) => lng);
      for (const [lat, lng] of corners(roomBounds(room))) {
        expect(lat, id).toBeGreaterThanOrEqual(Math.min(...lats));
        expect(lat, id).toBeLessThanOrEqual(Math.max(...lats));
        expect(lng, id).toBeGreaterThanOrEqual(Math.min(...lngs));
        expect(lng, id).toBeLessThanOrEqual(Math.max(...lngs));
      }
    }
  });

  it('draws each of them on a level the map offers', () => {
    // A room on a level the floor picker does not list is a room that never
    // appears: the building opens, the level it is on is not one of the
    // buttons, and nothing says so.
    for (const id of ['makers-market', 'community-row', 'block-party-street']) {
      const room = ROOMS_BY_ID[id];
      expect(VENUE_LEVELS[room.venueId], id).toContain(room.level);
    }
    expect(ROOMS_BY_ID['community-row'].level).toBe('Level 2');
    expect(ROOMS_BY_ID['makers-market'].venueId).toBe('pedestrian-connector');
  });
});
