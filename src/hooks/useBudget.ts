/**
 * The party and the typed costs, kept on the device.
 *
 * Same store, same rules and the same reasons as `usePlan` — see that file.
 *
 * WHAT IS HERE AND WHAT IS NOT. The party, the lines somebody typed, and which
 * of the derived lines belongs to whom. Not the booked hotels, which live in
 * `useBookings` and are written from a different page; not the planned events,
 * which live in the plan. The budget reads both of those and adds nothing to
 * them, which is what keeps a hotel un-booked or an event dropped from quietly
 * leaving a cost behind.
 */

import { useCallback, useEffect, useState } from 'react';
import { usableBadge, type Badge, type BadgeKind } from '../data/badges';
import { CATEGORIES, type Category, type Line, type Person } from '../data/budget';

const KEY = 'genCon.budget';
const VERSION = 1;

interface Saved {
  version: number;
  party: Person[];
  lines: Line[];
  /** Derived-line assignments, keyed by the event's own id. */
  assigned: Record<string, string[]>;
  /** Which days each person's badge buys. See `badges.ts`. */
  badges: Badge[];
}

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((one) => typeof one === 'string');

function usablePerson(value: unknown): value is Person {
  const one = value as Partial<Person> | null;
  return !!one && typeof one.id === 'string' && typeof one.name === 'string';
}

function usableLine(value: unknown): value is Line {
  const one = value as Partial<Line> | null;
  return (
    !!one &&
    typeof one.id === 'string' &&
    typeof one.label === 'string' &&
    typeof one.cents === 'number' &&
    Number.isFinite(one.cents) &&
    typeof one.times === 'number' &&
    Number.isFinite(one.times) &&
    CATEGORIES.includes(one.category as Category) &&
    strings(one.who)
  );
}

/** Whatever was under the key, reduced to the parts of it that are usable. */
export function readBudget(): Omit<Saved, 'version'> {
  const nothing = { party: [], lines: [], assigned: {}, badges: [] };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return nothing;
    const saved = JSON.parse(raw) as Partial<Saved>;
    if (saved?.version !== VERSION) return nothing;
    const assigned: Record<string, string[]> = {};
    for (const [id, who] of Object.entries(saved.assigned ?? {})) {
      if (strings(who)) assigned[id] = who;
    }
    return {
      party: Array.isArray(saved.party) ? saved.party.filter(usablePerson) : [],
      lines: Array.isArray(saved.lines) ? saved.lines.filter(usableLine) : [],
      assigned,
      badges: Array.isArray(saved.badges) ? saved.badges.filter(usableBadge) : [],
    };
  } catch {
    return nothing;
  }
}

export interface BudgetStore {
  party: Person[];
  lines: Line[];
  assigned: Record<string, string[]>;
  badges: Badge[];
  addPerson: (name: string) => void;
  renamePerson: (id: string, name: string) => void;
  removePerson: (id: string) => void;
  addLine: (line: Omit<Line, 'id'>) => void;
  changeLine: (id: string, patch: Partial<Omit<Line, 'id' | 'from'>>) => void;
  removeLine: (id: string) => void;
  /**
   * Assign a planned session to people, keyed by the event's own id.
   *
   * Only events. A booked hotel keeps its own `who`, because who is sleeping in
   * a room is part of the booking rather than something said about it later —
   * see `bookings.change`.
   */
  assignEvent: (eventId: string, who: string[]) => void;
  /** What somebody's badge is, which decides the days they can be in the hall. */
  setBadge: (personId: string, kind: BadgeKind) => void;
  /** What somebody's badge is now, or `none` if they have not said. */
  badgeOf: (personId: string) => BadgeKind;
}

/** Unique without a random number, which would differ between two renders. */
let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter += 1).toString(36)}`;

export function useBudget(): BudgetStore {
  const [state, setState] = useState(readBudget);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ version: VERSION, ...state } satisfies Saved));
    } catch {
      // See `usePlan`.
    }
  }, [state]);

  const addPerson = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setState((now) => ({ ...now, party: [...now.party, { id: nextId('p'), name: trimmed }] }));
  }, []);

  const renamePerson = useCallback((id: string, name: string) => {
    setState((now) => ({
      ...now,
      party: now.party.map((person) => (person.id === id ? { ...person, name } : person)),
    }));
  }, []);

  /*
   * Removing somebody takes them off every line they were on.
   *
   * Leaving the id behind would strand their share: `bearersOf` would drop it
   * on the way past and the line would quietly re-split, which is the right
   * answer arrived at by accident. Doing it here means what is *saved* says
   * what is true, so the next reader of the store is not left working it out.
   */
  const removePerson = useCallback((id: string) => {
    setState((now) => ({
      ...now,
      party: now.party.filter((person) => person.id !== id),
      // Their badge goes with them. Leaving it would make the conflict check
      // speak about somebody who is not on the trip.
      badges: now.badges.filter((badge) => badge.personId !== id),
      lines: now.lines.map((line) => ({ ...line, who: line.who.filter((one) => one !== id) })),
      assigned: Object.fromEntries(
        Object.entries(now.assigned).map(([key, who]) => [key, who.filter((one) => one !== id)]),
      ),
    }));
  }, []);

  const addLine = useCallback((line: Omit<Line, 'id'>) => {
    setState((now) => ({ ...now, lines: [...now.lines, { ...line, id: nextId('c') }] }));
  }, []);

  const changeLine = useCallback((id: string, patch: Partial<Omit<Line, 'id' | 'from'>>) => {
    setState((now) => ({
      ...now,
      lines: now.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    }));
  }, []);

  const removeLine = useCallback((id: string) => {
    setState((now) => ({ ...now, lines: now.lines.filter((line) => line.id !== id) }));
  }, []);

  const assignEvent = useCallback((eventId: string, who: string[]) => {
    // Keyed by the event's own id rather than by its line's, because the line
    // is rebuilt from the plan on every render and the assignment has to
    // outlive it. `budget-lines` makes the one id from the other.
    setState((now) => ({ ...now, assigned: { ...now.assigned, [eventId]: who } }));
  }, []);

  const setBadge = useCallback((personId: string, kind: BadgeKind) => {
    setState((now) => ({
      ...now,
      badges: [...now.badges.filter((badge) => badge.personId !== personId), { personId, kind }],
    }));
  }, []);

  const badgeOf = useCallback(
    (personId: string): BadgeKind =>
      state.badges.find((badge) => badge.personId === personId)?.kind ?? 'none',
    [state.badges],
  );

  return { ...state, addPerson, renamePerson, removePerson, addLine, changeLine, removeLine, assignEvent, setBadge, badgeOf };
}
