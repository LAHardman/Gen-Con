/**
 * The scraper, against pages saved off the live site.
 *
 * This module is the riskiest thing in the repository, and the reason is the
 * shape of its failure rather than its complexity: **it fails by returning
 * nothing.** A source redesign that renamed one row label would drop that field
 * from every event in the import, and the run would finish, report success, and
 * publish a schedule with no locations in it. Nothing throws. The logs look
 * like a good run with fewer events in it, which is also what a quiet year
 * looks like.
 *
 * So these tests are mostly about what a *good* page must yield, field by
 * field, rather than about error handling. If the site changes, the point is
 * that these fail rather than that the import copes.
 *
 * The fixtures in `__fixtures__/` are three real pages, saved unedited except
 * that the catalogue is cut down to four game systems — it is 2.8 MB whole.
 *
 * Source: gencon.eventdb.us, saved 2026-08-06.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIELD_PATTERNS,
  mapFields,
  parseCataloguePage,
  parseCount,
  parseDayIndex,
  parseDurationMinutes,
  parseEventPage,
  parseMoney,
  parseStart,
  readFieldTable,
} from './parse-events.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(HERE, '__fixtures__', name), 'utf8');

const DAY_DATES = {
  wednesday: '2026-07-29',
  thursday: '2026-07-30',
  friday: '2026-07-31',
  saturday: '2026-08-01',
  sunday: '2026-08-02',
};

describe('an event page', () => {
  const { event, diagnostics } = parseEventPage(fixture('event-bgm306429.html'), {
    dayDates: DAY_DATES,
  });

  it('reads every field the app uses', () => {
    // Named one by one on purpose. Any of these silently becoming undefined is
    // a whole import's worth of that field gone, and the only field the map
    // cannot do without is the location.
    expect(diagnostics.reason).toBe('ok');
    expect(event).toEqual({
      id: 'BGM26ND306429',
      title: '12 Rivers',
      type: 'BGM',
      gameSystem: '12 Rivers',
      locationText: 'Stadium',
      roomText: 'Field : Fight in the Skies',
      tableText: 'HQ',
      start: '2026-07-30T20:00:00-04:00',
      end: '2026-07-30T22:00:00-04:00',
      // The source has no duration row; `undefined`, not a guess from the
      // start and end times, which the app computes itself where it wants one.
      durationMinutes: undefined,
      cost: 2,
      ticketsAvailable: 0,
      ageRequirement: 'Everyone (6+)',
      url: 'https://www.gencon.com/events/306429',
    });
  });

  it('is the only place the location comes from, and it has one', () => {
    // The catalogue pages carry no location at all, so if this row stops being
    // read every event on the map loses its room and the schedule still
    // publishes.
    expect(event.locationText).toBeTruthy();
    expect(event.roomText).toBeTruthy();
  });

  it('maps the labels the site actually uses today', () => {
    // These are the live labels, as `--inspect` reports them. The patterns are
    // deliberately broader, so this is the check that they still *reach* the
    // real ones rather than only their neighbours.
    expect(diagnostics.fields).toMatchObject({
      id: 'Game Code',
      title: 'Title',
      type: 'Event Type',
      gameSystem: 'Game System',
      start: 'Start Date',
      end: 'End Date',
      location: 'Location',
      room: 'Room',
      table: 'Table',
      cost: 'Cost',
      tickets: 'Tickets Available',
      age: 'Age Required',
    });
  });

  it('keeps the labels it saw, so a rename can be diagnosed rather than guessed', () => {
    expect(diagnostics.labels).toContain('Location');
    expect(diagnostics.labels.length).toBeGreaterThan(10);
  });
});

describe('a page whose table did not survive the markup', () => {
  /**
   * About a tenth of the catalogue — 2,661 events, all roleplaying — comes back
   * with the rows but no `<table>`, because something earlier leaves the parser
   * with an unclosed div. Insisting on the table dropped every one of them
   * silently: fetched, parsed to nothing, published with no location.
   */
  const rowsOnly = `
    <html><body><div class="broken">
      <tr><td>Title</td><td>Dungeon Crawl</td></tr>
      <tr><td>Game Code</td><td>RPG26ND123456</td></tr>
      <tr><td>Start Date</td><td>Saturday August 01, 2026 - 10:00 am</td></tr>
      <tr><td>Location</td><td>JW Marriott</td></tr>
      <tr><td>Room</td><td>White River Ballroom A</td></tr>
    </body></html>`;

  it('reads the rows anyway', () => {
    const { event, diagnostics } = parseEventPage(rowsOnly, { dayDates: DAY_DATES });
    expect(diagnostics.reason).toBe('ok');
    expect(event.title).toBe('Dungeon Crawl');
    expect(event.locationText).toBe('JW Marriott');
    expect(event.roomText).toBe('White River Ballroom A');
    expect(event.start).toBe('2026-08-01T10:00:00-04:00');
  });
});

