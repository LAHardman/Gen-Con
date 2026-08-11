/**
 * The dates that decide whether you get to go, and the rule they follow.
 *
 * The convention is four days in August and the rest of the year is a queue.
 * Badges sell out of the hotels attached to them; the events people actually
 * want are gone in the first ten minutes of event registration. Missing one of
 * these by a day costs more than any wrong turn inside the building, and none
 * of them are in the event feed.
 *
 * THE RULE IS ANCHORED TO THE CONVENTION, NOT TO THE MONTH. This is the part
 * worth getting right and the easy thing to get wrong. Every milestone falls a
 * fixed number of days before the convention's Wednesday — 171 for badges, 73
 * for event registration — and because that Wednesday is always a Wednesday,
 * each one always lands on the same weekday. It *looks* like "the second Sunday
 * in February" and it is not: in 2027 the convention runs a week later than in
 * 2026, and so does every milestone. A month-anchored rule puts 2027's event
 * registration on 16 May; Gen Con's own API says 23 May.
 *
 * WHERE THE NUMBERS COME FROM. `https://www.gencon.com/api/v1/conventions`
 * returns every Gen Con since 2009 with its registration timestamps on it. The
 * five offsets below reproduce all four dated milestones exactly for 2024,
 * 2025, 2026 and 2027, and three of the four for 2023. Before that the show was
 * still settling after 2020 and the numbers wander; the tests record the API's
 * own values so a change to this file has to disagree with Gen Con out loud.
 *
 * AND THE CONVENTION ITSELF IS THE FIRST SATURDAY OF AUGUST. Thursday to
 * Sunday, with Trade Day on the Wednesday before — checked against the API for
 * 2022 to 2027 and against Gen Con's published future dates through 2030.
 *
 * WHAT IS NOT HERE, AND WHY. Gen Con publishes no date for VIG rebooking or for
 * housing: its own VIG page says the specifics "are detailed in the VIG
 * newsletter, which is emailed in December", and there is no housing date on
 * the site at all. Both are listed anyway, without a date and with what *is*
 * known — that VIGs buy before badge registration opens and book hotels before
 * housing does. An invented date on a page like this is worse than none: it
 * would be a diary entry somebody plans a year around.
 */

/** One thing that happens on the way to the convention. */
export interface Milestone {
  id: string;
  name: string;
  /** One line on what it actually is. */
  what: string;
  /**
   * Days before the convention's Wednesday, or null where nothing publishes a
   * date. Null is a real answer and the page prints it as one.
   */
  daysBefore: number | null;
  /** Minutes past midnight, Eastern. Every dated one of these is noon. */
  atMinutes?: number;
  /** Where Gen Con says it, for anybody who wants to check. */
  href?: string;
  /**
   * What is known when the date is not. Printed instead of a date, never
   * alongside a guess at one.
   */
  instead?: string;
}

/** Noon Eastern, which is when Gen Con opens all four of its dated gates. */
const NOON = 12 * 60;

/**
 * The milestones, soonest-in-the-year first.
 *
 * The four with a `daysBefore` are Gen Con's own timestamps, reduced to the
 * offset that reproduces them. The two without are the ones it does not
 * publish.
 */
export const MILESTONES: ReadonlyArray<Milestone> = [
  {
    id: 'vig',
    name: 'VIG rebooking',
    what: 'Returning VIGs buy next year’s package before anybody else, and pick a hotel before housing opens.',
    daysBefore: null,
    instead: 'Before badge registration. Gen Con emails the date to VIGs in December and publishes it nowhere.',
    href: 'https://www.gencon.com/attend/vig',
  },
  {
    id: 'event-submission',
    name: 'Event submission opens',
    what: 'The window for game masters and companies to submit the events they want to run.',
    daysBefore: 206,
    atMinutes: NOON,
    href: 'https://www.gencon.com/events',
  },
  {
    id: 'badges',
    name: 'Badge registration opens',
    what: 'Badges go on sale. Housing opens alongside it, and the hotels nearest the hall are gone the same day.',
    daysBefore: 171,
    atMinutes: NOON,
    href: 'https://www.gencon.com/badge_selection',
  },
  {
    id: 'housing',
    name: 'Housing registration',
    what: 'The block of convention hotel rooms opens to everybody who has a badge.',
    daysBefore: null,
    instead: 'Gen Con publishes no date for this. It has opened with badge registration in recent years.',
  },
  {
    id: 'catalogue',
    name: 'Event catalogue goes live',
    what: 'Every event is readable and searchable — two weeks to plan before tickets exist.',
    daysBefore: 87,
    atMinutes: NOON,
    href: 'https://www.gencon.com/event-catalog',
  },
  {
    id: 'event-registration',
    name: 'Event registration opens',
    what: 'Tickets go on sale. The events people want are gone in the first ten minutes, so have your list ready.',
    daysBefore: 73,
    atMinutes: NOON,
    href: 'https://www.gencon.com/events',
  },
];

