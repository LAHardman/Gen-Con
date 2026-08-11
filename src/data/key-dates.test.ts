/**
 * The dates, checked against Gen Con's own answers.
 *
 * This is a page somebody plans a year around, so the only test worth having is
 * one that fails when the rule disagrees with the source. The timestamps below
 * are recorded verbatim from `https://www.gencon.com/api/v1/conventions`, which
 * returns every Gen Con since 2009 with its registration times on it, and the
 * future show dates are the ones Gen Con publishes at `/attend/futuredates`.
 *
 * WHAT THAT CATCHES that a hand-written expectation would not: the rule is
 * anchored to the *convention*, not to the month. "The second Sunday in
 * February" and "171 days before the convention Wednesday" agree in 2026 and
 * differ by a week in 2027, and only one of them is what Gen Con does.
 */

import { describe, expect, it } from 'vitest';
import {
  conventionDaysOf,
  conventionSaturday,
  conventionWednesday,
  easternIsSummer,
  easternOffset,
  keyDates,
  milestoneAt,
  MILESTONES,
  planningYear,
} from './key-dates';

/** Verbatim from Gen Con's own API, one row per convention. */
const RECORDED = {
  2022: {
    start: '2022-08-03',
    badge_registration_start: '2022-01-30T12:00:00.000-05:00',
    event_submission_start: '2022-01-09T12:00:00.000-05:00',
    view_events_start: '2022-05-01T12:00:00.000-04:00',
    event_registration_start: '2022-05-15T12:00:00.000-04:00',
  },
  2023: {
    start: '2023-08-02',
    badge_registration_start: '2023-01-29T12:00:00.000-05:00',
    event_submission_start: '2023-05-21T12:00:00.000-04:00',
    view_events_start: '2023-05-07T12:00:00.000-04:00',
    event_registration_start: '2023-05-21T12:00:00.000-04:00',
  },
  2024: {
    start: '2024-07-31',
    badge_registration_start: '2024-02-11T12:00:00.000-05:00',
    event_submission_start: '2024-01-07T12:00:00.000-05:00',
    view_events_start: '2024-05-05T12:00:00.000-04:00',
    event_registration_start: '2024-05-19T12:00:00.000-04:00',
  },
  2025: {
    start: '2025-07-30',
    badge_registration_start: '2025-02-09T12:00:00.000-05:00',
    event_submission_start: '2025-01-05T12:00:00.000-05:00',
    view_events_start: '2025-05-04T12:00:00.000-04:00',
    event_registration_start: '2025-05-18T12:00:00.000-04:00',
  },
  2026: {
    start: '2026-07-29',
    badge_registration_start: '2026-02-08T12:00:00.000-05:00',
    event_submission_start: '2026-01-04T12:00:00.000-05:00',
    view_events_start: '2026-05-03T12:00:00.000-04:00',
    event_registration_start: '2026-05-17T12:00:00.000-04:00',
  },
  2027: {
    start: '2027-08-04',
    badge_registration_start: '2027-02-14T12:00:00.000-05:00',
    event_submission_start: '2027-01-10T12:00:00.000-05:00',
    view_events_start: '2027-05-09T12:00:00.000-04:00',
    event_registration_start: '2027-05-23T12:00:00.000-04:00',
  },
} as const;

/** What each milestone id is called in the API. */
const FIELD: Record<string, keyof (typeof RECORDED)[2026]> = {
  'event-submission': 'event_submission_start',
  badges: 'badge_registration_start',
  catalogue: 'view_events_start',
  'event-registration': 'event_registration_start',
};

const day = (date: Date) => date.toISOString().slice(0, 10);

