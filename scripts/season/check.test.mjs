/**
 * The season check's readings, held still.
 *
 * The parts under test are the ones that fail by misreading rather than by
 * throwing: hour prose shipped with the wrong meridiem, a rename suggested
 * for a field that genuinely vanished, a deadline that nags a year early.
 * The network-facing halves of the probes are deliberately not here — they
 * are fetch-and-compare, and what they compare *with* is what these hold.
 */

import { describe, expect, it } from 'vitest';
import {
  asOpeningLines,
  minutesOf,
  missingFields,
  parseHourProse,
  parseDue,
  readDeadline,
  similarity,
  closest,
  weekStamp,
} from './lib';
import { splitHourProse } from './probes/blockparty-hours';
import { guessFacet } from './probes/food-tags';
import { dollarFigures } from './probes/parking';

describe('hour prose', () => {
  it('reads the food trucks line exactly as food.ts holds it', () => {
    expect(parseHourProse('Thursday - Saturday, 9am - 9pm / Sunday, 9am - 4pm')).toEqual([
      { days: [4, 5, 6], from: 9 * 60, to: 21 * 60 },
      { days: [0], from: 9 * 60, to: 16 * 60 },
    ]);
  });

  it('reads the beer garden line, meridiem borrowed across the span and noon spelt out', () => {
    expect(parseHourProse('Wed tapping 5-10pm / Thu-Sat, noon - 10pm')).toEqual([
      { days: [3], from: 17 * 60, to: 22 * 60 },
      { days: [4, 5, 6], from: 12 * 60, to: 22 * 60 },
    ]);
  });

  it('refuses rather than guesses at prose it does not understand', () => {
    // No day named, no time span, and a span with no parseable end.
    expect(parseHourProse('9am - 9pm daily-ish')).toBeNull();
    expect(parseHourProse('Thursday, all day')).toBeNull();
    expect(parseHourProse('')).toBeNull();
  });

  it('reads clock words the way a person wrote them', () => {
    expect(minutesOf('noon')).toBe(720);
    expect(minutesOf('12am')).toBe(0);
    expect(minutesOf('5:30pm')).toBe(1050);
    expect(minutesOf('25pm')).toBeNull();
  });

  it('emits the exact lines food.ts is written in', () => {
    const lines = asOpeningLines(2026, [{ days: [4, 5, 6], from: 540, to: 1260 }]);
    expect(lines).toEqual([
      '  year: 2026,',
      '  hours: [',
      '    { days: [4, 5, 6], from: at(9), to: at(21) },',
      '  ],',
    ]);
  });

  it('keeps live prose apart from commented prose, which is the whole trap', () => {
    const html = `
      <p>Open Thursday - Saturday, 9am - 9pm</p>
      <!-- <p>Old: Thu-Sat, noon - 10pm</p> -->
      <script>var x = "Sun 9am - 4pm";</script>`;
    const { live, commented } = splitHourProse(html);
    expect(live).toEqual(['Open Thursday - Saturday, 9am - 9pm']);
    expect(commented).toEqual(['Old: Thu-Sat, noon - 10pm']);
  });
});

describe('field renames', () => {
  it('pairs a missing field with the arrival that is almost certainly its new name', () => {
    const missing = missingFields(['start_date', 'room_name'], ['startDate', 'room', 'title']);
    expect(missing).toEqual([
      { field: 'start_date', probably: 'startDate' },
      { field: 'room_name', probably: 'room' },
    ]);
  });

  it('says when nothing resembles the loss, which is a different finding', () => {
    expect(missingFields(['tickets_available'], ['title', 'cost'])).toEqual([
      { field: 'tickets_available', probably: null },
    ]);
  });
});

describe('deadlines', () => {
  const now = new Date('2026-08-27T12:00:00Z');
  it('nags for a date never filled in', () => {
    expect(readDeadline({ what: 'renewal', due: null }, now).status).toBe('warn');
  });
  it('is quiet a year out, warns inside sixty days, fails once passed', () => {
    expect(readDeadline({ what: 'r', due: '2027-08-01' }, now).status).toBe('ok');
    expect(readDeadline({ what: 'r', due: '2026-10-01' }, now).status).toBe('warn');
    expect(readDeadline({ what: 'r', due: '2026-08-01' }, now).status).toBe('fail');
  });
});

describe('name similarity', () => {
  it('ranks by the tokens that identify rather than the ones that decorate', () => {
    const rooms = [
      { id: 'icc-140', names: ['Meeting Room 140'] },
      { id: 'icc-141', names: ['Meeting Room 141'] },
      { id: 'jw-grand', names: ['Grand Ballroom'] },
    ];
    const best = closest('Room 140', rooms, (r) => r.names, 2);
    expect(best[0].candidate.id).toBe('icc-140');
  });

  it('weights a shared number above a shared filler word', () => {
    expect(similarity('Room 104', 'Meeting Room 104')).toBeGreaterThan(similarity('Room 104', 'Meeting Room 209'));
  });
});

describe('page readings', () => {
  it('pulls dollar figures with enough words around them to be read', () => {
    const figures = dollarFigures('<p>Event parking is $38 per day.</p><p>Weekdays from $22.</p>');
    expect(figures.some((f) => f.includes('$38'))).toBe(true);
    expect(figures.some((f) => f.includes('$22'))).toBe(true);
  });

  it('guesses food facets only where the guess is safe, and admits otherwise', () => {
    expect(guessFacet('Gluten Free options')).toBe('dietary');
    expect(guessFacet('Tacos')).toBe('dish');
    expect(guessFacet('Peruvian')).toBe('cuisine');
    expect(guessFacet('Soulfood')).toBeNull();
  });
});

describe('week stamp', () => {
  it('is stable within a week, so a re-run changes nothing', () => {
    expect(weekStamp(new Date('2026-08-24T00:00:00Z'))).toBe(weekStamp(new Date('2026-08-30T23:59:59Z')));
    expect(weekStamp(new Date('2026-08-27T12:00:00Z'))).toMatch(/^2026-W\d{2}$/);
  });
});

describe('the deadlines file', () => {
  // It is edited by hand, in a browser, months apart — and it broke exactly
  // that way once: two dates written as prose and unquoted, which is not a
  // bad row but an unparseable *file*. The season check would have said so,
  // a week later, in an issue. This says so in the same minute.
  const file = 'scripts/season/store-dates.json';

  it('parses, and every date in it can be read', async () => {
    const { readFileSync } = await import('node:fs');
    const held = JSON.parse(readFileSync(file, 'utf8'));
    expect(Array.isArray(held.deadlines)).toBe(true);
    expect(held.deadlines.length).toBeGreaterThan(0);
    for (const row of held.deadlines) {
      expect(typeof row.what, JSON.stringify(row)).toBe('string');
      expect(row.note?.length ?? 0).toBeGreaterThan(20);
      // Null is a real answer — "not filled in yet" — and anything else has
      // to be a date, or the probe reports a deadline it cannot act on.
      if (row.due !== null) {
        expect(parseDue(row.due), `"${row.due}" is not a readable date`).not.toBeNull();
      }
    }
  });
});
