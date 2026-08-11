/**
 * What comes back when somebody types, and in what order.
 *
 * Ordering is the whole feature. A search that returns the right eight results
 * in the wrong order is a search that put what you asked for below what you
 * didn't, and there is nothing to see: the list is full, every entry is a real
 * room, and the only sign is that you keep having to look past the first one.
 * So most of these assert the order rather than the membership.
 *
 * They also assert against the real rooms rather than a fixture, because the
 * cases that matter are the collisions the campus actually has — two buildings
 * that both number a room 104, a hotel with a Grand Hall and a Grand Bar — and
 * those are the ones a made-up fixture would never think to contain.
 */

import { describe, expect, it } from 'vitest';
import { buildEventSearchIndex, search, searchSessions, type EventSearchIndex } from './search';
import { ROOMS_BY_ID } from './venues';
import { isFood } from './food';
import { tagsOf } from './exhibitors';
import { indexEvents, type ConEvent } from './events';

const NO_EVENTS: EventSearchIndex = { entries: [] };

/** Room ids only: an address hit has no room, and most of these are about rooms. */
const ids = (query: string, events: EventSearchIndex = NO_EVENTS, limit = 8) =>
  search(query, events, limit)
    .filter((hit) => hit.room)
    .map((hit) => hit.room!.id);

/** An event in a room, with only the fields the search and the index read. */
const event = (over: Partial<ConEvent> & { title: string; roomText: string }): ConEvent => ({
  id: over.title + over.roomText + (over.start ?? ''),
  locationText: 'ICC',
  start: '2026-07-30T10:00:00-04:00',
  ...over,
});

