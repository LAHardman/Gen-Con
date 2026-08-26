/**
 * The two ways a plan is already wrong before anybody leaves home.
 *
 * A schedule this app will happily let you build is one where the same person
 * is in two rooms at two o'clock on the Saturday, and one where they have a
 * ticket for a Sunday game and a Thursday-only badge. Neither is caught by
 * anything else: the schedule draws both without complaint, because it draws a
 * party's plan and does not know a party has people in it, and the badge store
 * is a shop that never sees the schedule.
 *
 * The budget is the one page that knows both. So it is the page that says so.
 *
 * AN UNASSIGNED EVENT BELONGS TO EVERYBODY. It is the same rule the money uses
 * — a line with no names on it is shared — and it has to be, or the ordinary
 * case of one person with nothing assigned would be the case that is never
 * checked. That is also the honest reading: an event on your schedule with
 * nobody's name against it is one you are all going to until somebody says
 * otherwise.
 *
 * NOTHING HERE GUESSES AT TRAVEL TIME. Two events back to back in two buildings
 * is a different problem, and `planDay` already draws the walk between them.
 * This is only about the two that cannot both be true.
 */

import { daysCovered, type Badge, type BadgeKind } from './badges';
import type { Person } from './budget';
import { dayKey } from './events';
import { dayName, entryEndMs, type PlanEntry } from './plan';

export type ConflictKind = 'clash' | 'uncovered';

export interface Conflict {
  kind: ConflictKind;
  person: Person;
  /** The entries it is about: two for a clash, one for an uncovered day. */
  entries: PlanEntry[];
  /** The sentence the page prints. Built here so it is tested with the rule. */
  says: string;
}

/** Who is down for an event: the names on it, or everybody when there are none. */
export function goersOf(
  entry: PlanEntry,
  party: readonly Person[],
  assigned: Readonly<Record<string, string[]>>,
): Person[] {
  const named = assigned[entry.id] ?? [];
  if (named.length === 0) return [...party];
  const found = party.filter((person) => named.includes(person.id));
  // Everybody named has left the party. Somebody is still going — the event is
  // on the schedule — and the same fallback the money uses applies here.
  return found.length > 0 ? found : [...party];
}

/** Do these two overlap? Touching at the edges does not count. */
function overlap(a: PlanEntry, b: PlanEntry): boolean {
  const from = Date.parse(a.start);
  const to = entryEndMs(a);
  const otherFrom = Date.parse(b.start);
  const otherTo = entryEndMs(b);
  if ([from, to, otherFrom, otherTo].some(Number.isNaN)) return false;
  // A game ending at 2 and another starting at 2 is a tight afternoon, not a
  // clash. Strict inequalities on both sides, or every back-to-back pair on a
  // full schedule would be reported and the real ones would be lost in them.
  return from < otherTo && otherFrom < to;
}

/**
 * The clock time as the timestamp itself says it.
 *
 * Sliced rather than parsed, for exactly the reason `dayKey` slices: every
 * timestamp in the feed carries the convention's own offset, so the characters
 * at 11..16 are Indianapolis time. Parsing and formatting would give the
 * *reader's* time zone, and a clash reported at "6:00 PM" to somebody in
 * California is a clash they will not find on their schedule.
 */
const at = (entry: PlanEntry) => {
  const [hours, minutes] = entry.start.slice(11, 16).split(':');
  const hour = Number(hours);
  if (!Number.isFinite(hour)) return entry.start.slice(11, 16);
  const oClock = hour % 12 === 0 ? 12 : hour % 12;
  return `${oClock}:${minutes} ${hour < 12 ? 'am' : 'pm'}`;
};

/**
 * Everything wrong with the plan, per person.
 *
 * Sorted by when it goes wrong rather than by person, because somebody reading
 * this is looking at a Saturday afternoon and wants both problems in it
 * together, not one person's whole convention followed by the next person's.
 */
export function conflictsIn(
  entries: readonly PlanEntry[],
  party: readonly Person[],
  assigned: Readonly<Record<string, string[]>>,
  badges: readonly Badge[],
  year: number,
): Conflict[] {
  const found: Conflict[] = [];
  const badgeOf = new Map(badges.map((badge) => [badge.personId, badge.kind]));

  for (const person of party) {
    const mine = entries
      .filter((entry) => goersOf(entry, party, assigned).some((one) => one.id === person.id))
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

    // Two at once. Every pair, because three overlapping events are three
    // problems and reporting only the first would hide the third.
    for (let i = 0; i < mine.length; i += 1) {
      for (let j = i + 1; j < mine.length; j += 1) {
        if (!overlap(mine[i], mine[j])) continue;
        found.push({
          kind: 'clash',
          person,
          entries: [mine[i], mine[j]],
          says: `${person.name} is down for two things at ${at(mine[i])} on ${dayName(dayKey(mine[i].start))}: ${mine[i].title} and ${mine[j].title}.`,
        });
      }
    }

    // A day they cannot get in on.
    const kind: BadgeKind = badgeOf.get(person.id) ?? 'none';
    const covered = new Set(daysCovered(kind, year));
    for (const entry of mine) {
      const day = dayKey(entry.start);
      // Only the convention's own days are judged. A dinner on the Tuesday
      // before is not something a badge lets you into or keeps you out of.
      if (covered.has(day)) continue;
      if (!isConventionWeek(day, year)) continue;
      found.push({
        kind: 'uncovered',
        person,
        entries: [entry],
        says:
          kind === 'none'
            ? `${person.name} has no badge yet, and ${entry.title} is on the ${dayName(day)}.`
            : `${person.name} has a ${kindName(kind)} and ${entry.title} is on the ${dayName(day)}.`,
      });
    }
  }

  return found.sort((a, b) => Date.parse(a.entries[0].start) - Date.parse(b.entries[0].start));
}

/** Wednesday to Sunday of the convention, which is what a badge can speak to. */
function isConventionWeek(day: string, year: number): boolean {
  const week = new Set([
    ...daysCovered('trade-day', year),
    ...daysCovered('four-day', year),
  ]);
  return week.has(day);
}

const kindName = (kind: BadgeKind) =>
  kind === 'four-day' ? '4-day badge' : `${kind.replace('-', ' ')} badge`;
