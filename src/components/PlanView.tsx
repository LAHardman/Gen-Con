/**
 * The four days, and what somebody has committed to on each of them.
 *
 * WHY IT IS A TIMELINE AND NOT A LIST. A list of times can be read; it cannot
 * be *seen*. What ruins a Saturday at Gen Con is not forgetting an event, it is
 * two of them that do not fit together — a four-hour game ending at two and a
 * seminar starting at two in the JW, eleven minutes' walk away. On a list those
 * are two tidy rows. Drawn to scale, with the walk drawn in front of the event
 * it is a walk to, the gap is either there or it is not and you can see which
 * from across the room.
 *
 * SO THE TRAVEL BLOCK IS THE POINT of the page rather than a decoration on it.
 * It is lighter than the event block because it is not the commitment — it is
 * what the commitment costs — and it sits immediately before the block it
 * belongs to, occupying exactly the minutes you would have to be walking.
 * Where those minutes are already spoken for by the event before, the pair is
 * marked: that is the thing worth knowing on the Wednesday rather than at two
 * o'clock on the Saturday.
 *
 * FOUR COLUMNS, ALWAYS IN THE MARKUP. Wide enough and all four are side by
 * side, which is how somebody plans; on a phone one shows at a time and the
 * day strip switches between them. The strip is always all four, so which day
 * it is stays visible whichever day is being looked at.
 *
 * THE TIMES ARE ESTIMATES AND SAY SO. They come from `nearby` — the distance
 * table plus its extra minute — not from the router. A dozen entries redrawing
 * on every tick of the clock cannot each afford a route.
 */

import { useMemo, useState } from 'react';
import {
  dayAt,
  formatClock,
  formatTimeRange,
  offsetMinutesOf,
  type ConEvent,
} from '../data/events';
import {
  conventionDays,
  dayAxis,
  dayName,
  isConventionDay,
  entryWhere,
  planDay,
  planEntry,
  type PlanEntry,
  type PlannedItem,
} from '../data/plan';
import { searchSessions, type EventSearchIndex } from '../data/search';
import type { Plan } from '../hooks/usePlan';

interface Props {
  plan: Plan;
  /** The days the feed knows about. The four are picked out of these. */
  feedDays: readonly string[];
  events: EventSearchIndex;
  nowMs: number;
  /** Show a planned entry on the map. */
  onShowRoom: (roomId: string) => void;
}

/**
 * Pixels per minute.
 *
 * An hour is 66 px, which is enough to write a start time and a title in and
 * small enough that a fourteen-hour Saturday is one comfortable scroll rather
 * than four. A half-hour seminar still gets a block you can hit with a thumb.
 */
const PER_MINUTE = 1.1;

/** Minutes below which a block is drawn at a fixed minimum, to stay readable. */
const SHORTEST_BLOCK = 24;

/**
 * Room above the first hour line for its own label.
 *
 * The label is drawn above the line it names, so the topmost one hangs off the
 * top of the track and is clipped. Padding cannot fix it — absolutely
 * positioned children measure from the padding box — so the whole ruler is
 * pushed down by this instead.
 */
const LABEL_ROOM = 12;

const RESULT_LIMIT = 12;

