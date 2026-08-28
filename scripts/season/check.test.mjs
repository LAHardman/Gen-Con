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
import { dollarFigures, eventOptions, linksIn, lotPrices } from './probes/parking';
import {
  asHistoryEntry,
  badgeAnnouncements,
  parseBadgeTable,
  splitBadgePrices,
} from './probes/badge-prices';

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

describe('the badge rate card', () => {
  /**
   * The page as it actually stands, trimmed to the part that matters.
   *
   * Gen Con leaves last cycle's table on the page inside an HTML comment
   * while the new one is written, and closes that comment with `--!>` rather
   * than `-->` — a typo a browser forgives and a naive regex does not. Both
   * are in this fixture because both have to be survived: the malformed
   * close, and the prose below it that carries dollar figures of its own.
   */
  const PAGE = `
<h2>Gen Con Returns: August 5-8, 2027<br>Indianapolis</h2>
<!--
<table>
  <tr><td><strong>Badge Type</strong></td><td><strong>Price</strong></td></tr>
  <tr><td>4-Day</td><td>$164</td></tr>
  <tr><td>Thursday</td><td>$83</td></tr>
  <tr><td>Friday</td><td>$83</td></tr>
  <tr><td>Saturday</td><td>$112</td></tr>
  <tr><td>Sunday</td><td>$41</td></tr>
  <tr><td>Trade Day</td><td>$302</td></tr>
</table>
--!>
<p>Marion County imposes a 10% admissions tax for all badge types.</p>
<p>This delivery option provides fast shipping for $16 and includes tracking.</p>
`;

  it('reads a table that is live on the page', () => {
    expect(parseBadgeTable('<td>4-Day</td><td>$164</td><td>Sunday</td><td>$41</td>')).toEqual({
      'four-day': 16_400,
      sunday: 4_100,
    });
  });

  it('finds nothing live while the card sits in a comment, and says what is in it', () => {
    // The failure this exists to stop: reading six real-looking prices out
    // of a comment and shipping them as next year\'s. A wrong number nobody
    // doubts is worse than no number at all.
    const { live, commented } = splitBadgePrices(PAGE);
    expect(live).toEqual({});
    expect(commented).toEqual({
      'four-day': 16_400,
      thursday: 8_300,
      friday: 8_300,
      saturday: 11_200,
      sunday: 4_100,
      'trade-day': 30_200,
    });
  });

  it('does not mistake the prose underneath for a badge price', () => {
    // "$16" for postage and "10%" for the tax are both on that page, below
    // the table, and neither is a badge.
    const { live } = splitBadgePrices('<p>Thursday is busy.</p><p>shipping for $16</p>');
    expect(live).toEqual({});
  });

  it('takes a price only when it directly follows the badge name', () => {
    // A row whose price cell is empty must not borrow the next row\'s.
    expect(parseBadgeTable('<td>Friday</td><td></td><td>Saturday</td><td>$112</td>')).toEqual({
      saturday: 11_200,
    });
  });

  it('emits the exact entry badge-prices.ts is written in', () => {
    expect(asHistoryEntry({ 'four-day': 16_400, sunday: 4_100 }, 2027, 'https://example.test/pr')).toEqual([
      '  {',
      '    year: 2027,',
      "    cents: { 'four-day': 16_400, sunday: 4_100, none: null },",
      "    source: 'https://example.test/pr',",
      '  },',
    ]);
  });

  it('finds the announcements by their titles, because the slugs have no pattern', () => {
    /*
     * 2022 and 2023 are `gen-con-20XX-badge-registration`, 2025 has
     * `-chairman` on the end, and 2024's URL serves an unrelated release
     * about a sponsor. Guessing a slug would have quietly mis-filed that
     * one; following the titles found the hole instead.
     */
    const index = `
      <li><a href="https://www.gencon.com/press/2026-reg-dates-and-badge-prices">Gen
        Con Announces 2026 Registration Dates, Badge Prices</a></li>
      <li><a href="https://www.gencon.com/press/2025-reg-dates-and-badge-prices-chairman">Gen Con
        Announces 2025 Registration Dates, Badge Prices, New Chairperson of the Board</a></li>
      <li><a href="https://www.gencon.com/press/gen-con-2022-badge-registration">Gen Con Announces
        2022 Registration Dates, Badge Prices, and Vaccination and Masking Requirements</a></li>
      <li><a href="https://www.gencon.com/press/2026-charity-partners-press-release">Gen Con
        Announces Charity Partners for 2026 Convention</a></li>`;
    expect(badgeAnnouncements(index).map((one) => one.year)).toEqual([2026, 2025, 2022]);
    expect(badgeAnnouncements(index)[0].url).toBe(
      'https://www.gencon.com/press/2026-reg-dates-and-badge-prices',
    );
  });
});

describe('official parking', () => {
  it('takes the booking link out of Gen Con\'s own article, so the partner can change', () => {
    // The article is the authority on who runs Gen Con's parking. Hard-coding
    // iPark would make a change of partner invisible instead of a finding.
    const body =
      '<p>iPark is the official parking partner.</p>' +
      '<p><a href="https://www.ipco.services/payments/events?e=ABC123">iPark</a></p>' +
      '<ul><li><a href="https://downtownindy.org/explore/parking">Downtown Indy</a></li></ul>';
    expect(linksIn(body)).toEqual([
      'https://www.ipco.services/payments/events?e=ABC123',
      'https://downtownindy.org/explore/parking',
    ]);
  });

  it('reads iPark\'s event list, which is how it knows booking is open', () => {
    const html =
      '<select><option selected value="">--Select Event--</option>' +
      '<option value="2DE6E2506393393D3EFFCCCDD7E4126D">Bruno Mars 2026</option>' +
      '<option value="3FD52BB6ACAF2D2ACB3532DE1ADDF9C2">Gen Con 2027</option></select>';
    expect(eventOptions(html)).toEqual([
      { id: '2DE6E2506393393D3EFFCCCDD7E4126D', name: 'Bruno Mars 2026' },
      { id: '3FD52BB6ACAF2D2ACB3532DE1ADDF9C2', name: 'Gen Con 2027' },
    ]);
    // The empty "--Select Event--" option carries no id and is not an event.
    expect(eventOptions(html).some((one) => one.name.startsWith('--'))).toBe(false);
  });

  it('prices the lots and leaves the marketing copy alone', () => {
    /*
     * The page repeats "$40.00" in its own sales patter further down, and a
     * price picked up from there would be attributed to a lot that never
     * charged it. A lot is a name with a bracketed location on the end.
     */
    const html =
      '<div>Gen Con 2027 (701 Kentucky)</div><div>$40.00</div>' +
      '<div>Gen Con 2027 (Merrill)</div><div>$60.00</div>' +
      '<p>Reserve your parking spot today</p><p>$40.00</p>';
    expect(lotPrices(html)).toEqual([
      { lot: 'Gen Con 2027 (701 Kentucky)', cents: 4_000 },
      { lot: 'Gen Con 2027 (Merrill)', cents: 6_000 },
    ]);
  });

  it('finds no price at all when the event is not listed, which is most of the year', () => {
    expect(lotPrices('<p>--Select Event--</p><p>Bruno Mars 2026</p>')).toEqual([]);
  });
});