describe('a page that yields nothing', () => {
  it('says why rather than returning an empty event', () => {
    // The importer counts these and prints them. Returning `{event: null}` with
    // no reason is how a redesign becomes invisible.
    const { event, diagnostics } = parseEventPage('<html><body><p>Nothing here.</p></body></html>');
    expect(event).toBeNull();
    expect(diagnostics.reason).toMatch(/no <table> and no rows/);
  });

  it('says when it found rows but no title', () => {
    const { event, diagnostics } = parseEventPage(
      '<html><body><tr><td>Cost</td><td>4.00</td></tr><tr><td>Room</td><td>Hall A</td></tr></body></html>',
    );
    expect(event).toBeNull();
    expect(diagnostics.reason).toBe('no title row');
    // And it reports what it did see, which is what makes a rename findable.
    expect(diagnostics.labels).toEqual(['Cost', 'Room']);
  });
});

describe('mapping a row label to a field', () => {
  it('claims each label once, in the order the fields are listed', () => {
    // `Room` matches the room pattern and nothing else may take it. Without
    // the claim, a later field with a looser pattern could swallow it.
    const map = mapFields(['Title', 'Room', 'Location', 'Table']);
    expect(map).toEqual({ title: 'Title', location: 'Location', room: 'Room', table: 'Table' });
  });

  it('still resolves a near-miss rename', () => {
    // The patterns are broader than the live labels precisely so that a
    // cosmetic rename does not cost a field. This is what that buys.
    expect(mapFields(['Event Name']).title).toBe('Event Name');
    expect(mapFields(['Venue']).location).toBe('Venue');
    expect(mapFields(['Hall']).room).toBe('Hall');
    expect(mapFields(['Seats Available']).tickets).toBe('Seats Available');
    expect(mapFields(['When']).start).toBe('When');
  });

  it('will not let a loose pattern steal a label an earlier field took', () => {
    // Several patterns match a substring — `gameSystem` takes anything with
    // "system" in it, `room` anything with "hall". Without the claim, `room`
    // would scan the labels from the start and take "Game System Hall" before
    // it ever reached "Room", and the real room row would go unread while
    // every event got a room named after its game.
    const map = mapFields(['Game System Hall', 'Room']);
    expect(map.gameSystem).toBe('Game System Hall');
    expect(map.room).toBe('Room');
  });

  it('leaves a label it does not recognise alone', () => {
    expect(mapFields(['Tournament', 'GM Names'])).toEqual({});
  });

  it('lists a pattern for every field the event page produces', () => {
    // A field added to `parseEventPage` with no entry here reads as undefined
    // for every event, for ever, without a word.
    const named = FIELD_PATTERNS.map(([field]) => field);
    for (const field of ['id', 'title', 'type', 'gameSystem', 'start', 'end', 'location', 'room', 'table', 'cost', 'tickets', 'age']) {
      expect(named, field).toContain(field);
    }
  });
});

describe('reading values', () => {
  it('takes a full date off an event page', () => {
    expect(parseStart('Saturday August 01, 2026 - 10:00 am')).toBe('2026-08-01T10:00:00-04:00');
  });

  it('takes an abbreviated weekday off a catalogue page, given the dates', () => {
    // The catalogue says "Sat 10:00 am" and nothing else. Without the day
    // index there is no year to put it in, and inventing one would date every
    // event in the import wrongly.
    expect(parseStart('Sat 10:00 am', { dayDates: DAY_DATES })).toBe('2026-08-01T10:00:00-04:00');
    expect(parseStart('Sat 10:00 am')).toBeNull();
  });

  it('reads noon and midnight the way the source writes them', () => {
    expect(parseStart('Sat 12:00 pm', { dayDates: DAY_DATES })).toBe('2026-08-01T12:00:00-04:00');
    expect(parseStart('Sat 12:00 am', { dayDates: DAY_DATES })).toBe('2026-08-01T00:00:00-04:00');
  });

  it('returns null for a time it cannot read rather than a plausible one', () => {
    expect(parseStart(undefined)).toBeNull();
    expect(parseStart('')).toBeNull();
    expect(parseStart('sometime on the weekend')).toBeNull();
  });

  it('reads money, counts and durations, and nothing else', () => {
    // Note the two conventions: `parseStart` returns null for "no time here",
    // these return undefined. Both mean the same thing to the caller, and
    // both are pinned rather than tidied, because the importer and the app
    // read them and a change would have to move with them.
    expect(parseMoney('$8.00')).toBe(8);
    expect(parseMoney('2.00')).toBe(2);
    expect(parseMoney('Free')).toBeUndefined();
    expect(parseCount('0')).toBe(0);
    // "162/180" is 162 still available of 180, and a wait list makes it
    // negative — so the leading sign has to survive and the slash must not.
    expect(parseCount('162/180')).toBe(162);
    expect(parseCount('-18/180')).toBe(-18);
    expect(parseCount('')).toBeUndefined();
    expect(parseDurationMinutes('2 hours')).toBe(120);
    expect(parseDurationMinutes('90 minutes')).toBe(90);
    expect(parseDurationMinutes('1h30')).toBe(90);
    expect(parseDurationMinutes('a while')).toBeUndefined();
  });

  it('reads a two-column row table into label/value pairs', () => {
    const fields = readFieldTable(
      // node-html-parser accepts a string here through `parseEventPage`; this
      // goes the direct route to check the row rule itself.
      {
        querySelectorAll: () => [
          { querySelectorAll: () => [{ text: 'Room' }, { text: 'Hall A', childNodes: [], innerHTML: 'Hall A' }] },
          // A one-cell row is a heading, not a field.
          { querySelectorAll: () => [{ text: 'Details' }] },
        ],
      },
    );
    expect(Object.keys(fields)).toEqual(['Room']);
  });
});