export function PlanView({ plan, feedDays, events, nowMs, onShowRoom }: Props) {
  const days = useMemo(() => conventionDays(feedDays, plan.entries), [feedDays, plan.entries]);

  /*
   * Which day it is *there*. The offset comes from the data rather than from a
   * constant, and from the plan before the feed so that a plan outliving its
   * feed still highlights the right column. With neither, nothing is today —
   * which is correct: nothing has said when the convention is.
   */
  const offsetMinutes = useMemo(() => {
    for (const entry of plan.entries) {
      const offset = offsetMinutesOf(entry.start);
      if (offset !== null) return offset;
    }
    return null;
  }, [plan.entries]);
  const today = offsetMinutes === null ? null : dayAt(nowMs, offsetMinutes);

  const [chosen, setChosen] = useState<string | null>(null);
  // Today where today is one of the four, otherwise the first day. Held as
  // null until somebody picks, so opening the app on the Saturday shows the
  // Saturday without anything having to reset when the clock ticks.
  const shown = chosen ?? (today && days.includes(today) ? today : days[0]) ?? null;

  return (
    <section className="plan" aria-label="Your schedule">
      <PlanSearch plan={plan} events={events} />

      {days.length === 0 ? (
        <p className="plan__empty">
          Nothing has said when the convention is yet. Add an event, or load the schedule, and the
          four days will appear here.
        </p>
      ) : (
        <>
          <div className="plan__days" role="tablist" aria-label="Convention days">
            {days.map((day) => (
              <button
                key={day}
                type="button"
                role="tab"
                aria-selected={day === shown}
                // The chip is narrow — a quarter of a phone — so "today" lives
                // in the dot beside the name rather than in the line under it,
                // where it truncated to "to…". The name still says it.
                aria-label={`${dayName(day)}, ${countOn(plan.entries, day)}${
                  day === today ? ', today' : ''
                }`}
                className={`plan__day${day === shown ? ' plan__day--shown' : ''}${
                  day === today ? ' plan__day--today' : ''
                }`}
                onClick={() => setChosen(day)}
              >
                <span className="plan__day-name">{dayName(day)}</span>
                <span className="plan__day-count">{countOn(plan.entries, day)}</span>
              </button>
            ))}
          </div>

          <div className="plan__columns">
            {days.map((day) => (
              <DayColumn
                key={day}
                day={day}
                shown={day === shown}
                today={day === today}
                entries={plan.entries}
                nowMs={nowMs}
                offsetMinutes={offsetMinutes ?? 0}
                onRemove={plan.remove}
                onShowRoom={onShowRoom}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const countOn = (entries: readonly PlanEntry[], day: string) => {
  const on = entries.filter((entry) => entry.start.slice(0, 10) === day).length;
  return on === 0 ? 'nothing yet' : on === 1 ? '1 event' : `${on} events`;
};

/* ------------------------------------------------------------------ a day */

function DayColumn({
  day,
  shown,
  today,
  entries,
  nowMs,
  offsetMinutes,
  onRemove,
  onShowRoom,
}: {
  day: string;
  shown: boolean;
  today: boolean;
  entries: readonly PlanEntry[];
  nowMs: number;
  /** The convention's own offset, so the ruler reads as the clock on the wall. */

  offsetMinutes: number;
  onRemove: (id: string) => void;
  onShowRoom: (roomId: string) => void;
}) {
  const items = useMemo(() => planDay(entries, day), [entries, day]);
  const axis = useMemo(() => dayAxis(items, today ? nowMs : null), [items, today, nowMs]);
  const top = (atMs: number) =>
    ((atMs - (axis?.fromMs ?? 0)) / 60_000) * PER_MINUTE + LABEL_ROOM;

  return (
    <div
      className={`plan__column${shown ? ' plan__column--shown' : ''}${today ? ' plan__column--today' : ''}`}
      aria-label={dayName(day)}
    >
      <h3 className="plan__column-head">
        {dayName(day)}
        <span className="plan__column-count">{countOn(entries, day)}</span>
        {today && <span className="plan__now-tag">today</span>}
      </h3>

      {!axis ? (
        <p className="plan__empty">Nothing planned. Search above to add something.</p>
      ) : (
        <div
          className="plan__track"
          style={{ height: `${axis.minutes * PER_MINUTE + LABEL_ROOM * 2}px` }}
        >
          {axis.hours.map((at) => (
            <div key={at} className="plan__hour" style={{ top: `${top(at)}px` }}>
              <span className="plan__hour-label">{formatClock(at, offsetMinutes)}</span>
            </div>
          ))}

          {items.map((item) => (
            <Block key={item.entry.id} item={item} top={top} onRemove={onRemove} onShowRoom={onShowRoom} />
          ))}

          {/*
           * The mark for the current time. Only today's column can contain it:
           * these are absolute instants, so a Thursday ruler cannot span a
           * Saturday afternoon — and it is `dayAxis` being given `now` only for
           * today that keeps the other three from stretching to reach it.
           *
           * Drawn last so it sits over the blocks rather than under them. Its
           * whole job is to say where you are in the day, and a line hidden
           * behind a four-hour game says nothing.
           */}
          {nowMs >= axis.fromMs && nowMs <= axis.toMs && (
            <div className="plan__now" style={{ top: `${top(nowMs)}px` }} aria-hidden="true">
              <span className="plan__now-time">{formatClock(nowMs, offsetMinutes)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Block({
  item,
  top,
  onRemove,
  onShowRoom,
}: {
  item: PlannedItem;
  top: (atMs: number) => number;
  onRemove: (id: string) => void;
  onShowRoom: (roomId: string) => void;
}) {
  const { entry, startMs, endMs, travelMinutes, leaveByMs, clash } = item;
  const minutes = Math.max(SHORTEST_BLOCK, (endMs - startMs) / 60_000);
  const where = entryWhere(entry);

  return (
    <>
      {/*
        * The walk, as a band occupying the minutes you would be walking.
        *
        * It carries no text of its own. A five-minute walk is five pixels, and
        * a label in it is either clipped or drawn over the block it leads to —
        * and the one walk that most needs reading is the one too tight to fit,
        * which is exactly the shortest band on the page. So the band is the
        * picture and the block below carries the words.
        */}
      {travelMinutes !== null && leaveByMs !== null && (
        <div
          className={`plan__travel${clash ? ' plan__travel--clash' : ''}`}
          style={{ top: `${top(leaveByMs)}px`, height: `${travelMinutes * PER_MINUTE}px` }}
          aria-hidden="true"
        />
      )}

      <article
        className={`plan__block${clash ? ' plan__block--clash' : ''}`}
        style={{ top: `${top(startMs)}px`, height: `${minutes * PER_MINUTE}px` }}
        // The colour carries the alarm and the line beside the time carries the
        // number; a column can be a quarter of a phone wide, so the sentence
        // that explains it lives here rather than being truncated on screen.
        title={
          clash
            ? `The event before this one is still running when you would have to leave for it — a ${travelMinutes} minute walk.`
            : undefined
        }
      >
        <span className="plan__block-time">
          {formatTimeRange(entry as ConEvent & PlanEntry)}
          {travelMinutes !== null && (
            <span className={`plan__block-walk${clash ? ' plan__block-walk--clash' : ''}`}>
              {clash ? ` · ${travelMinutes} min walk · tight` : ` · ${travelMinutes} min walk`}
            </span>
          )}
        </span>
        <span className="plan__block-title">{entry.title}</span>
        <span className="plan__block-where">{where}</span>
        <span className="plan__block-actions">
          {entry.roomId && (
            <button type="button" className="plan__link" onClick={() => onShowRoom(entry.roomId!)}>
              Map
            </button>
          )}
          <button
            type="button"
            className="plan__link"
            onClick={() => onRemove(entry.id)}
            aria-label={`Remove ${entry.title} from your schedule`}
          >
            Remove
          </button>
        </span>
      </article>
    </>
  );
}

/* --------------------------------------------------------------- adding */

function PlanSearch({ plan, events }: { plan: Plan; events: EventSearchIndex }) {
  const [query, setQuery] = useState('');
  /*
   * Only the four days can be offered.
   *
   * Wednesday's Trade Day is in the feed and matches these searches, and there
   * is no Wednesday column for it to land in — so adding one would put an event
   * into a plan that nothing could then show. Filtered here rather than
   * silently dropped later, because a session you cannot add is a session that
   * should not be in the list.
   */
  const hits = useMemo(
    () =>
      searchSessions(query, events, RESULT_LIMIT * 3).filter((hit) =>
        isConventionDay(hit.event.start.slice(0, 10)),
      ).slice(0, RESULT_LIMIT),
    [query, events],
  );
  const asked = query.trim().length >= 2;

  return (
    <div className="plan__add">
      <input
        type="search"
        className="search__input"
        placeholder="Search events to add"
        aria-label="Search events to add to your schedule"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {asked && (
        <ul className="plan__hits" aria-label="Matching sessions">
          {hits.length === 0 && <li className="search__empty">Nothing matches “{query.trim()}”</li>}
          {hits.map(({ event, room, pin }) => {
            const held = plan.planned(event.id);
            return (
              <li key={event.id}>
                <button
                  type="button"
                  className={`plan__hit${held ? ' plan__hit--held' : ''}`}
                  aria-pressed={held}
                  onClick={() => plan.toggle(planEntry(event, room, pin))}
                >
                  <span className="search__hit-main">{event.title}</span>
                  <span className="search__hit-sub">
                    {`${dayName(event.start.slice(0, 10))} ${formatTimeRange(event)} · ${
                      room?.shortName ?? room?.name ?? pin?.name ?? event.locationText
                    }`}
                  </span>
                  <span className="plan__hit-mark" aria-hidden="true">
                    {held ? '✓' : '+'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
