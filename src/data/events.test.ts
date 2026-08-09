/**
 * Tying an event's location text to a room on the map.
 *
 * The other module that fails by returning nothing. A schedule whose events
 * resolve to no room still renders: the list works, the search works, the map
 * simply has nothing on it, and there is no error anywhere. So what is pinned
 * here is not that bad input is survived but that **good input resolves**, and
 * that the near-misses stay near-misses.
 *
 * The strings below are real. Every `locationText` the source produces is in
 * here — there are only twenty-two of them across 27,467 events — and the room
 * texts are the shapes it actually writes, taken from the same import.
 */

import { describe, expect, it } from 'vitest';
import { eventUrl, roomIdForEvent, venueIdForEvent, type ConEvent } from './events';
import { ROOMS_BY_ID, VENUES_BY_ID } from './venues';

const at = (locationText: string, roomText?: string, tableText?: string): ConEvent => ({
  id: 'test',
  title: 'A game of something',
  locationText,
  roomText,
  tableText,
  start: '2026-08-01T10:00:00-04:00',
});

describe('every location the source writes', () => {
  /**
   * The twenty-two distinct `Location` values in a full import, with how many
   * events carry each. The seven with no venue are real places that are not on
   * this map — the map covers the convention's own venues, and these are a loft,
   * two restaurants, a ballpark, a park and an office address.
   */
  const LOCATIONS: Array<[location: string, events: number, venueId: string | null]> = [
    ['ICC', 15581, 'icc'],
    ['Stadium', 4984, 'lucas-oil'],
    ['JW', 2832, 'jw-marriott'],
    ['Marriott', 800, 'marriott-downtown'],
    ['Crowne Plaza', 646, 'crowne-plaza'],
    ['Westin', 627, 'westin'],
    ['Hyatt', 587, 'hyatt'],
    ['Hilton', 298, 'hilton'],
    ['Union Station', 272, 'crowne-plaza'],
    ['The Escape Room USA', 270, 'escape-room'],
    ['Omni', 216, 'omni'],
    ['Embassy Suites', 164, 'embassy-suites'],
    ['Indiana Repertory Theater', 85, 'indiana-rep'],
    // The source's own typo, carried in the aliases because 44 events use it.
    ['HIlton', 44, 'hilton'],
    ['Le Meridien', 21, 'le-meridien'],
    ['Janus Lofts', 28, null],
    ['Taxman CityWay', 6, null],
    ['St. Elmo Steak House', 2, null],
    ['416 Wabash', 1, null],
    ['Victory Field', 1, null],
    ['White River State Park', 1, null],
    ['The Oceanaire Seafood Room', 1, null],
  ];

  it('resolves to the building it names, or to nothing at all', () => {
    for (const [location, , venueId] of LOCATIONS) {
      expect(venueIdForEvent(at(location)), location).toBe(venueId);
    }
  });

  it('names a building that exists wherever it names one', () => {
    for (const [, , venueId] of LOCATIONS) {
      if (venueId) expect(VENUES_BY_ID[venueId], venueId).toBeDefined();
    }
  });

  it('leaves a place the map does not cover unmatched rather than nearly right', () => {
    // "416 Wabash" is an office five blocks east of the convention centre, and
    // it used to land in the convention centre's Wabash Ballroom on the
    // strength of one word — with nothing in the result to say it was a guess.
    // Unmatched puts it in the import's report, which is where a location the
    // map does not know belongs.
    expect(roomIdForEvent(at('416 Wabash', '416 E Wabash St'))).toBeNull();
    expect(roomIdForEvent(at('Victory Field', '501 W Maryland St'))).toBeNull();
    expect(roomIdForEvent(at('St. Elmo Steak House', '127 S Illinois St'))).toBeNull();
  });
});

