/**
 * Reading somebody else's opening hours, and refusing to when they cannot be.
 *
 * `opening_hours` is a real specification and this reads a subset of it. The
 * two things worth guarding are opposite failures:
 *
 *   READING A FORM WRONG. "Mo-Su 11:00-14:30,17:00-22:00" is a lunch service
 *   and a dinner service, and a parser that let the second overwrite the first
 *   would say a restaurant is shut at midday. "Mo-Sa 08:00-21:00; Su off" is a
 *   later rule cancelling an earlier one for one day, and getting that backwards
 *   opens it on the day it is closed.
 *
 *   READING A FORM IT CANNOT. "Sa[1] 09:00-12:00" is the first Saturday of the
 *   month; "PH off" is public holidays; "sunset-24:00" needs an almanac. Half
 *   understanding any of those produces a confident wrong answer, so this
 *   returns null and the app shows the line as written.
 */

import { describe, expect, it } from 'vitest';
import { formatOpening, openAt, openThrough, parseOpeningHours } from './hours';
import { EATERIES } from './eateries';

/** Indianapolis in August. */
const EAST = -240;
const at = (iso: string) => Date.parse(iso);

describe('the forms it reads', () => {
  it('takes a day range and a time range', () => {
    const opening = parseOpeningHours('Mo-Sa 06:00-19:00; Su 07:00-15:00')!;
    expect(formatOpening(opening)).toBe('Mon–Sat 6am–7pm · Sun 7am–3pm');
    // Saturday breakfast, and Sunday teatime after it shuts.
    expect(openAt(opening, at('2026-08-01T08:00:00-04:00'), EAST)).toBe(true);
    expect(openAt(opening, at('2026-08-02T16:00:00-04:00'), EAST)).toBe(false);
  });

  it('keeps both halves of a split service', () => {
    // The one that would quietly break: a parser where each range overrides the
    // last would say this is shut at lunchtime, which is when it is busiest.
    const opening = parseOpeningHours('Mo-Su 11:00-14:30,17:00-22:00')!;
    expect(opening.hours).toHaveLength(2);
    expect(openAt(opening, at('2026-08-01T12:00:00-04:00'), EAST)).toBe(true);
    expect(openAt(opening, at('2026-08-01T16:00:00-04:00'), EAST)).toBe(false);
    expect(openAt(opening, at('2026-08-01T19:00:00-04:00'), EAST)).toBe(true);
  });

  it('lets a later rule close a day an earlier one opened', () => {
    const opening = parseOpeningHours('Mo-Sa 08:00-21:00; Su off')!;
    expect(openAt(opening, at('2026-08-01T12:00:00-04:00'), EAST)).toBe(true);
    expect(openAt(opening, at('2026-08-02T12:00:00-04:00'), EAST)).toBe(false);
  });

  it('takes a day list as well as a range', () => {
    const opening = parseOpeningHours('Mo-Th 11:00-21:00; Fr,Sa 11:00-22:00')!;
    expect(openAt(opening, at('2026-07-31T21:30:00-04:00'), EAST)).toBe(true);
    expect(openAt(opening, at('2026-07-30T21:30:00-04:00'), EAST)).toBe(false);
  });

  it('takes times with no days at all as every day', () => {
    const opening = parseOpeningHours('10:00-24:00')!;
    expect(opening.hours[0].days).toHaveLength(7);
    expect(openAt(opening, at('2026-08-02T23:00:00-04:00'), EAST)).toBe(true);
  });

  it('takes 24/7', () => {
    const opening = parseOpeningHours('24/7')!;
    expect(openAt(opening, at('2026-08-02T03:00:00-04:00'), EAST)).toBe(true);
  });

  it('reads a day range that wraps the week', () => {
    const opening = parseOpeningHours('Fr-Mo 09:00-17:00')!;
    expect(opening.hours[0].days.sort()).toEqual([0, 1, 5, 6]);
  });

  it('carries a span past midnight into the next morning', () => {
    // A bar open until two is open at one in the morning *the next day*, and a
    // reader that only checked the day's own span would call it shut.
    const opening = parseOpeningHours('Fr 17:00-02:00')!;
    expect(openAt(opening, at('2026-07-31T23:00:00-04:00'), EAST)).toBe(true);
    expect(openAt(opening, at('2026-08-01T01:00:00-04:00'), EAST)).toBe(true);
    expect(openAt(opening, at('2026-08-01T03:00:00-04:00'), EAST)).toBe(false);
  });
});

describe('the forms it refuses', () => {
  it('gives up rather than half-understanding', () => {
    // Each of these has a meaning this does not implement, and each would be
    // answered wrongly by a parser that skipped what it did not know.
    for (const line of [
      'Sa[1] 09:00-12:00',
      'PH off',
      'Mo-Fr 09:00-17:00; PH 10:00-14:00',
      'sunrise-sunset',
      'Jan-Mar 09:00-17:00',
      'week 1-20 09:00-17:00',
      'Mo-Fr 09:00-17:00 "by appointment"',
      'Mo-Fr 09:00+',
      'nonsense',
      '',
    ]) {
      expect(parseOpeningHours(line)).toBeNull();
    }
  });

  it('refuses a day nobody writes', () => {
    expect(parseOpeningHours('Xx 09:00-17:00')).toBeNull();
  });
});

describe('reading them at the convention’s clock', () => {
  it('does not read the viewer’s', () => {
    // Nine in the evening in Indianapolis is one in the morning in UTC. Read in
    // the wrong zone a restaurant looks shut all evening and open at dawn.
    const opening = parseOpeningHours('Mo-Su 11:00-22:00')!;
    const evening = at('2026-08-01T21:00:00-04:00');
    expect(openAt(opening, evening, EAST)).toBe(true);
    expect(openAt(opening, evening, 0)).toBe(false);
  });

  it('answers a whole span, not just its start', () => {
    const opening = parseOpeningHours('Mo-Su 11:00-21:00')!;
    expect(openThrough(opening, '2026-08-01', 12 * 60, 13 * 60)).toBe('open');
    expect(openThrough(opening, '2026-08-01', 20 * 60, 22 * 60)).toBe('partly');
    expect(openThrough(opening, '2026-08-01', 22 * 60, 23 * 60)).toBe('shut');
  });
});

describe('against the rows actually downtown', () => {
  it('reads all but the two that say something it does not implement', () => {
    // The real measure of a subset parser: what fraction of the corpus it
    // understands, and that the rest fail visibly rather than quietly. 36 of
    // the 38 rows with hours parse; the two that do not are a comma-separated
    // pair of whole rules and one carrying `open "Lunch"` comments, and both
    // are shown to the reader exactly as OpenStreetMap holds them.
    const withHours = EATERIES.filter((one) => one.hours);
    const read = withHours.filter((one) => parseOpeningHours(one.hours!));
    expect(withHours.length).toBeGreaterThan(30);
    expect(read.length).toBeGreaterThanOrEqual(withHours.length - 3);
  });

  it('never returns hours that say nothing', () => {
    // A parse that came back with an empty span list would read as "open never"
    // and filter a restaurant out of "open now" for the whole convention.
    for (const one of EATERIES) {
      const opening = one.hours ? parseOpeningHours(one.hours) : null;
      if (!opening) continue;
      expect(opening.hours.length).toBeGreaterThan(0);
      for (const span of opening.hours) {
        expect(span.days.length).toBeGreaterThan(0);
        expect(span.to).toBeGreaterThan(span.from);
      }
    }
  });
});
