/**
 * The packed feed, unpacked.
 *
 * The wire format is columns and dictionaries rather than objects, which takes
 * the schedule from 8.87 MB to 2.03 MB on a phone. The risk that buys is a
 * silent one: an index off by one, or a field read from the wrong table, gives
 * a feed of exactly the right length in which every event is somebody else's.
 * Nothing about the file would look wrong.
 *
 * So this checks the reader against a fixture built the way the writer builds
 * one, and — more usefully — against the old shape too, because a phone with a
 * cached copy of that must keep working.
 */

import { describe, expect, it } from 'vitest';
import { expandFeed, indexEvents, type ConEvent } from './events';

const source = { name: 'Gen Con event catalogue', url: 'https://www.gencon.com/events', fetchedAt: '2026-08-09T00:00:00Z' };

/** What `pack()` in the fetcher produces, for three events. */
const packed = {
  format: 'columns-1',
  source,
  year: 2026,
  count: 3,
  keys: {
    idPrefix: ['BGM26ND', 'RPG26ND'],
    type: ['BGM', 'RPG'],
    gameSystem: ['12 Rivers'],
    locationText: ['ICC', 'Stadium'],
    roomText: ['Hall F', 'Sagamore Ballroom'],
    tableText: ['HQ'],
    start: ['2026-07-30T10:00:00-04:00', '2026-07-30T20:00:00-04:00'],
    end: ['2026-07-30T12:00:00-04:00', '2026-07-30T22:00:00-04:00'],
    ageRequirement: ['Everyone (6+)'],
    durationMinutes: [120],
  },
  columns: {
    idPrefix: [0, 1, 0],
    idNumber: [306429, 311111, 322222],
    title: ['12 Rivers', 'A Quest', 'Another'],
    type: [0, 1, 0],
    gameSystem: [0, -1, -1],
    locationText: [1, 0, 0],
    roomText: [-1, 1, 0],
    tableText: [0, -1, -1],
    start: [1, 0, 0],
    end: [1, 0, 0],
    ageRequirement: [0, 0, 0],
    durationMinutes: [0, 0, 0],
    cost: [2, 0, null],
    ticketsAvailable: [0, 6, null],
  },
};

describe('reading the packed feed', () => {
  it('puts every column back on the right event', () => {
    // The failure this is for: one column read against another's table gives a
    // feed of the right length in which everything is in the wrong place.
    const { events } = expandFeed(packed);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      id: 'BGM26ND306429',
      title: '12 Rivers',
      type: 'BGM',
      gameSystem: '12 Rivers',
      locationText: 'Stadium',
      roomText: undefined,
      tableText: 'HQ',
      start: '2026-07-30T20:00:00-04:00',
      end: '2026-07-30T22:00:00-04:00',
      durationMinutes: 120,
      cost: 2,
      ticketsAvailable: 0,
      ageRequirement: 'Everyone (6+)',
    } satisfies ConEvent);
    expect(events[1].id).toBe('RPG26ND311111');
    expect(events[1].locationText).toBe('ICC');
    expect(events[1].roomText).toBe('Sagamore Ballroom');
  });

  it('keeps a zero and drops an absence, which are not the same', () => {
    // `ticketsAvailable: 0` is a sold-out event; absent is one whose count
    // nobody knows. A falsy check collapses the two and sells out the schedule.
    const { events } = expandFeed(packed);
    expect(events[0].ticketsAvailable).toBe(0);
    expect(events[0].cost).toBe(2);
    expect(events[1].cost).toBe(0);
    expect(events[2].cost).toBeUndefined();
    expect(events[2].ticketsAvailable).toBeUndefined();
  });

  it('carries every field, not just the ones a hand-written fixture remembers', () => {
    // This test originally omitted `ageRequirement` from the expected object,
    // and so did the reader — the fixture was written from the implementation
    // and agreed with its bug. Round-tripping all 27,467 real events through
    // the writer and back is what found it, so the set of keys is asserted
    // here rather than trusted.
    const { events } = expandFeed(packed);
    expect(Object.keys(events[0]).sort()).toEqual([
      'ageRequirement', 'cost', 'durationMinutes', 'end', 'gameSystem', 'id',
      'locationText', 'roomId', 'roomText', 'start', 'tableText', 'ticketsAvailable', 'title', 'type',
    ]);
  });

  it('reads -1 as "this event has none of that"', () => {
    const { events } = expandFeed(packed);
    expect(events[1].gameSystem).toBeUndefined();
    expect(events[2].tableText).toBeUndefined();
  });

  it('carries the year and the provenance through', () => {
    const feed = expandFeed(packed);
    expect(feed.year).toBe(2026);
    expect(feed.source.url).toBe('https://www.gencon.com/events');
  });
});

describe('the room the build already worked out', () => {
  // The matcher is a string scan over every room on the campus, run once per
  // event to produce 121 distinct answers. The build knows the same thing, so
  // it writes it down and the phone reads it.
  const withRooms = {
    ...packed,
    format: 'columns-2',
    keys: { ...packed.keys, roomId: ['hall-f', 'sagamore-ballroom'] },
    columns: { ...packed.columns, roomId: [0, 1, -1] },
  };

  it('reads the room straight off the feed', () => {
    const { events } = expandFeed(withRooms);
    expect(events[0].roomId).toBe('hall-f');
    expect(events[1].roomId).toBe('sagamore-ballroom');
  });

  it('leaves it unset where the build could not place the event', () => {
    // -1 means the writer found no room either. The reader must not invent one,
    // because `indexEvents` treats an unset id as "work it out" and a wrong one
    // as gospel.
    expect(expandFeed(withRooms).events[2].roomId).toBeUndefined();
  });

  it('indexes by the written room rather than re-deriving it', () => {
    // The point of the whole exercise: an event carrying a room goes straight
    // into that room's bucket without the matcher running at all. Asserted with
    // a room the *text* would never match, so a fallback to the matcher would
    // put it somewhere else and be obvious.
    const odd = {
      ...withRooms,
      keys: { ...withRooms.keys, roomId: ['lucas-oil-field', 'sagamore-ballroom'] },
    };
    const index = indexEvents(expandFeed(odd).events);
    expect(index.byRoom.get('lucas-oil-field')?.length).toBe(1);
  });

  it('still works out a room for a feed that carries none', () => {
    // `columns-1`, and any event the build could not place. The matcher is
    // still the authority; this only skips work it has already done.
    const index = indexEvents(expandFeed(packed).events);
    expect([...index.byRoom.keys()].length).toBeGreaterThan(0);
  });
});

describe('still reading the shape that came before it', () => {
  it('passes an old feed through untouched', () => {
    // A phone that cached the old shape, or a mirror holding a snapshot written
    // before this existed. A reader that only understood the new one would turn
    // a stale cache into a broken app.
    const old = {
      source,
      year: 2026,
      events: [{ id: 'BGM26ND1', title: 'x', locationText: 'ICC', start: '2026-07-30T10:00:00-04:00' }],
    };
    expect(expandFeed(old).events).toHaveLength(1);
    expect(expandFeed(old).events[0].id).toBe('BGM26ND1');
  });

  it('refuses a shape it does not know rather than returning nothing', () => {
    // Silently yielding zero events would read as "the convention has no
    // programme", which is indistinguishable from a source outage.
    expect(() => expandFeed({ format: 'columns-9', keys: {}, columns: {}, count: 0 })).toThrow(/columns-9/);
    expect(() => expandFeed({ nonsense: true })).toThrow();
  });
});