describe('finding the room inside the building', () => {
  it('reads the shapes the source actually writes', () => {
    // Real pairs, with how many events carry each in a full import. Taken
    // from the import rather than written by hand: several of them cross
    // buildings in ways that are not guessable — "Grand Central A--D" is the
    // Crowne Plaza's, not the Marriott's.
    const CASES: Array<[location: string, room: string, roomId: string]> = [
      ['ICC', 'Hall B : Orange', 'hall-b'],                       // 564
      ['ICC', 'Sagamaore Ballroom 3--5', 'sagamore-ballroom'],    // 596, and the source's typo
      ['ICC', 'Wabash - West Concourse', 'wabash-ballroom'],
      ['ICC', '235--239', 'rooms-231-245'],
      ['ICC', '140', 'rooms-130-145'],
      ['Stadium', 'Exhibit Hall 1--2', 'lucas-oil-exhibit-halls'], // 790
      ['Stadium', 'East Concourse', 'lucas-oil-east-concourse'],   // 614
      ['Stadium', 'Field : Fight in the Skies', 'lucas-oil-field'],
      ['JW', 'Griffin Hall', 'jw-griffin-hall'],                   // 919
      ['JW', 'Grand Ballroom 1--2', 'jw-grand-ballroom'],          // 247
      ['JW', 'White River Ballroom E', 'jw-white-river-ef'],       // 175
      ['Crowne Plaza', 'Grand Central A--D', 'crowne-grand-central'],   // 385
      ['Crowne Plaza', 'Illinois Street Ballroom', 'crowne-illinois-ballroom'], // 115
      ['Union Station', 'Illinois Central', 'union-illinois-central'],  // 31
      ['Union Station', 'Grand Hall', 'union-grand-hall'],
      ['Westin', 'Grand Ballroom IV', 'westin-grand-ballroom'],    // 275
      ['Hilton', 'Victory Ballroom', 'hilton-victory-ballroom'],   // 160
      ['Hyatt', 'Cosmopolitan Ballroom B', 'hyatt-cosmopolitan'],  // 97
      ['Marriott', 'Indiana Ballroom F--G', 'marriott-indiana-ballroom'], // 82
      ['Marriott', 'Marriott Ballroom 7--8', 'marriott-ballroom'], // 66
      ['Omni', 'Gates Hall', 'omni-gates-hall'],                   // 83
      ['Embassy Suites', 'Consulate', 'embassy-consulate'],        // 21
      ['Le Meridien', 'Latitude', 'le-meridien-latitude'],         // 21
      ['The Escape Room USA', '200 S. Meridian St', 'escape-room-venue'], // 270
      ['Indiana Repertory Theater', '140 W Washington St', 'indiana-rep-stage'], // 84
    ];
    for (const [location, room, roomId] of CASES) {
      expect(roomIdForEvent(at(location, room)), `${location} / ${room}`).toBe(roomId);
      expect(ROOMS_BY_ID[roomId], roomId).toBeDefined();
    }
  });

  it('keeps two buildings numbered the same way apart', () => {
    // Both the convention centre and the JW have a room 103, and the `Room`
    // field says only "103". Resolving the building first is the entire reason
    // these do not collide, and a flat search over every room on the campus
    // cannot tell them apart at all.
    expect(roomIdForEvent(at('ICC', '103'))).toBe('rooms-101-117');
    expect(roomIdForEvent(at('JW', '103'))).toBe('jw-rooms-101-104');
  });

  it('resolves a room by a name the building also goes by', () => {
    // Two of these are only matchable through `venues.ts`'s aliases, and both
    // are common: the Hilton's Victory Ballroom is signed Monument Hall for
    // 114 events, and the Crowne Plaza's Haymarket Station is written Edison
    // North and Edison South for 25 more. Losing an alias loses those events
    // silently, since the building still resolves.
    expect(roomIdForEvent(at('Hilton', 'Monument Hall'))).toBe('hilton-victory-ballroom');
    expect(roomIdForEvent(at('Union Station', 'Edison North'))).toBe('crowne-haymarket');
  });

  it('lets the longer name win where two rooms both match', () => {
    // Union Station's Grand Hall and its Grand Hall Bar are two rooms, and
    // "Grand Hall Bar" contains both names. Taking the first match rather than
    // the longest puts everything in the bar into the hall — which is a real
    // event, and would read as a right answer because the building is right
    // and the room next door.
    expect(roomIdForEvent(at('Union Station', 'Grand Hall Bar'))).toBe('union-grand-bar');
    expect(roomIdForEvent(at('Union Station', 'Grand Hall'))).toBe('union-grand-hall');
    expect(roomIdForEvent(at('ICC', 'Exhibit Hall J'))).toBe('hall-j');
    expect(roomIdForEvent(at('ICC', 'Exhibit Hall E'))).toBe('hall-e');
  });

  it('matches a number only where the number ends', () => {
    // Room "201" must not be found inside "2010", which is a different room and
    // in some buildings a year. This is why matching is on token boundaries
    // rather than a substring search.
    expect(roomIdForEvent(at('ICC', '201'))).toBe('rooms-201-212');
    expect(roomIdForEvent(at('ICC', '2010'))).toBeNull();
  });

  it('falls back to the building where the map draws it as one room', () => {
    // Three venues have no interior on the map. Their events still have to land
    // on the right building, so an unrecognised room resolves to the whole of
    // it — but only for those three, which is what `fillsVenue` marks.
    expect(roomIdForEvent(at('The Escape Room USA', 'anywhere at all'))).toBe('escape-room-venue');
    expect(roomIdForEvent(at('Indiana Repertory Theater', 'Upperstage'))).toBe('indiana-rep-stage');
    // The convention centre is not one of them, so the same treatment there
    // would put an unrecognised room in the middle of a 400 m building.
    expect(roomIdForEvent(at('ICC', 'somewhere unrecognised'))).toBeNull();
  });

  it('places a stand by its booth number, which is all the source gives it', () => {
    // `Exhibit Hall Booth #1229` names no hall and there are eleven, so this
    // used to be 79 of the 130 unmatched events. The number places it once you
    // know where the air walls are (`booths.ts`), and the schedule's own two
    // hall-naming rows are what confirm the table is not back to front.
    expect(roomIdForEvent(at('ICC', 'Exhibit Hall Booth #1229'))).toBe('hall-i');
    expect(roomIdForEvent(at('ICC', 'Exhibit Hall', 'Booth #2411'))).toBe('hall-g');
    // Where the words do name a hall, the words win: a row that says J is J,
    // whatever a table of numbers would have made of it.
    expect(roomIdForEvent(at('ICC', 'Exhibit Hall J : Booth #174'))).toBe('hall-j');
    // And the source agreeing with itself, which is the check worth having:
    // this row names Hall G in its words and 2667 in its table.
    expect(roomIdForEvent(at('ICC', 'Exhibit Hall G', 'Booth #2667'))).toBe('hall-g');
  });

  it('leaves a room it cannot place unmatched rather than guessing the building', () => {
    /*
     * 51 events of 27,467 resolve to no room — 0.19%, down from 130 — and
     * every one of them is a place the map has not got rather than a matcher
     * failure:
     *
     *   40  the seven venues above that are not on the map at all
     *   11  foyers and concourse spots no room is authored for: "North Plaza",
     *       "Georgia Street Entrance", "3rd Floor Foyer"
     *
     * Guessing a building for those would read exactly like a right answer.
     */
    expect(roomIdForEvent(at('ICC', 'Georgia Street Entrance'))).toBeNull();
    expect(roomIdForEvent(at('Stadium', 'North Plaza'))).toBeNull();
    expect(roomIdForEvent(at('JW', '3rd Floor Foyer'))).toBeNull();
    // A booth with no number is not a stand. This one is real.
    expect(roomIdForEvent(at('ICC', 'Floor next to Hoosier Concourse Info Booth'))).toBeNull();
    // The building is still known, which is what the report prints.
    expect(venueIdForEvent(at('ICC', 'Georgia Street Entrance'))).toBe('icc');
  });

  it('reads a room the schedule spells wrong', () => {
    // `Union Station : Eerie`, on one event of 27,467. Every room along that
    // concourse is named for a railroad — Monon, Nickel Plate, Wabash, B & O —
    // and there is no Eerie Railroad, so it is the Erie with a letter too many
    // at the source. Carried as an alias rather than corrected in the importer,
    // because the importer writes what Gen Con publishes and this is the layer
    // that knows what the rooms are called.
    expect(roomIdForEvent(at('Union Station', 'Eerie'))).toBe('union-erie');
    expect(roomIdForEvent(at('Union Station', 'Erie'))).toBe('union-erie');
  });

  it('reads the table field as well as the room', () => {
    // Some events name the space only in `Table`, and the two are searched
    // together rather than the room alone.
    expect(roomIdForEvent(at('ICC', undefined, 'Hall B'))).toBe('hall-b');
  });

  it('has no room for an event with no location at all', () => {
    expect(venueIdForEvent(at(''))).toBeNull();
    expect(roomIdForEvent(at(''))).toBeNull();
  });
});

