/**
 * The plan, kept on the device.
 *
 * There is no account and no server, and there should not be: this is a static
 * site that has to keep working when the host that served it is gone, so a
 * schedule that lived anywhere else would be a schedule that stopped existing.
 * `localStorage` is the only store that survives a phone being locked, a tab
 * being closed and the network disappearing, which between them is most of a
 * convention.
 *
 * IT WRITES A VERSION AND READS DEFENSIVELY. What comes back is whatever was
 * left there — by an older release, by a different app on the same origin, by
 * a half-finished write. Everything here treats it as untrusted input, because
 * the alternative is a plan that throws on load and takes the whole page with
 * it, in the one situation where somebody cannot reinstall anything.
 *
 * NOTHING IT DOES CAN THROW. Safari in private browsing has a `localStorage`
 * that is present and refuses to be written to, and losing the ability to plan
 * is a great deal better than losing the ability to open the map.
 */

import { useCallback, useEffect, useState } from 'react';
import type { PlanEntry } from '../data/plan';

const KEY = 'genCon.plan';

/**
 * Bumped when the saved shape changes in a way an old plan cannot survive.
 *
 * Anything with a different version is dropped rather than guessed at — a plan
 * is a dozen entries somebody can rebuild in a minute, and a wrong reading of
 * one is a Saturday that quietly says the wrong room.
 */
const VERSION = 1;

interface Saved {
  version: number;
  entries: PlanEntry[];
}

/** Is this really an entry, or is it whatever else was under that key? */
function usable(value: unknown): value is PlanEntry {
  const entry = value as Partial<PlanEntry> | null;
  return (
    !!entry &&
    typeof entry.id === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.start === 'string' &&
    !Number.isNaN(Date.parse(entry.start)) &&
    typeof entry.where === 'string'
  );
}

export function readPlan(): PlanEntry[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw) as Partial<Saved>;
    if (saved?.version !== VERSION || !Array.isArray(saved.entries)) return [];
    return saved.entries.filter(usable);
  } catch {
    return [];
  }
}

export interface Plan {
  entries: PlanEntry[];
  planned: (eventId: string) => boolean;
  add: (entry: PlanEntry) => void;
  remove: (eventId: string) => void;
  toggle: (entry: PlanEntry) => void;
  /** Write a fetched description onto an entry, so it survives going offline. */
  describe: (eventId: string, description: string) => void;
}

export function usePlan(): Plan {
  const [entries, setEntries] = useState<PlanEntry[]>(readPlan);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ version: VERSION, entries } satisfies Saved));
    } catch {
      // Out of quota, or a private window that has storage and refuses it.
      // The plan still works for this session; it just will not outlive it.
    }
  }, [entries]);

  const add = useCallback((entry: PlanEntry) => {
    // Replacing rather than skipping, so adding an event whose room or time has
    // changed since it was planned takes the newer copy — but keeping any
    // description already fetched, which the newer copy will not carry and
    // which costs a request to get back.
    setEntries((current) => [
      ...current.filter((held) => held.id !== entry.id),
      { ...entry, description: entry.description ?? current.find((held) => held.id === entry.id)?.description },
    ]);
  }, []);

  const remove = useCallback((eventId: string) => {
    setEntries((current) => current.filter((held) => held.id !== eventId));
  }, []);

  const toggle = useCallback(
    (entry: PlanEntry) =>
      setEntries((current) =>
        current.some((held) => held.id === entry.id)
          ? current.filter((held) => held.id !== entry.id)
          : [...current, entry],
      ),
    [],
  );

  const describe = useCallback((eventId: string, description: string) => {
    setEntries((current) => {
      const held = current.find((one) => one.id === eventId);
      // Nothing to write onto, or the same words already there. Returning the
      // array unchanged matters: this runs from a fetch, and a new array every
      // time would rewrite storage and restart whatever depends on the entries.
      if (!held || held.description === description) return current;
      return current.map((one) => (one.id === eventId ? { ...one, description } : one));
    });
  }, []);

  const planned = useCallback(
    (eventId: string) => entries.some((held) => held.id === eventId),
    [entries],
  );

  return { entries, planned, add, remove, toggle, describe };
}
