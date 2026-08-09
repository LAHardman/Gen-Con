/**
 * Turning one of Gen Con's records into one of this app's events.
 *
 * The fetching either works or fails loudly — it counts what it got against
 * what the catalogue said it had, and refuses to write a short answer. The
 * mapping is the part that can be wrong quietly: a field renamed on their side,
 * or read into the wrong one on ours, produces a feed of exactly the right
 * length in which nothing can be found.
 */

import { describe, expect, it } from 'vitest';
import { shape } from './fetch-events.mjs';

/** A record with every field Gen Con sends that this app reads. */
const record = {
  game_code: 'BGM26ND306429',
  id: 306429,
  title: '12 Rivers',
  event_type: 'BGM - Board Game',
  game_system: '12 Rivers',
  location: 'Stadium',
  room_name: 'Field : Fight in the Skies',
  table_number: 'HQ',
  start_date: '2026-07-30T20:00:00.000-04:00',
  end_date: '2026-07-30T22:00:00.000-04:00',
  event_duration: '2',
  event_cost: '2.0',
  tickets_available: 0,
  age_requirement_short: 'Everyone (6+)',
};

describe('one event, as the app wants it', () => {
  it('keeps the printed code as the id, which is what the event link is built from', () => {
    // `eventUrl` takes the trailing number off this and points at
    // gencon.com/events/<n>. An id of `306429` would still work; an id of
    // anything else would silently stop every link in the app.
    expect(shape(record).id).toBe('BGM26ND306429');
    expect(/([0-9]+)$/.exec(shape(record).id)?.[1]).toBe('306429');
  });

  it('falls back to the numeric id where there is no printed code', () => {
    expect(shape({ ...record, game_code: '' }).id).toBe('306429');
  });

  it('takes the event type down to its code', () => {
    // Gen Con sends "BGM - Board Game"; everything in the app that groups or
    // filters by type wants "BGM".
    expect(shape(record).type).toBe('BGM');
    expect(shape({ ...record, event_type: 'RPG - Role Playing Game' }).type).toBe('RPG');
  });

  it('carries the three fields a room is found from, separately', () => {
    // The whole reason this source is better than the scrape: the building, the
    // room and the table arrive as three named fields instead of one sentence
    // that had to be picked apart.
    const e = shape(record);
    expect(e.locationText).toBe('Stadium');
    expect(e.roomText).toBe('Field : Fight in the Skies');
    expect(e.tableText).toBe('HQ');
  });

  it('drops the milliseconds, which are always zero and cost 220 KB', () => {
    // This is a file a phone downloads before it can show a single session, and
    // it is the same instant either way.
    expect(shape(record).start).toBe('2026-07-30T20:00:00-04:00');
    expect(shape(record).end).toBe('2026-07-30T22:00:00-04:00');
  });

  it('leaves an absent field absent rather than empty', () => {
    // 27,467 copies of `"tableText":""` is a quarter of a megabyte of nothing.
    const bare = shape({ ...record, table_number: '', game_system: '', room_name: '', end_date: null });
    expect(bare.tableText).toBeUndefined();
    expect(bare.gameSystem).toBeUndefined();
    expect(bare.roomText).toBeUndefined();
    expect(bare.end).toBeUndefined();
    expect(Object.values(bare).includes('')).toBe(false);
  });

  it('reads the numbers as numbers, including the zeroes', () => {
    // `tickets_available: 0` is the difference between a sold-out event and one
    // whose ticket count nobody knows, and a falsy check loses that.
    const e = shape(record);
    expect(e.cost).toBe(2);
    expect(e.ticketsAvailable).toBe(0);
    expect(e.durationMinutes).toBe(120);
  });

  it('gives no duration rather than a wrong one where the source has none', () => {
    expect(shape({ ...record, event_duration: '' }).durationMinutes).toBeUndefined();
  });
});