describe('finding a room', () => {
  it('puts the room whose name starts with what you typed first', () => {
    const [first] = search('exhibit hall b', NO_EVENTS);
    expect(first.room!.id).toBe('hall-b');
    expect(first.kind).toBe('room');
  });

  it('takes an exact alias as seriously as a name', () => {
    // "Hall B" is what the schedule calls it and what is printed on it; the
    // room's actual name is "Exhibit Hall B", which that does not start.
    expect(ids('hall b')[0]).toBe('hall-b');
  });

  it('matches a word inside a name, not just the beginning of one', () => {
    // Nobody types "white river ballroom a–d" with the dash in the right place.
    const hits = ids('river');
    expect(hits.length).toBeGreaterThan(0);
    for (const id of hits) expect(id).toMatch(/^jw-white-river/);
  });

  it('puts every room above every street address, whatever was typed', () => {
    // The gazetteer is 839 addresses against 149 rooms, and on a word like
    // "river" both answer — the JW's ballrooms, and River Avenue, and the
    // Riverwalk car park. A search that let the street compete would bury the
    // campus under its own neighbourhood, so the rule is flat: an address is
    // what you get when nothing on the campus matched.
    //
    // Asserted over several queries rather than one, because the failure is a
    // score that creeps rather than a rule that breaks.
    for (const query of ['river', 'lucas oil', 'washington', 'meridian', 'illinois']) {
      const hits = search(query, NO_EVENTS, 20);
      const worstRoom = Math.max(...hits.filter((h) => h.room).map((h) => h.score), -Infinity);
      const bestAddress = Math.min(...hits.filter((h) => h.pin).map((h) => h.score), Infinity);
      expect(worstRoom, query).toBeLessThan(bestAddress);
      // And on the order, not only on the score.
      const lastRoom = hits.map((h) => Boolean(h.room)).lastIndexOf(true);
      const firstAddress = hits.map((h) => Boolean(h.pin)).indexOf(true);
      if (lastRoom !== -1 && firstAddress !== -1) expect(lastRoom, query).toBeLessThan(firstAddress);
    }
  });

  it('puts the room actually called 140 above the one whose address begins 140', () => {
    // A real ordering bug, and one nobody would have found by reading the code.
    // The Indiana Repertory Theatre's only alias is its street address, 140 W
    // Washington St, so "140" matched it as a prefix — and a prefix scored
    // *better* than an exact alias, which is what the convention centre's
    // Meeting Room 140 had. Typing a room number offered a theatre.
    const hits = search('140', NO_EVENTS, 10);
    expect(hits[0].room!.id).toBe('rooms-130-145');
    expect(hits.map((hit) => hit.room!.id)).toContain('indiana-rep-stage');

    // On the scores, not only on the order: these two also differ in name
    // length, and the tie-break would put the right one first by luck even with
    // the ranking back to front.
    const at = (id: string) => hits.find((hit) => hit.room!.id === id)!;
    expect(at('rooms-130-145').score).toBeLessThan(at('indiana-rep-stage').score);
  });

  it('ranks the three ways a name can match, in that order', () => {
    // "room" is the query that has all three on the real campus, which is why
    // it is this one: the JW's `Room 109` starts with it, the Hyatt's `Board
    // Room` has it as a later word, and `Sagamore Ballroom` merely contains it.
    // They are not equally good answers and the order is the whole of saying
    // so.
    const scored = search('room', NO_EVENTS, 40);
    const at = (id: string) => scored.find((hit) => hit.room!.id === id)!;
    const starts = at('jw-room-109');
    const word = at('hyatt-board-room');
    const anywhere = at('sagamore-ballroom');
    expect([starts, word, anywhere].every(Boolean)).toBe(true);
    expect(starts.score).toBeLessThan(word.score);
    expect(word.score).toBeLessThan(anywhere.score);
    // And the list itself is in that order, not merely scored in it.
    expect(scored.indexOf(starts)).toBeLessThan(scored.indexOf(word));
    expect(scored.indexOf(word)).toBeLessThan(scored.indexOf(anywhere));
  });

  it('breaks a tie on the shorter name', () => {
    // Five rooms called Grand something, all matched the same way. Length is
    // the only thing left, and it is the right thing: the shorter name is the
    // more likely to be the whole of what somebody meant.
    //
    // Within a score, not across it — the same query also reaches rooms
    // through the publishers standing in them, and those rank after every room
    // that matched on a name of its own however long that name is.
    const hits = search('grand', NO_EVENTS, 20);
    expect(hits.length).toBeGreaterThan(2);
    const byScore = new Map<number, number[]>();
    for (const hit of hits) byScore.set(hit.score, [...(byScore.get(hit.score) ?? []), hit.room!.name.length]);
    expect([...byScore.values()].some((lengths) => lengths.length > 1)).toBe(true);
    for (const lengths of byScore.values()) {
      expect([...lengths].sort((a, b) => a - b)).toEqual(lengths);
    }
    // And the scores themselves only ever go one way down the list.
    const scores = hits.map((hit) => hit.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
  });

  it('offers both buildings that number a room the same', () => {
    // The convention centre and the JW both have a 104, and there is nothing in
    // "104" to say which. Picking one would take half the people who type it to
    // the wrong building, and look exactly like a working search.
    const hits = search('104', NO_EVENTS, 20);
    expect(new Set(hits.map((hit) => hit.room!.venueId)).size).toBeGreaterThan(1);
    expect(hits.map((hit) => hit.room!.id)).toEqual(
      expect.arrayContaining(['rooms-101-117', 'jw-rooms-101-104']),
    );
  });

  it('takes the name of a thing inside a hall to the hall it is inside', () => {
    // The Family Fun Pavilion is a corner of Hall H, not a room of its own, and
    // "family fun" is what is printed on it and what somebody types. It used to
    // be an alias of Hall K — the far end of the building, four hundred metres
    // and one wrong turn away — on nothing more than a recollection.
    expect(ids('family fun')[0]).toBe('hall-h');
    expect(ids('family fun')).not.toContain('hall-k');
  });

  it('finds a room by the building it is in', () => {
    const hits = search('lucas oil', NO_EVENTS, 20).filter((hit) => hit.room);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.room!.venueId).toBe('lucas-oil');
  });

  it('ranks the building below anything the room itself is called', () => {
    // "Westin" matches every room in the Westin by its building, and the
    // Westin's own Grand Ballroom by name. The named one is what was meant.
    const byName = search('grand ballroom', NO_EVENTS, 20);
    const byVenue = search('westin', NO_EVENTS, 20);
    expect(byName[0].score).toBeLessThan(byVenue[0].score);
  });

  it('will not answer a house number with a house on a different street', () => {
    // The number alone is nothing: downtown has a 127 on South Illinois, on
    // North Pennsylvania and on West Washington, and offering all of them to
    // somebody who typed the street is three wrong answers and one right one
    // in no particular order. The street has to match too.
    const wrong = search('127 s illinois', NO_EVENTS, 10).filter(
      (hit) => hit.pin && !/illinois/i.test(hit.pin.address),
    );
    expect(wrong.map((hit) => hit.pin!.address)).toEqual([]);
    // And the right one is still found, so this is not passing by finding none.
    expect(search('127 s illinois', NO_EVENTS, 10).some((hit) => hit.pin)).toBe(true);
  });

  it('says nothing at all for one character', () => {
    // "h" matches most of the campus. An eight-item list assembled from that is
    // noise arriving before anybody has finished typing.
    expect(search('h', NO_EVENTS)).toEqual([]);
    expect(search('', NO_EVENTS)).toEqual([]);
    expect(search('ha', NO_EVENTS).length).toBeGreaterThan(0);
  });

  it('stops at the limit it was given', () => {
    expect(search('hall', NO_EVENTS, 3)).toHaveLength(3);
    expect(search('hall', NO_EVENTS, 20).length).toBeGreaterThan(3);
  });
});