/* --------------------------------------------------------------- the year */

const MS_DAY = 86_400_000;

/**
 * The convention's Saturday: the first Saturday of August.
 *
 * True of every Gen Con from 2022 to 2027 in the API, and of every future date
 * Gen Con has published through 2030.
 */
export function conventionSaturday(year: number): Date {
  const first = Date.UTC(year, 7, 1);
  const weekday = new Date(first).getUTCDay();
  // 6 is Saturday. However far into the week the 1st falls, walk forward.
  return new Date(first + ((6 - weekday + 7) % 7) * MS_DAY);
}

/** Trade Day, and the day every milestone is measured back from. */
export const conventionWednesday = (year: number): Date =>
  new Date(conventionSaturday(year).getTime() - 3 * MS_DAY);

/** Thursday to Sunday — the four days the schedule draws. */
export function conventionDaysOf(year: number): string[] {
  const saturday = conventionSaturday(year).getTime();
  return [-2, -1, 0, 1].map((shift) => iso(new Date(saturday + shift * MS_DAY)));
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Whether Eastern time is on daylight saving on a given day.
 *
 * Second Sunday in March to first Sunday in November. Needed because badge
 * registration is at noon in February — which is EST, five hours behind — and
 * event registration is at noon in May, which is EDT and four. Getting this
 * wrong moves a deadline by an hour, which for a queue that empties in ten
 * minutes is the whole thing.
 */
export function easternIsSummer(date: Date): boolean {
  const year = date.getUTCFullYear();
  const nth = (month: number, n: number) => {
    const first = Date.UTC(year, month, 1);
    const sunday = (7 - new Date(first).getUTCDay()) % 7;
    return Date.UTC(year, month, 1 + sunday + (n - 1) * 7);
  };
  return date.getTime() >= nth(2, 2) && date.getTime() < nth(10, 1);
}

/** `-04:00` or `-05:00`, as the feed spells offsets. */
export const easternOffset = (date: Date) => (easternIsSummer(date) ? -240 : -300);

/** A milestone's moment in a given year, or null where it has no date. */
export function milestoneAt(milestone: Milestone, year: number): Date | null {
  if (milestone.daysBefore === null) return null;
  const day = new Date(conventionWednesday(year).getTime() - milestone.daysBefore * MS_DAY);
  const minutes = milestone.atMinutes ?? 0;
  // The clock is Eastern, so the instant is that clock shifted by the offset in
  // force *on that day* — which is not the same offset in February and May.
  const offset = easternOffset(day);
  return new Date(day.getTime() + (minutes - offset) * 60_000);
}

export interface DatedMilestone {
  milestone: Milestone;
  /** Null where nothing publishes a date. */
  at: Date | null;
  /** Whole days from now until it, negative once it has gone. Null with no date. */
  daysAway: number | null;
  past: boolean;
}

/**
 * Which convention year somebody is planning for.
 *
 * Not the calendar year: on the fifth of August 2026 the next thing anybody is
 * planning is 2027, and a page still counting down to a convention that ended
 * three days ago is a page nobody trusts twice. It rolls over the day after the
 * convention's Sunday.
 */
export function planningYear(nowMs: number): number {
  const year = new Date(nowMs).getUTCFullYear();
  const sunday = conventionSaturday(year).getTime() + MS_DAY;
  return nowMs > sunday + MS_DAY ? year + 1 : year;
}

/** The milestones for a year, in the order they happen, with the clock applied. */
export function keyDates(year: number, nowMs: number): DatedMilestone[] {
  const dated = MILESTONES.map((milestone) => {
    const at = milestoneAt(milestone, year);
    return {
      milestone,
      at,
      // Whole days, rounded up, so something later today reads "today" rather
      // than "in 0 days" and something tomorrow morning does not read "today".
      daysAway: at ? Math.ceil((at.getTime() - nowMs) / MS_DAY) : null,
      past: at ? at.getTime() <= nowMs : false,
    };
  });

  /*
   * Undated ones sit where they belong rather than at the end.
   *
   * VIG rebooking happens before badge registration and housing with it; those
   * are the two facts Gen Con does publish about them, and an ordering is worth
   * more on this page than a date would be worth if it were invented.
   */
  const order = MILESTONES.map((one) => one.id);
  return dated.sort((a, b) => {
    if (a.at && b.at) return a.at.getTime() - b.at.getTime();
    return order.indexOf(a.milestone.id) - order.indexOf(b.milestone.id);
  });
}
