/**
 * The stand list, and the one thing it is not.
 *
 * This table is generated from Gen Con's own exhibitor browser, and every way
 * it can go wrong is quiet. A label that fails to split leaves an exhibitor
 * filed under the tail of its own name; a booth number that fails to parse
 * leaves a booth nobody can look up; and a row whose area names a room the map
 * has under a different name simply never matches, which looks exactly like an
 * exhibitor who is not there.
 *
 * The last group is the point of the final test here. 47 of the 846 locations
 * name a room the map draws, and it matters that they name it the *same way*
 * the schedule does — because the same matcher reads both, and if it stops
 * agreeing with itself nothing says so.
 */

import { describe, expect, it } from 'vitest';
import { EXHIBITORS } from './exhibitors';
import { roomIdForExhibitor, search } from './search';
import { ROOMS_BY_ID } from './venues';

const NO_EVENTS = { entries: [] };

describe('the table itself', () => {
  it('has the campus in it, and one row per place rather than per exhibitor', () => {
    // A publisher with four booths, a demo hall and a meeting room is six
    // places somebody might be looking for, and collapsing them to one would
    // lose five of them.
    expect(EXHIBITORS.length).toBeGreaterThan(700);
    const names = new Set(EXHIBITORS.map((e) => e.name));
    expect(names.size).toBeLessThan(EXHIBITORS.length);
    expect(names.size).toBeGreaterThan(700);
  });

  it('fills in every field, because a blank one is a label that failed to split', () => {
    for (const exhibitor of EXHIBITORS) {
      for (const [field, value] of Object.entries({
        name: exhibitor.name,
        kind: exhibitor.kind,
        area: exhibitor.area,
        spot: exhibitor.spot,
      })) {
        expect(value, `${exhibitor.name}: ${field}`).toBeTruthy();
        expect(value.trim(), `${exhibitor.name}: ${field}`).toBe(value);
      }
    }
  });

  it('keeps a name with a colon in it whole', () => {
    // Gen Con separates the parts of a label with a *spaced* colon, and at
    // least one exhibitor has an unspaced one in its name. Splitting on every
    // colon files `ICC : Hall E : Magic: the Gathering` under an area of
    // "ICC : Hall E : Magic" and a spot of "the Gathering" — two fields wrong,
    // no error, and the stand unfindable by the name on it.
    const areas = new Set(EXHIBITORS.map((e) => e.area));
    for (const area of areas) expect(area).not.toMatch(/Magic$/);
    expect(EXHIBITORS.some((e) => e.spot.includes(':'))).toBe(true);
  });

  it('lists a small set of areas, since a split gone wrong invents hundreds', () => {
    // The failure this catches is a separator that stops matching: every label
    // then becomes its own area, and the table still loads and still looks like
    // a table.
    const areas = new Set(EXHIBITORS.map((e) => e.area));
    expect(areas.size).toBeLessThan(30);
    expect(areas).toContain('Exhibit Hall');
  });

  it('numbers the exhibit hall, where a number is the only way to be found', () => {
    // 573 of these, and a booth with no number is a stand nobody can look up.
    const hall = EXHIBITORS.filter((e) => e.area === 'Exhibit Hall');
    expect(hall.length).toBeGreaterThan(500);
    for (const stand of hall) {
      expect(stand.spot, stand.name).toMatch(/^Booth /);
      expect(stand.booth, stand.name).toMatch(/^[0-9]+$/);
      expect(stand.spot, stand.name).toBe(`Booth ${stand.booth}`);
    }
  });

  it('takes each booth number off the end of the spot it came from', () => {
    for (const exhibitor of EXHIBITORS) {
      if (!exhibitor.booth) continue;
      expect(exhibitor.spot.endsWith(exhibitor.booth), `${exhibitor.name}: ${exhibitor.spot}`).toBe(true);
    }
  });
});

describe('where the map and the stand list agree', () => {
  it('finds the room an exhibitor names, and finds no wrong one', () => {
    // Every area that resolves, and what it resolves to. Written out rather
    // than counted: a matcher change that quietly moved Hall B's stands into
    // Hall C would keep the count and be wrong about the room, which is the
    // only thing a reader of this actually wants.
    const found = new Map<string, Set<string>>();
    for (const exhibitor of EXHIBITORS) {
      const roomId = roomIdForExhibitor(exhibitor);
      if (!roomId) continue;
      found.set(exhibitor.area, (found.get(exhibitor.area) ?? new Set()).add(roomId));
    }
    expect(Object.fromEntries([...found].map(([area, ids]) => [area, [...ids].sort()]))).toEqual({
      'ICC : Hall A': ['hall-a'],
      'ICC : Hall B': ['hall-b'],
      'ICC : Hall C': ['hall-c'],
      'ICC : Hall D': ['hall-d'],
      'ICC : Hall E': ['hall-e'],
      // Gen Con writes these as `ICC : Rm 140`, and the map draws the meeting
      // rooms in blocks, so a room resolves to the block that contains it.
      ICC: ['rooms-120-128', 'rooms-130-145', 'rooms-231-245', 'sagamore-ballroom'],
      'Stadium : West Club Lounge': ['lucas-oil-west-club'],
    });
    for (const ids of found.values()) for (const id of ids) expect(ROOMS_BY_ID[id], id).toBeDefined();
  });

  it('leaves the exhibit hall unplaced, and says so rather than picking a hall', () => {
    // The honest half of this table. `Exhibit Hall : Booth 1637` does not say
    // which of the eleven halls, and neither do the coordinates Gen Con's map
    // carries — they are laid out area by area on a star field rather than on a
    // plan of the building. Guessing would put a stand in the wrong hall and
    // nothing on screen would admit it.
    const hall = EXHIBITORS.filter((e) => e.area === 'Exhibit Hall');
    expect(hall.length).toBeGreaterThan(500);
    for (const stand of hall) expect(roomIdForExhibitor(stand), stand.name).toBeNull();
  });
});

describe('searching for a publisher rather than a room', () => {
  it('takes an exhibitor name to the room they are standing in', () => {
    // Asmodee's demo space is Hall E, and "Asmodee" is the word somebody types
    // — it is on the stand, on the box and in the programme, and it is not one
    // of the room's own names, so without this the search has nothing.
    const hits = search('asmodee', NO_EVENTS);
    expect(hits.map((hit) => hit.room.id)).toContain('hall-e');
  });

  it('ranks a room found by who is in it below one found by its own name', () => {
    // The guarantee, asserted on the score rather than on an ordering, because
    // today no exhibitor is named after a room and a test on the ordering
    // could not fail. It will matter the first year one is: a publisher called
    // "Wabash" must not take "wabash" away from the Wabash Ballroom.
    const named = search('hall e', NO_EVENTS).find((hit) => hit.room.id === 'hall-e')!;
    const standing = search('asmodee', NO_EVENTS).find((hit) => hit.room.id === 'hall-e')!;
    expect(named).toBeDefined();
    expect(standing).toBeDefined();
    expect(standing.score).toBeGreaterThan(named.score);
  });

  it('offers nothing for a stand whose hall is unknown', () => {
    // Kenzer and Company is `Exhibit Hall : Booth 1229`. Rather than send
    // somebody to whichever hall a guess landed on, the search has no answer —
    // which is the same thing it does for a room the map has never heard of.
    expect(EXHIBITORS.some((e) => e.name === 'Kenzer and Company')).toBe(true);
    expect(search('kenzer', NO_EVENTS)).toEqual([]);
  });
});
