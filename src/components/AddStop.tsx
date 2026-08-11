/**
 * When are you going to be there? — the only question a stop actually asks.
 *
 * A SESSION BRINGS ITS OWN TIMES and a taco truck does not. Gen Con publishes
 * exactly when the Saturday morning game starts and exactly how long it runs;
 * for the truck it publishes a booth number and, for the Block Party alone,
 * opening hours from last year. So a stop has no times until somebody types
 * them, and this is where they type them. Everything after that point treats
 * the two the same: the walk to a truck costs what the walk to a seminar costs,
 * and it is drawn the same way in front of the same block.
 *
 * WHY THE DEFAULT IS "AFTER WHAT YOU ALREADY HAVE". Somebody adding lunch to a
 * Saturday with a game running until one o'clock means lunch *after the game*.
 * Offering them noon makes them redo arithmetic the page has already done, so
 * the suggested start is the end of the last thing on that day, rounded up.
 *
 * WHY IT WARNS RATHER THAN REFUSES. Where hours are known they are checked
 * across the whole span, because the mistake worth catching is not a locked door
 * at nine in the morning — it is planning to eat from half past eight until half
 * past nine at a truck that shuts at nine, which a check on the start time alone
 * calls fine. But the hours in this repository are **2025's**, kept because Gen
 * Con has published no others anywhere reachable, and refusing a plan on last
 * year's numbers would be refusing a correct plan the moment they change. So it
 * says what it knows, says which year it knows it from, and lets somebody who is
 * standing on the street decide.
 */

import { useMemo, useState } from 'react';
import {
  clockMinutes,
  clockValue,
  dayName,
  stopEntry,
  suggestedStart,
  STOP_MINUTES,
  type PlanEntry,
  type Stop,
} from '../data/plan';
import { formatOpening, openThrough, type Opening } from '../data/food';

interface Props {
  stop: Stop;
  /** The four days it may be put on. */
  days: readonly string[];
  /** Which of them to start on — whatever the schedule is showing. */
  day: string;
  /** The convention's own offset, so a typed clock means the clock there. */
  offsetMinutes: number;
  /** What is already planned, for the suggested start. */
  entries: readonly PlanEntry[];
  /** Its published hours, where anything publishes any. */
  opening?: Opening | null;
  onAdd: (entry: PlanEntry) => void;
  onCancel: () => void;
}

export function AddStop({ stop, days, day, offsetMinutes, entries, opening, onAdd, onCancel }: Props) {
  const [on, setOn] = useState(days.includes(day) ? day : days[0]);
  const suggested = useMemo(() => suggestedStart(entries, on), [entries, on]);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);

  /*
   * The suggestion follows the day until somebody types over it.
   *
   * Held as null rather than seeded into state, because switching from a full
   * Saturday to an empty Sunday should move the suggestion — and it cannot if
   * the first render froze it. Once either field is typed in, both are theirs.
   */
  const fromValue = from ?? clockValue(suggested);
  const toValue = to ?? clockValue(suggested + STOP_MINUTES);
  const fromMinutes = clockMinutes(fromValue);
  const toMinutes = clockMinutes(toValue);

  const span =
    fromMinutes === null || toMinutes === null
      ? null
      : { from: fromMinutes, to: toMinutes > fromMinutes ? toMinutes : toMinutes + 1440 };

  // Not memoised: it is four comparisons against two spans, and it has to
  // follow the fields on every keystroke.
  const cover = opening && span ? openThrough(opening, on, span.from, span.to) : null;

  return (
    <form
      className="stop"
      onSubmit={(submit) => {
        submit.preventDefault();
        if (!span) return;
        onAdd(
          stopEntry(stop, {
            day: on,
            fromMinutes: span.from,
            toMinutes: span.to,
            offsetMinutes,
          }),
        );
      }}
    >
      <p className="stop__what">
        <strong>{stop.title}</strong>
        <span className="stop__where">{stop.where}</span>
      </p>

      <div className="stop__fields">
        <label className="stop__field">
          <span>Day</span>
          <select value={on} onChange={(change) => setOn(change.target.value)}>
            {days.map((one) => (
              <option key={one} value={one}>
                {dayName(one)}
              </option>
            ))}
          </select>
        </label>
        <label className="stop__field">
          <span>From</span>
          <input type="time" value={fromValue} onChange={(change) => setFrom(change.target.value)} />
        </label>
        <label className="stop__field">
          <span>To</span>
          <input type="time" value={toValue} onChange={(change) => setTo(change.target.value)} />
        </label>
      </div>

      {/*
        * What is known about whether they are open then — and never more than is
        * known. A vendor nobody publishes hours for says so, rather than saying
        * nothing and leaving "no warning" to mean two different things.
        */}
      {opening ? (
        <p className={`stop__hours stop__hours--${cover ?? 'shut'}`}>
          {cover === 'open'
            ? `Open then, by ${opening.year}’s hours.`
            : cover === 'partly'
              ? `Open for only part of that — ${formatOpening(opening)} (${opening.year} hours).`
              : `Shut then, by ${opening.year}’s hours — ${formatOpening(opening)}.`}
          {cover !== 'open' && ' Gen Con has published no hours for this year, so this may have moved.'}
        </p>
      ) : (
        <p className="stop__hours stop__hours--unknown">Nobody publishes hours for this one.</p>
      )}

      {span && span.to > 1440 && (
        <p className="stop__hours stop__hours--unknown">
          Runs past midnight, so it is drawn off the bottom of {dayName(on)}.
        </p>
      )}

      <div className="stop__actions">
        <button type="submit" className="button button--primary" disabled={!span}>
          Add to schedule
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
