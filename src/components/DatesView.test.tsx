/**
 * The dates page, which is a page somebody plans a year around.
 *
 * `key-dates.ts` is where the arithmetic is checked against Gen Con's own API.
 * What only shows up here is whether it reaches the screen honestly: a deadline
 * printed on the day before it for anybody west of Indiana, a countdown that
 * keeps counting after the date has gone, or — the one that matters most — a
 * derived date that reaches the screen looking exactly like a published one.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MILESTONES } from '../data/key-dates';
import { DatesView } from './DatesView';

afterEach(cleanup);

/** The first of March 2026, which is between two of the milestones. */
const MARCH = Date.parse('2026-03-01T12:00:00-05:00');

const rows = () => screen.getAllByRole('listitem');
const row = (name: string) => rows().find((one) => one.textContent?.includes(name))!;

/** The three Gen Con publishes no date for, taken from the data rather than retyped. */
const GUESSED = MILESTONES.filter((one) => one.daysBefore === null);

describe('what it shows', () => {
  it('names the year somebody is planning for', () => {
    render(<DatesView nowMs={MARCH} />);
    expect(screen.getByRole('heading', { name: 'Gen Con 2026' })).toBeTruthy();
  });

  it('rolls on to next year once the convention is over', () => {
    // A page counting down to a show that ended on Sunday is a page nobody
    // trusts twice.
    render(<DatesView nowMs={Date.parse('2026-08-06T12:00:00-04:00')} />);
    expect(screen.getByRole('heading', { name: 'Gen Con 2027' })).toBeTruthy();
  });

  it('prints each date at Indianapolis’ clock, not the reader’s', () => {
    // Noon Eastern on 17 May. Formatted in the reader's zone this would read as
    // the 16th for anybody far enough west, which on a deadline is a day out.
    render(<DatesView nowMs={MARCH} />);
    const registration = row('Event registration opens');
    // The day, not the format: the assertion has to survive the reader's locale
    // putting the month first, and has to fail if the zone moves the date.
    const printed = registration.querySelector('.dates__date')!.textContent!;
    expect(printed).toMatch(/\b17\b/);
    expect(printed).not.toMatch(/\b16\b/);
    expect(printed).toMatch(/2026/);
    expect(within(registration).getByText(/Eastern/)).toBeTruthy();
  });

  it('counts down to what is still coming and marks what has gone', () => {
    render(<DatesView nowMs={MARCH} />);
    expect(within(row('Badge registration opens')).getByText('gone')).toBeTruthy();
    expect(within(row('Event registration opens')).getByText(/^in \d+ days$/)).toBeTruthy();
  });

  it('marks exactly one row as the next thing to act on', () => {
    render(<DatesView nowMs={MARCH} />);
    const tagged = rows().filter((one) => within(one).queryByText('next'));
    expect(tagged).toHaveLength(1);
    expect(tagged[0].textContent).toContain('Event catalogue goes live');
  });

  it('keeps every row in the order the year happens in', () => {
    render(<DatesView nowMs={MARCH} />);
    const names = rows().map((one) => one.textContent ?? '');
    const at = (name: string) => names.findIndex((text) => text.includes(name));
    expect(at('VIG rebooking')).toBeLessThan(at('Badge registration opens'));
    expect(at('New VIG packages')).toBeLessThan(at('Event catalogue goes live'));
    expect(at('Housing registration')).toBeLessThan(at('Event catalogue goes live'));
  });
});

describe('the estimated dates', () => {
  it('gives every undated milestone a date to plan around', () => {
    // The point of the estimates. "No date published" is honest and useless:
    // somebody who has to book leave needs a day to aim at.
    render(<DatesView nowMs={MARCH} />);
    expect(GUESSED.length).toBeGreaterThan(0);
    for (const milestone of GUESSED) {
      const printed = row(milestone.name).querySelector('.dates__date')!.textContent!;
      expect(printed).toMatch(/\b2026\b/);
    }
  });

  it('never lets a derived date look like a published one', () => {
    // The assertion the whole page rests on. Every estimated row has to carry
    // the word on its face and in a class the eye can be styled by — a column
    // where one date is a guess and nothing marks it is worse than a gap.
    render(<DatesView nowMs={MARCH} />);
    for (const milestone of GUESSED) {
      const found = row(milestone.name);
      expect(within(found).getByText('estimated')).toBeTruthy();
      expect(found.querySelector('.dates__date--guess')).toBeTruthy();
      // And never the clock: an estimate to the minute is a lie about precision.
      expect(within(found).queryByText(/Eastern/)).toBeNull();
    }
  });

  it('shows the reasoning each estimate rests on', () => {
    render(<DatesView nowMs={MARCH} />);
    for (const milestone of GUESSED) {
      expect(row(milestone.name).textContent).toContain(milestone.estimate!.because);
    }
  });

  it('says “by” where Gen Con only says “before”', () => {
    // Rebooking happens at some point ahead of badge registration and Gen Con
    // does not say when. "By 8 February" is that; "8 February" is not.
    render(<DatesView nowMs={MARCH} />);
    expect(row('VIG rebooking').querySelector('.dates__date')!.textContent).toMatch(/^By /);
  });

  it('counts a bound down as a bound', () => {
    // "in 38 days" promises a day; "within 38 days" promises a deadline, which
    // is all Gen Con has said. Rendered in January, while it is still ahead —
    // by March the row reads "gone" and would hide the difference.
    render(<DatesView nowMs={Date.parse('2026-01-01T12:00:00-05:00')} />);
    const rebooking = row('VIG rebooking');
    expect(rebooking.querySelector('.dates__away')!.textContent).toMatch(/^within \d+ days$/);
    // And a published date is still a promise, on the same render.
    expect(row('Badge registration opens').querySelector('.dates__away')!.textContent).toMatch(
      /^in \d+ days$/,
    );
  });

  it('never marks an estimate as the next thing to act on', () => {
    // Telling somebody to act on a guess is the one thing worse than not
    // showing them the guess. Rendered a fortnight before the estimated dates,
    // when they are the soonest rows on the page.
    render(<DatesView nowMs={Date.parse('2026-02-01T12:00:00-05:00')} />);
    const tagged = rows().filter((one) => within(one).queryByText('next'));
    expect(tagged).toHaveLength(1);
    for (const milestone of GUESSED) {
      expect(tagged[0].textContent).not.toContain(milestone.name);
    }
  });
});