describe('when the convention is', () => {
  it('puts its Wednesday where Gen Con’s own API puts it', () => {
    for (const [year, row] of Object.entries(RECORDED)) {
      expect(day(conventionWednesday(Number(year))), year).toBe(row.start);
    }
  });

  it('matches the future dates Gen Con publishes, out to 2030', () => {
    // From `gencon.com/attend/futuredates`: the Thursday and the Sunday.
    const published: Record<number, [string, string]> = {
      2026: ['2026-07-30', '2026-08-02'],
      2027: ['2027-08-05', '2027-08-08'],
      2028: ['2028-08-03', '2028-08-06'],
      2029: ['2029-08-02', '2029-08-05'],
      2030: ['2030-08-01', '2030-08-04'],
    };
    for (const [year, [thursday, sunday]] of Object.entries(published)) {
      const days = conventionDaysOf(Number(year));
      expect(days[0], year).toBe(thursday);
      expect(days[3], year).toBe(sunday);
      expect(days).toHaveLength(4);
    }
  });

  it('is the first Saturday of August, which is the whole rule', () => {
    for (const year of [2026, 2027, 2028, 2029, 2030, 2031]) {
      const saturday = conventionSaturday(year);
      expect(saturday.getUTCDay()).toBe(6);
      expect(saturday.getUTCMonth()).toBe(7);
      expect(saturday.getUTCDate()).toBeLessThanOrEqual(7);
    }
  });
});

describe('the milestones, against the API that produced them', () => {
  it('reproduces every dated one for 2024 to 2027', () => {
    // The years the show has been settled. Each is the exact instant, not the
    // date: an hour out on a queue that empties in ten minutes is the whole
    // thing, and February and May are on different sides of the clock change.
    for (const year of [2024, 2025, 2026, 2027] as const) {
      for (const milestone of MILESTONES) {
        const field = FIELD[milestone.id];
        if (!field) continue;
        const at = milestoneAt(milestone, year)!;
        expect(at.toISOString(), `${year} ${milestone.id}`).toBe(
          new Date(RECORDED[year][field]).toISOString(),
        );
      }
    }
  });

  it('is anchored to the convention rather than to the month', () => {
    // The distinction that matters, and the one a month rule gets wrong. 2027
    // runs a week later than 2026, and so does everything before it — the third
    // Sunday in May 2027 is the 16th, and Gen Con opens registration on the 23rd.
    const registration = MILESTONES.find((one) => one.id === 'event-registration')!;
    expect(day(milestoneAt(registration, 2026)!)).toBe('2026-05-17');
    expect(day(milestoneAt(registration, 2027)!)).toBe('2027-05-23');
    const thirdSundayIn2027 = '2027-05-16';
    expect(day(milestoneAt(registration, 2027)!)).not.toBe(thirdSundayIn2027);
  });

  it('lands every dated one on the same weekday, whatever the year', () => {
    // Which is *why* it looks like a weekday-of-month rule: a fixed number of
    // days before a Wednesday is always the same weekday.
    for (const milestone of MILESTONES) {
      if (milestone.daysBefore === null) continue;
      const weekdays = [2026, 2027, 2028, 2029, 2030].map((year) =>
        milestoneAt(milestone, year)!.getUTCDay(),
      );
      expect(new Set(weekdays).size, milestone.id).toBe(1);
    }
  });

  it('carries no published date of its own for the three Gen Con does not give', () => {
    // The estimate is built in `keyDates` from a milestone that *is* published.
    // `milestoneAt` is the published answer and has to stay empty here, or an
    // estimate would leak into somewhere that never marks one.
    for (const id of ['vig', 'vig-new', 'housing']) {
      const milestone = MILESTONES.find((one) => one.id === id)!;
      expect(milestone.daysBefore).toBeNull();
      expect(milestoneAt(milestone, 2026)).toBeNull();
      // And each says what its estimate rests on, in Gen Con's own words.
      expect(milestone.estimate?.because).toBeTruthy();
      expect(milestone.estimate?.sameAs ?? milestone.estimate?.before).toBeTruthy();
    }
  });
});

