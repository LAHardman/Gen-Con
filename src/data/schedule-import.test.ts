/**
 * When a phone may go to Gen Con directly — asserted case by case, because
 * both wrong answers are invisible from here.
 *
 * Too eager is a swarm on somebody else's server: fifty thousand phones
 * each making 1,100 requests, which looks like nothing from this side and
 * like an attack from theirs. Too shy is an insurance policy that never
 * fires: the one copy whose host is gone sits with a three-year-old
 * schedule and never tries. Neither shows up in a screenshot, so both are
 * held here.
 */

import { describe, expect, it } from 'vitest';
import {
  MIN_DAYS_BETWEEN_ATTEMPTS,
  STALE_AFTER_DAYS,
  ageInDays,
  shouldDeviceImport,
  type ImportCircumstances,
} from './schedule-import';

/** A copy that would import: installed, online, on wi-fi, schedule long stale. */
const ready: ImportCircumstances = {
  native: true,
  online: true,
  feedAgeDays: STALE_AFTER_DAYS + 1,
  sinceLastAttemptDays: 30,
  unmetered: true,
};

const when = (over: Partial<ImportCircumstances>) => shouldDeviceImport({ ...ready, ...over });

describe('going direct to Gen Con', () => {
  it('does when the ordinary path has left the schedule stale', () => {
    expect(when({}).go).toBe(true);
  });

  it('never from a browser, which cannot read gencon.com at all', () => {
    // No CORS header on their side: this is not policy, it is impossible.
    expect(when({ native: false }).go).toBe(false);
    // And not even when a person presses the button.
    expect(when({ native: false, asked: true }).go).toBe(false);
  });

  it('never with no network, however much is asked of it', () => {
    expect(when({ online: false }).go).toBe(false);
    expect(when({ online: false, asked: true }).go).toBe(false);
  });

  it('not while the schedule in hand is current — that is the swarm', () => {
    // One request to the published feed already answered this. 1,100 more
    // would learn the same thing, from a server that is not ours.
    expect(when({ feedAgeDays: STALE_AFTER_DAYS - 1 }).go).toBe(false);
    expect(when({ feedAgeDays: 0 }).go).toBe(false);
  });

  it('not twice in a day, so a failing import cannot become a loop', () => {
    expect(when({ sinceLastAttemptDays: MIN_DAYS_BETWEEN_ATTEMPTS - 0.01 }).go).toBe(false);
    expect(when({ sinceLastAttemptDays: MIN_DAYS_BETWEEN_ATTEMPTS }).go).toBe(true);
  });

  it('waits for wi-fi, because nine megabytes is somebody’s data allowance', () => {
    expect(when({ unmetered: false }).go).toBe(false);
  });

  it('spends the metered connection when there is no schedule at all', () => {
    // An app with no catalogue is not much of a convention app, and this is
    // the one case worth the bytes without asking.
    expect(when({ feedAgeDays: null, unmetered: false }).go).toBe(true);
  });

  it('does what a person asks, short of the impossible', () => {
    expect(when({ asked: true, feedAgeDays: 0 }).go).toBe(true);
    expect(when({ asked: true, unmetered: false }).go).toBe(true);
    expect(when({ asked: true, sinceLastAttemptDays: 0 }).go).toBe(true);
  });

  it('says why, so a status line can be written from it', () => {
    expect(when({ feedAgeDays: 30 }).because).toContain('30 days old');
    expect(when({ native: false }).because).toMatch(/installed app/);
    expect(when({ unmetered: false }).because).toMatch(/wi-fi/);
  });
});

describe('reading an age off a timestamp', () => {
  const now = Date.parse('2026-08-27T12:00:00Z');
  it('measures in days, and refuses what it cannot read', () => {
    expect(ageInDays('2026-08-20T12:00:00Z', now)).toBe(7);
    expect(ageInDays(null, now)).toBeNull();
    expect(ageInDays('not a date', now)).toBeNull();
  });
});