describe('finding an event', () => {
  const feed = (events: ConEvent[]) => buildEventSearchIndex(indexEvents(events));

  it('takes you to the room the event is in', () => {
    // An event is not a place; the hit is really a hit on where it happens.
    const events = feed([event({ title: 'Learn to Play Catan', roomText: 'Exhibit Hall B' })]);
    const [hit] = search('catan', events);
    expect(hit.kind).toBe('event');
    expect(hit.room!.id).toBe('hall-b');
    expect(hit.event?.title).toBe('Learn to Play Catan');
  });

  it('collapses repeats of one title in one room, and counts them', () => {
    // "Learn to Play" runs forty times in the same hall. Listing each would
    // fill the list with one answer and hide every other.
    const events = feed(
      ['09:00', '11:00', '13:00'].map((at) =>
        event({
          title: 'Learn to Play Catan',
          roomText: 'Exhibit Hall B',
          start: `2026-07-30T${at}:00-04:00`,
        }),
      ),
    );
    const hits = search('catan', events);
    expect(hits).toHaveLength(1);
    expect(hits[0].sessions).toBe(3);
    // The soonest, because that is the one somebody can still get to.
    expect(hits[0].event?.start).toContain('T09:00');
  });

  it('keeps one title in two rooms as two answers', () => {
    // The same collapse must not reach across rooms: which hall it is in is
    // exactly what somebody is searching to find out.
    const events = feed([
      event({ title: 'Learn to Play Catan', roomText: 'Exhibit Hall B' }),
      event({ title: 'Learn to Play Catan', roomText: 'Exhibit Hall C' }),
    ]);
    expect(new Set(search('catan', events).map((hit) => hit.room!.id))).toEqual(
      new Set(['hall-b', 'hall-c']),
    );
  });

  it('ranks a room above the events happening in it', () => {
    // Typing "hall b" means the room. It has forty events whose titles contain
    // those letters, and every one of them would otherwise be in the way.
    const events = feed([
      event({ title: 'Hall B Speedrun', roomText: 'Exhibit Hall B' }),
      event({ title: 'Hall B Tournament', roomText: 'Exhibit Hall B' }),
    ]);
    const [first] = search('hall b', events);
    expect(first.kind).toBe('room');
    expect(first.room!.id).toBe('hall-b');
  });

  it('prefers a title that starts with what you typed', () => {
    const events = feed([
      event({ title: 'Advanced Catan Strategy', roomText: 'Exhibit Hall C' }),
      event({ title: 'Catan Championship', roomText: 'Exhibit Hall B' }),
    ]);
    expect(search('catan', events).map((hit) => hit.room!.id)).toEqual(['hall-b', 'hall-c']);
  });

  it('leaves out events the map cannot place', () => {
    // An event in a room nothing draws has nowhere to take you, so offering it
    // is a dead end dressed as a result. 130 of a real import's 27,467 are like
    // this. The filtering is `indexEvents`' — an unplaceable event never
    // reaches `byRoom` — and this asserts it end to end, from the feed to what
    // somebody sees, since that is the property that actually matters.
    const events = feed([
      event({ title: 'Catan Somewhere', roomText: 'Georgia Street Entrance', locationText: 'ICC' }),
      event({ title: 'Catan In A Hall', roomText: 'Exhibit Hall B' }),
    ]);
    expect(search('catan', events).map((hit) => hit.event?.title)).toEqual(['Catan In A Hall']);
  });

  it('has no events at all before a feed arrives', () => {
    expect(buildEventSearchIndex(null).entries).toEqual([]);
  });
});