describe('the clock the deadline is on', () => {
  it('reads February as standard time and May as summer', () => {
    expect(easternIsSummer(new Date('2026-02-08T12:00:00Z'))).toBe(false);
    expect(easternIsSummer(new Date('2026-05-17T12:00:00Z'))).toBe(true);
    expect(easternOffset(new Date('2026-02-08T12:00:00Z'))).toBe(-300);
    expect(easternOffset(new Date('2026-05-17T12:00:00Z'))).toBe(-240);
  });

  it('turns over on the right Sundays', () => {
    // Second Sunday in March, first Sunday in November — 2026's are the 8th and
    // the 1st. Checked on both sides of each.
    expect(easternIsSummer(new Date('2026-03-07T12:00:00Z'))).toBe(false);
    expect(easternIsSummer(new Date('2026-03-08T12:00:00Z'))).toBe(true);
    expect(easternIsSummer(new Date('2026-10-31T12:00:00Z'))).toBe(true);
    expect(easternIsSummer(new Date('2026-11-01T12:00:00Z'))).toBe(false);
  });
});

describe('which year somebody is planning for', () => {
  it('rolls over once the convention is done, not at new year', () => {
    // On the fifth of August the next thing anybody is planning is next year,
    // and a page counting down to a show that ended on Sunday is a page nobody
    // trusts twice.
    expect(planningYear(Date.parse('2026-01-02T12:00:00Z'))).toBe(2026);
    expect(planningYear(Date.parse('2026-07-29T12:00:00Z'))).toBe(2026);
    expect(planningYear(Date.parse('2026-08-02T12:00:00Z'))).toBe(2026);
    expect(planningYear(Date.parse('2026-08-05T12:00:00Z'))).toBe(2027);
    expect(planningYear(Date.parse('2026-12-31T12:00:00Z'))).toBe(2027);
  });
});

describe('the list a page draws', () => {
  const NOW = Date.parse('2026-03-01T12:00:00-05:00');

  it('is in the order they happen', () => {
    const dated = keyDates(2026, NOW).filter((one) => one.at);
    const times = dated.map((one) => one.at!.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('says which have gone and how far off the rest are', () => {
    const rows = keyDates(2026, NOW);
    const badges = rows.find((one) => one.milestone.id === 'badges')!;
    const registration = rows.find((one) => one.milestone.id === 'event-registration')!;
    expect(badges.past).toBe(true);
    expect(badges.daysAway!).toBeLessThan(0);
    expect(registration.past).toBe(false);
    // 1 March to 17 May, less the hour the clocks go forward in between.
    expect(registration.daysAway).toBe(77);
  });

  it('estimates the three Gen Con does not publish, and marks every one', () => {
    // The contract this page stands on: a derived date is useful, and a derived
    // date that looks like a published one is worse than no date at all.
    const rows = keyDates(2026, NOW);
    const badges = rows.find((one) => one.milestone.id === 'badges')!;
    expect(badges.kind).toBe('published');

    for (const id of ['vig', 'vig-new', 'housing']) {
      const row = rows.find((one) => one.milestone.id === id)!;
      expect(row.kind, id).toBe('estimated');
      expect(row.at, id).not.toBeNull();
      expect(row.at!.getTime(), id).toBe(badges.at!.getTime());
    }
    // Rebooking is a bound — Gen Con says before, not when. The other two are
    // estimated to be the day itself.
    expect(rows.find((one) => one.milestone.id === 'vig')!.bound).toBe('before');
    expect(rows.find((one) => one.milestone.id === 'vig-new')!.bound).toBe('on');
  });

  it('keeps the estimated ones in the order Gen Con describes', () => {
    // They share a date with badge registration, so the tie has to break on the
    // ordering Gen Con does publish: rebook, then what is left, then housing.
    const ids = keyDates(2026, NOW).map((one) => one.milestone.id);
    expect(ids.indexOf('vig')).toBeLessThan(ids.indexOf('vig-new'));
    expect(ids.indexOf('vig-new')).toBeLessThan(ids.indexOf('housing'));
    expect(ids.indexOf('event-submission')).toBeLessThan(ids.indexOf('vig'));
    expect(ids[ids.length - 1]).toBe('event-registration');
  });
});
