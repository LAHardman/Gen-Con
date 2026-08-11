/**
 * The dates page, which is a page somebody plans a year around.
 *
 * `key-dates.ts` is where the arithmetic is checked against Gen Con's own API.
 * What only shows up here is whether it reaches the screen honestly: a deadline
 * printed on the day before it for anybody west of Indiana, a countdown that
 * keeps counting after the date has gone, or — the one that matters most — a
 * confident-looking date on a row Gen Con has never published one for.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DatesView } from './DatesView';

afterEach(cleanup);

/** The first of March 2026, which is between two of the milestones. */
const MARCH = Date.parse('2026-03-01T12:00:00-05:00');

const rows = () => screen.getAllByRole('listitem');
const row = (name: string) => rows().find((one) => one.textContent?.includes(name))!;

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
});

describe('what it refuses to show', () => {
  it('says no date is published rather than printing a plausible one', () => {
    // The whole reason to trust the other four rows. Gen Con announces VIG
    // rebooking in a December newsletter and publishes no housing date at all.
    render(<DatesView nowMs={MARCH} />);
    for (const name of ['VIG rebooking', 'Housing registration']) {
      const found = row(name);
      expect(within(found).getByText(/No date published/)).toBeTruthy();
      // And it still says what *is* known, which is the ordering.
      expect(found.textContent).toMatch(/before badge registration|opened with badge registration/i);
    }
  });

  it('never counts down to something with no date', () => {
    render(<DatesView nowMs={MARCH} />);
    for (const name of ['VIG rebooking', 'Housing registration']) {
      expect(within(row(name)).queryByText(/^in \d+ days$/)).toBeNull();
      expect(within(row(name)).queryByText('gone')).toBeNull();
    }
  });

  it('keeps the undated rows where they belong in the year', () => {
    render(<DatesView nowMs={MARCH} />);
    const names = rows().map((one) => one.textContent ?? '');
    const at = (name: string) => names.findIndex((text) => text.includes(name));
    expect(at('VIG rebooking')).toBeLessThan(at('Badge registration opens'));
    expect(at('Housing registration')).toBeLessThan(at('Event catalogue goes live'));
  });
});