describe('filtering and ordering', () => {
  const feed: EventSearchIndex = {
    entries: [
      { room: ROOMS_BY_ID['hall-a'], event: { id: 'a', title: 'Catan Open', locationText: 'ICC', start: '2026-07-30T09:00:00-04:00', end: '2026-07-30T10:00:00-04:00', durationMinutes: 60, type: 'BGM', cost: 6, roomId: 'hall-a' }, title: 'catan open' },
      { room: ROOMS_BY_ID['westin-grand-ballroom'], event: { id: 'b', title: 'Catan Masters', locationText: 'Westin', start: '2026-08-01T15:00:00-04:00', end: '2026-08-01T19:00:00-04:00', durationMinutes: 240, type: 'RPG', cost: 0, roomId: 'westin-grand-ballroom' }, title: 'catan masters' },
    ],
  };

  it('answers a filter with no words in it at all', () => {
    // "Everything free" is a real question with nothing to type, and refusing
    // it until somebody types two letters would make the filters decoration.
    expect(searchSessions('', feed, 10, { maxCost: 0 }).map((hit) => hit.event.id)).toEqual(['b']);
    expect(searchSessions('', feed, 10)).toEqual([]);
  });

  it('narrows a typed search as well as replacing one', () => {
    expect(searchSessions('catan', feed, 10).map((hit) => hit.event.id)).toEqual(['a', 'b']);
    expect(searchSessions('catan', feed, 10, { types: ['RPG'] }).map((hit) => hit.event.id)).toEqual(['b']);
  });

  it('orders the whole list rather than breaking ties within it', () => {
    // The failure that looks like a working sort: "cheapest first" applied
    // inside each tier of how well the title matched is the old order.
    const byCost = searchSessions('catan', feed, 10, {}, 'cost').map((hit) => hit.event.id);
    expect(byCost).toEqual(['b', 'a']);
    expect(searchSessions('catan', feed, 10, {}, 'length').map((hit) => hit.event.id)).toEqual(['a', 'b']);
  });

  it('drops rooms and stands from the map search while a filter is on', () => {
    // Exhibit Hall B has no day, no cost and no length, so "free on Saturday"
    // can be neither true nor false of it. Offering it anyway would answer a
    // different question from the one that was asked.
    const wide = search('hall', feed, 20);
    expect(wide.some((hit) => hit.kind === 'room')).toBe(true);
    const narrowed = search('hall', feed, 20, { maxCost: 0 });
    expect(narrowed.every((hit) => hit.kind === 'event')).toBe(true);
  });

  it('answers the map search from a filter alone too', () => {
    const hits = search('', feed, 20, { types: ['BGM'] });
    expect(hits.map((hit) => hit.event?.id)).toEqual(['a']);
  });
});