describe('the link back to an event', () => {
  const at = (id: string, url?: string) =>
    ({ id, title: 't', locationText: 'ICC', start: '2026-07-30T10:00:00-04:00', url }) as ConEvent;

  it('works it out from the id, which the feed no longer says twice', () => {
    // 27,467 copies of the same thirty characters in front of a number the id
    // already carries: 1.2 MB, 93 KB of it gzipped, on the file a phone fetches
    // before it can show a single session.
    expect(eventUrl(at('BGM26ND306429'))).toBe('https://www.gencon.com/events/306429');
    expect(eventUrl(at('SEM26ND299001'))).toBe('https://www.gencon.com/events/299001');
  });

  it('keeps a URL an event brought with it', () => {
    // An older feed still on somebody's phone, or one from anywhere else. The
    // derivation is a fallback, not an override.
    expect(eventUrl(at('BGM26ND306429', 'https://example.test/elsewhere'))).toBe(
      'https://example.test/elsewhere',
    );
  });

  it('offers no link rather than a wrong one', () => {
    // An id that does not end in a number cannot name an event page, and a link
    // to `gencon.com/events/` is worse than no link: it looks like it works.
    expect(eventUrl(at('NOT-A-CODE'))).toBeUndefined();
    expect(eventUrl(at(''))).toBeUndefined();
  });
});

