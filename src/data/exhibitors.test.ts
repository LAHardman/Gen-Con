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
const ids = (query: string) =>
  search(query, NO_EVENTS)
    .filter((hit) => hit.room)
    .map((hit) => hit.room!.id);

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
      // The exhibit hall names no hall in its words. Its booth numbers do,
      // and they reach all six halls the grid runs through.
      'Exhibit Hall': ['hall-f', 'hall-g', 'hall-h', 'hall-i', 'hall-j', 'hall-k'],
      // Two names for the two ends of one corridor, and both have to land in
      // it: the tables are numbered 1–19 straight through, and splitting them
      // across two rooms would put table 15 and table 16 in different places.
      'ICC : Community Row': ['community-row'],
      'ICC : Educator Row': ['community-row'],
      // Areas with no building in front of them — see `AREA_ROOMS`.
      'Makers Market': ['makers-market'],
      'Block Party': ['block-party-street'],
      Field: ['lucas-oil-field'],
      // Three lettered blocks of tables inside Exhibit Hall I. The schedule
      // says so for the middle one, in among 27,467 events that name a hall
      // twice otherwise: `Exhibit Hall I` in the room, `Authors Avenue` in the
      // table, 18 times.
      'Art Show': ['hall-i'],
      'Authors Ave': ['hall-i'],
      'Entertainers Spotlight': ['hall-i'],
    });
    for (const ids of found.values()) for (const id of ids) expect(ROOMS_BY_ID[id], id).toBeDefined();
  });

  it('places a stand in the exhibit hall by its booth number', () => {
    // The words say `Exhibit Hall : Booth 1637` and there are eleven halls, so
    // this is the number's doing — see `booths.ts`, and the two rows of the
    // schedule that confirm the table is not back to front.
    const hall = EXHIBITORS.filter((e) => e.area === 'Exhibit Hall');
    expect(hall.length).toBeGreaterThan(500);
    // Every one of them, which is the point: the words place none.
    expect(hall.filter((stand) => roomIdForExhibitor(stand))).toHaveLength(hall.length);
    expect(roomIdForExhibitor(hall.find((e) => e.booth === '1637')!)).toBe('hall-h');
    expect(roomIdForExhibitor(hall.find((e) => e.booth === '174')!)).toBe('hall-j');
  });
});

describe('searching for a publisher rather than a room', () => {
  it('takes an exhibitor name to the room they are standing in', () => {
    // Asmodee's demo space is Hall E, and "Asmodee" is the word somebody types
    // — it is on the stand, on the box and in the programme, and it is not one
    // of the room's own names, so without this the search has nothing.
    const hits = search('asmodee', NO_EVENTS);
    expect(hits.map((hit) => hit.room?.id)).toContain('hall-e');
  });

  it('ranks a room found by who is in it below one found by its own name', () => {
    // The guarantee, asserted on the score rather than on an ordering, because
    // today no exhibitor is named after a room and a test on the ordering
    // could not fail. It will matter the first year one is: a publisher called
    // "Wabash" must not take "wabash" away from the Wabash Ballroom.
    const named = search('hall e', NO_EVENTS).find((hit) => hit.room?.id === 'hall-e')!;
    const standing = search('asmodee', NO_EVENTS).find((hit) => hit.room?.id === 'hall-e')!;
    expect(named).toBeDefined();
    expect(standing).toBeDefined();
    expect(standing.score).toBeGreaterThan(named.score);
  });

  it('takes an exhibit-hall stand to the hall its number places it in', () => {
    // Kenzer and Company is `Exhibit Hall : Booth 1229`, which names no hall.
    // This used to find nothing at all.
    expect(EXHIBITORS.some((e) => e.name === 'Kenzer and Company')).toBe(true);
    expect(ids('kenzer')).toEqual(['hall-i']);
  });

  it('takes the name of a place with no building in front of it to that place', () => {
    // `Makers Market`, `Block Party` and `Field` are areas that name somewhere
    // directly rather than a building and a space inside it, so the matcher
    // that works down from a building has nothing to work down from. Each is
    // typed as its own word and has to reach its own room.
    expect(ids('makers market')).toContain('makers-market');
    expect(ids('block party')).toContain('block-party-street');
    // And through an exhibitor standing there, which is the other way in.
    expect(ids('nerdy nixies')).toEqual(['makers-market']);
    expect(ids('sun king')).toEqual(['block-party-street']);
  });

  it('takes the three blocks of tables in Exhibit Hall I to Exhibit Hall I', () => {
    // The printed plan draws these as one block between the 600s and the
    // 1100s and letters no hall on it. What settles it is the schedule: 18
    // rows read `Exhibit Hall I` in the room and `Authors Avenue` in the
    // table, which places the middle of the block from a source that had no
    // part in reading the plan.
    for (const query of ['art show', 'authors avenue', 'entertainers spotlight']) {
      expect(ids(query)[0], query).toBe('hall-i');
    }
    // And through the people at the tables, which is what somebody types.
    for (const area of ['Art Show', 'Authors Ave', 'Entertainers Spotlight']) {
      const rows = EXHIBITORS.filter((e) => e.area === area);
      expect(rows.length, area).toBeGreaterThan(5);
      for (const row of rows) expect(roomIdForExhibitor(row), row.name).toBe('hall-i');
    }
  });

  it('keeps Community Row and Educator Row together, because the tables are one run', () => {
    // Two names, one corridor. The stand list numbers them 1 to 19 straight
    // through and files 16–19 under the second name, so splitting them would
    // put table 15 and table 16 in different rooms — and the numbers on the
    // tables would be the thing saying otherwise.
    const rows = EXHIBITORS.filter((e) => e.area.endsWith('Community Row') || e.area.endsWith('Educator Row'));
    const numbers = rows.map((e) => Number(e.spot.replace('Table ', ''))).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    for (const row of rows) expect(roomIdForExhibitor(row), row.name).toBe('community-row');
    expect(ids('community row')).toContain('community-row');
    expect(ids('educator row')).toContain('community-row');
  });

  it('offers nothing for a stand in an area nobody has placed', () => {
    // This used to be asserted against the Art Show, which was one of six areas
    // that reached no room. All 846 locations resolve now, so there is no real
    // row left to assert it on — and the guarantee still has to hold, because
    // the way it breaks is the *next* area Gen Con invents. A stand in one
    // reaches nothing rather than reaching whatever is nearest, which would put
    // somebody in a hall their exhibitor is not in and look like an answer.
    const invented = {
      name: 'Zzyzx Trading Post',
      kind: 'Exhibitor',
      area: 'Riverside Pavilion',
      spot: 'Table 4',
    } as (typeof EXHIBITORS)[number];
    expect(roomIdForExhibitor(invented)).toBeNull();
    expect(search('zzyzx', NO_EVENTS)).toEqual([]);
  });

  it('leaves no stand at all unplaced, which is the whole of the job', () => {
    // Counted rather than sampled: the number is the deliverable. It went 47,
    // 494, 621, 846 as the halls, the cross wall, the three unlettered places
    // and Hall I's tables were worked out, and every one of those steps was a
    // sentence from somebody who has walked the building.
    const unplaced = EXHIBITORS.filter((e) => !roomIdForExhibitor(e));
    expect(unplaced.map((e) => `${e.area} · ${e.name}`)).toEqual([]);
    expect(EXHIBITORS).toHaveLength(846);
  });
});