describe('the top-level kind', () => {
  const feed: EventSearchIndex = {
    entries: [
      { room: ROOMS_BY_ID['hall-a'], event: { id: 'a', title: 'Taco Tuesday', locationText: 'ICC', start: '2026-07-30T09:00:00-04:00', roomId: 'hall-a' }, title: 'taco tuesday' },
    ],
  };

  it('answers with everything when nothing has been chosen', () => {
    const hits = search('hall', feed, 30);
    expect(hits.some((hit) => hit.kind === 'room' && !hit.exhibitor)).toBe(true);
  });

  it('gives only events when events are asked for', () => {
    const hits = search('taco', feed, 30, { kind: 'event' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.kind === 'event')).toBe(true);
  });

  it('gives only food when food is asked for', () => {
    // "taco" is a truck's food and also an event title here. Somebody who has
    // said Food is not asking about the seminar.
    const hits = search('taco', feed, 30, { kind: 'food' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.exhibitor && isFood(hit.exhibitor))).toBe(true);
  });

  it('gives only the halls’ vendors when vendors are asked for', () => {
    const hits = search('games', feed, 30, { kind: 'vendor' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.exhibitor && !isFood(hit.exhibitor))).toBe(true);
  });

  it('gives only places when places are asked for', () => {
    const hits = search('hall', feed, 30, { kind: 'place' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => !hit.event && !hit.exhibitor)).toBe(true);
  });

  it('answers a kind with nothing typed at all', () => {
    // "Food" is a question in its own right, and there is nothing to type.
    expect(search('', feed, 30, { kind: 'food' }).length).toBeGreaterThan(0);
    expect(search('', feed, 30)).toEqual([]);
  });

  it('narrows food by cuisine, dish and dietary', () => {
    const vegan = search('', feed, 60, { kind: 'food', dietary: ['Vegan Options'] });
    expect(vegan.length).toBeGreaterThan(0);
    for (const hit of vegan) expect(tagsOf(hit.exhibitor!)).toContain('Vegan Options');

    const venezuelan = search('', feed, 60, { kind: 'food', cuisine: ['Venezuelan'] });
    expect(venezuelan.length).toBeGreaterThan(0);
    expect(venezuelan.length).toBeLessThan(vegan.length + 60);
    for (const hit of venezuelan) expect(tagsOf(hit.exhibitor!)).toContain('Venezuelan');
  });

  it('does not let an event filter silence the food list', () => {
    // The rule that drops rooms while a day filter is on must not drop the
    // trucks while a cuisine filter is on — they are the thing being asked for.
    const hits = search('', feed, 60, { kind: 'food', cuisine: ['Korean'] });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('narrows vendors by what they are, where they are and what they sell', () => {
    // The bug this replaced: every filter offered under Vendors was an event
    // filter, so touching one emptied the list rather than narrowing it.
    const artists = search('', feed, 200, { kind: 'vendor', standKinds: ['Artists'] });
    expect(artists.length).toBeGreaterThan(0);
    expect(artists.every((hit) => hit.exhibitor?.kind === 'Artists')).toBe(true);

    const inTheHall = search('', feed, 200, { kind: 'vendor', areas: ['Exhibit Hall'] });
    expect(inTheHall.every((hit) => hit.exhibitor?.area === 'Exhibit Hall')).toBe(true);

    const boardGames = search('', feed, 200, { kind: 'vendor', tags: ['Board Games'] });
    expect(boardGames.length).toBeGreaterThan(0);
    for (const hit of boardGames) expect(tagsOf(hit.exhibitor!)).toContain('Board Games');
  });

  it('narrows places by building and by floor', () => {
    const jw = search('', feed, 200, { kind: 'place', venueIds: ['jw-marriott'] });
    expect(jw.length).toBeGreaterThan(0);
    expect(jw.every((hit) => hit.room?.venueId === 'jw-marriott')).toBe(true);

    const floors = new Set(jw.map((hit) => hit.room!.level));
    const [floor] = [...floors];
    const oneFloor = search('', feed, 200, { kind: 'place', venueIds: ['jw-marriott'], levels: [floor] });
    expect(oneFloor.length).toBeGreaterThan(0);
    expect(oneFloor.length).toBeLessThanOrEqual(jw.length);
    expect(oneFloor.every((hit) => hit.room!.level === floor)).toBe(true);
  });

  it('drops street addresses once a place filter is on, having neither', () => {
    // An address is not in a building and is on no floor, so "in the JW" can be
    // neither true nor false of it — the same rule as an event filter dropping
    // a room, one level down.
    const loose = search('washington', feed, 200, { kind: 'place' });
    expect(loose.some((hit) => hit.pin)).toBe(true);
    const narrowed = search('washington', feed, 200, { kind: 'place', venueIds: ['icc'] });
    expect(narrowed.some((hit) => hit.pin)).toBe(false);
  });
});