describe('the matcher remembers its answers', () => {
  // 1,761 distinct location combinations across 27,467 events, so the same
  // question is asked about fifteen times for every answer. Caching that took
  // 111 ms off the 125 ms `indexEvents` spent — but a cache is only as good as
  // its key, and the way this one can go wrong is collapsing two places into
  // one and filing a whole room's events in somebody else's.
  const at = (locationText: string, roomText?: string, tableText?: string): ConEvent =>
    ({ id: `${locationText}/${roomText}/${tableText}`, title: 't', locationText, roomText, tableText, start: '2026-07-30T10:00:00-04:00' });

  it('does not let one place answer for another', () => {
    // The three fields are joined to make the key, so a separator that can
    // occur in the data lets "Hall A" in one field share a key with "Hall A"
    // split across two — and every event in one would be filed in the other.
    expect(roomIdForEvent(at('ICC', 'Hall A'))).toBe('hall-a');
    expect(roomIdForEvent(at('ICC', 'Hall B'))).toBe('hall-b');
    expect(roomIdForEvent(at('ICC', 'Hall B : Outset', 'HQ'))).toBe('hall-b');
    expect(roomIdForEvent(at('ICC', 'Hall C : Green', '16'))).toBe('hall-c');
    // Same room name, different building: these must not share an answer.
    expect(roomIdForEvent(at('JW', 'White River Ballroom A'))).not.toBe(
      roomIdForEvent(at('ICC', 'Hall A')),
    );
    // And the collision the separator actually exists to prevent. Concatenated
    // plainly these two are both "ICCHall A"; they are different places and
    // must get different answers. Written out because the first version of this
    // test asserted the separator mattered and did not construct a case where
    // it did — removing it from the source failed nothing.
    expect(roomIdForEvent(at('ICC', 'Hall A'))).toBe('hall-a');
    expect(roomIdForEvent(at('ICCHall', ' A'))).not.toBe('hall-a');
  });

  it('gives the same answer the second time as the first', () => {
    for (const event of [at('ICC', 'Hall B'), at('JW', 'White River Ballroom A'), at('Stadium'), at('ICC', 'Rm 140')]) {
      const first = roomIdForEvent(event);
      expect(roomIdForEvent(event)).toBe(first);
      // And a fresh object with the same three fields, since the cache is keyed
      // on those and not on identity.
      expect(roomIdForEvent(at(event.locationText, event.roomText, event.tableText))).toBe(first);
    }
  });

  it('remembers a miss as well as a hit', () => {
    // Otherwise every unplaceable event pays the full scan every time, and the
    // unplaceable ones are exactly the ones that scan the longest.
    const nowhere = at('Somewhere Nobody Has Mapped');
    expect(roomIdForEvent(nowhere)).toBeNull();
    expect(roomIdForEvent(nowhere)).toBeNull();
  });
});