describe('a catalogue page', () => {
  const { events, diagnostics } = parseCataloguePage(fixture('catalogue-bgm.html'), {
    eventType: 'BGM',
    dayDates: DAY_DATES,
  });

  it('finds every session on it', () => {
    expect(diagnostics.reason).toBe('ok');
    expect(events).toHaveLength(diagnostics.sessions);
    expect(events.length).toBeGreaterThan(20);
  });

  it('gives each session a date, not just a weekday', () => {
    // `unparsedStart` is the count the importer prints. A source that stopped
    // naming its days would show up here as every session losing its time,
    // which is otherwise indistinguishable from a thin category.
    expect(diagnostics.unparsedStart).toBe(0);
    for (const event of events) expect(event.start, event.id).toMatch(/^2026-\d\d-\d\dT/);
  });

  it('carries the tree the indents encode down to each session', () => {
    // The divs are a flat run and the nesting is in their class names, so a
    // session takes its title from the last `indentM` above it and its system
    // from the last `indentS`. Getting that wrong labels every session with
    // its neighbour's game.
    const first = events[0];
    expect(first.id).toBe('BGM26ND306429');
    expect(first.title).toBe('12 Rivers');
    expect(first.gameSystem).toBe('12 Rivers');
    expect(first.type).toBe('BGM');
    expect(first.cost).toBe(2);
    expect(first.url).toBe('https://www.gencon.com/events/306429');
    // Four systems in this cut of the page, and every session belongs to one.
    expect(new Set(events.map((event) => event.gameSystem)).size).toBe(4);
    for (const event of events) expect(event.gameSystem, event.id).toBeTruthy();
  });

  it('carries no location, which is why event pages are fetched at all', () => {
    for (const event of events) expect(event.locationText).toBe('');
  });

  it('will not name a session after whatever came before it', () => {
    // A session div carries a time and a code and no title of its own — the
    // title is the last `indentM` above it. So a session that appears before
    // any title has nothing to be called, and taking one anyway would file it
    // under the previous category's last game, or under `undefined`.
    const stray = `<html><body>
      <div class='indentL'><a href='event.php?GameCode=BGM26ND000001'>
        <i class='icon-time'></i>Thu 8:00 pm - Thu 10:00 pm</a>
        <a href='https://www.gencon.com/events/1'><i class='icon-ticket'></i>0/8</a> 2.00</div>
      <div class='indentS'><strong>Acquire</strong></div>
      <div class='indentM'><strong>Acquire: the tournament</strong></div>
      <div class='indentL'><a href='event.php?GameCode=BGM26ND000002'>
        <i class='icon-time'></i>Fri 9:00 am - Fri 11:00 am</a>
        <a href='https://www.gencon.com/events/2'><i class='icon-ticket'></i>4/8</a> 4.00</div>
    </body></html>`;
    const { events } = parseCataloguePage(stray, { eventType: 'BGM', dayDates: DAY_DATES });
    expect(events.map((event) => event.id)).toEqual(['BGM26ND000002']);
    expect(events[0].title).toBe('Acquire: the tournament');
  });

  it('says so when it recognises nothing', () => {
    const { events: none, diagnostics: why } = parseCataloguePage('<html><body></body></html>');
    expect(none).toEqual([]);
    expect(why.reason).toBe('no session rows found');
  });
});

describe('the day index', () => {
  it('pairs each weekday with the date the site gives it', () => {
    // Read from the site rather than assumed, because which dates Gen Con runs
    // moves every year and a wrong year dates the whole import wrongly.
    expect(parseDayIndex(fixture('day-time-list.html'))).toEqual(DAY_DATES);
  });

  it('gives nothing rather than a guess when the page is empty', () => {
    expect(parseDayIndex('<html><body></body></html>')).toEqual({});
  });
});
