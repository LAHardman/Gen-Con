/**
 * The four days, and what somebody has committed to on each of them.
 *
 * WHY IT IS A TIMELINE AND NOT A LIST. A list of times can be read; it cannot
 * be *seen*. What ruins a Saturday at Gen Con is not forgetting an event, it is
 * two of them that do not fit together — a four-hour game ending at one and a
 * seminar starting at one in the JW, six minutes' walk away. On a list those
 * are two tidy rows. Drawn to scale, with the walk drawn in front of the event
 * it is a walk to, the gap is either there or it is not and you can see which
 * from across the room.
 *
 * SO THE TRAVEL BAND IS THE POINT of the page rather than a decoration on it.
 * It is lighter than the event block because it is not the commitment — it is
 * what the commitment costs — and it occupies exactly the minutes you would be
 * walking, immediately before the block it leads to. Where those minutes are
 * already spoken for by the event before, both turn amber.
 *
 * ONE RULER FOR ALL FOUR DAYS. Every column is measured in minutes past
 * midnight against a single axis, so ten o'clock on the Thursday is the same
 * height as ten o'clock on the Saturday. Four separate rulers is what this was,
 * and it made the columns incomparable — which defeats the one thing a four-day
 * view is for: seeing that every morning is committed and every evening is not.
 *
 * THE TIMES ARE ESTIMATES. They come from `nearby` — the distance table plus
 * its extra minute — not from the router. A dozen entries redrawing on every
 * tick of the clock cannot each afford a route.
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
  dayName,
  entryWhere,
  isConventionDay,
  minutesInto,
  planDay,
  sharedAxis,
  type DayAxis,
  type PlanEntry,
  type PlannedItem,
} from '../data/plan';
import { searchSessions, type EventSearchIndex, type SessionHit } from '../data/search';
import {
  isAsking,
  formatCost,
  formatLength,
  lengthMinutes,
  type EventFilter,
  type FilterChoices,
  type SortKey,
} from '../data/filters';
import { EventFilters } from './EventFilters';
import type { Plan } from '../hooks/usePlan';

interface Props {
  plan: Plan;
  /** The days the feed knows about. The four are picked out of these. */
  feedDays: readonly string[];
  events: EventSearchIndex;
  choices: FilterChoices;
  nowMs: number;
  /** Show a planned entry on the map. */
  onShowRoom: (roomId: string) => void;
  /** Open a session in full, which is where adding actually happens. */
  onOpenEvent: (hit: SessionHit) => void;
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
 * top of the sheet and is clipped. Padding cannot fix it — absolutely
 * positioned children measure from the padding box — so the whole ruler is
 * pushed down by this instead.
 */
const LABEL_ROOM = 12;

const RESULT_LIMIT = 20;

export function PlanView({ plan, feedDays, events, choices, nowMs, onShowRoom, onOpenEvent }: Props) {
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

  const byDay = useMemo(() => days.map((day) => planDay(plan.entries, day)), [days, plan.entries]);
  const nowMinutes =
    today && days.includes(today) && offsetMinutes !== null
      ? minutesInto(nowMs, today, offsetMinutes)
      : null;
  const axis = useMemo(() => sharedAxis(byDay, nowMinutes), [byDay, nowMinutes]);

  return (
    <section className="plan" aria-label="Your schedule">
      <PlanSearch
        plan={plan}
        events={events}
        choices={choices}
        feedDays={feedDays}
        onOpenEvent={onOpenEvent}
      />

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

          {/* Headings for the wide layout, where all four columns are on screen
              at once and the day strip above is hidden. */}
          <div className="plan__heads" aria-hidden="true">
            {days.map((day) => (
              <h3
                key={day}
                className={`plan__head${day === today ? ' plan__head--today' : ''}`}
              >
                {dayName(day)}
                <span className="plan__head-count">{countOn(plan.entries, day)}</span>
                {day === today && <span className="plan__now-tag">today</span>}
              </h3>
            ))}
          </div>

          {!axis ? (
            <p className="plan__empty">Nothing planned yet. Search above to add something.</p>
          ) : (
            <div className="plan__grid">
              <div
                className="plan__sheet"
                style={{ height: `${axis.minutes * PER_MINUTE + LABEL_ROOM * 2}px` }}
              >
                {/* One ruler, behind all four columns. That is the shared axis. */}
                <div className="plan__hours" aria-hidden="true">
                  {axis.hours.map((at) => (
                    <div key={at} className="plan__hour" style={{ top: `${atMinute(axis, at)}px` }}>
                      <span className="plan__hour-label">{clockAt(at)}</span>
                    </div>
                  ))}
                </div>

                <div className="plan__columns">
                  {days.map((day, index) => (
                    <DayColumn
                      key={day}
                      day={day}
                      shown={day === shown}
                      today={day === today}
                      items={byDay[index]}
                      axis={axis}
                      offsetMinutes={offsetMinutes ?? 0}
                      nowMinutes={day === today ? nowMinutes : null}
                      onRemove={plan.remove}
                      onShowRoom={onShowRoom}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Where a minute past midnight sits on the sheet. */
const atMinute = (axis: DayAxis, minute: number) =>
  (minute - axis.fromMinutes) * PER_MINUTE + LABEL_ROOM;

/**
 * A minute past midnight, written as a clock time.
 *
 * The ruler is a clock rather than a date, so this formats an offset from the
 * epoch at offset zero: "10:00 AM" then means the tenth hour and nothing else.
 * Minutes past 1,440 wrap round, which is what a clock does — a game running to
 * two in the morning is drawn continuing off the bottom of the day it started.
 */
const clockAt = (minute: number) => formatClock((minute % (24 * 60)) * 60_000, 0);

const countOn = (entries: readonly PlanEntry[], day: string) => {
  const on = entries.filter((entry) => entry.start.slice(0, 10) === day).length;
  return on === 0 ? 'nothing yet' : on === 1 ? '1 event' : `${on} events`;
};

/* ------------------------------------------------------------------ a day */

function DayColumn({
  day,
  shown,
  today,
  items,
  axis,
  offsetMinutes,
  nowMinutes,
  onRemove,
  onShowRoom,
}: {
  day: string;
  shown: boolean;
  today: boolean;
  items: readonly PlannedItem[];
  axis: DayAxis;
  /** The convention's own offset, so a day's midnight is its own midnight. */
  offsetMinutes: number;
  /** Where now sits on the shared ruler, or null on any day that is not today. */
  nowMinutes: number | null;
  onRemove: (id: string) => void;
  onShowRoom: (roomId: string) => void;
}) {
  const top = (atMs: number) => atMinute(axis, minutesInto(atMs, day, offsetMinutes));

  return (
    <div
      className={`plan__column${shown ? ' plan__column--shown' : ''}${today ? ' plan__column--today' : ''}`}
      aria-label={dayName(day)}
    >
      {items.length === 0 && <p className="plan__empty plan__empty--column">Nothing planned</p>}

      {items.map((item) => (
        <Block key={item.entry.id} item={item} top={top} onRemove={onRemove} onShowRoom={onShowRoom} />
      ))}

      {/*
       * The mark for the current time, on today's column and nowhere else. The
       * ruler is shared, so every column would put it at the same height — and
       * a line across Thursday saying "now" would say something false.
       *
       * Drawn last so it sits over the blocks rather than under them: its whole
       * job is to say where you are in the day, and a line hidden behind a
       * four-hour game says nothing.
       */}
      {nowMinutes !== null && nowMinutes >= axis.fromMinutes && nowMinutes <= axis.toMinutes && (
        <div className="plan__now" style={{ top: `${atMinute(axis, nowMinutes)}px` }}>
          <span className="plan__now-time">{clockAt(nowMinutes)}</span>
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

function PlanSearch({
  plan,
  events,
  choices,
  feedDays,
  onOpenEvent,
}: {
  plan: Plan;
  events: EventSearchIndex;
  choices: FilterChoices;
  feedDays: readonly string[];
  onOpenEvent: (hit: SessionHit) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<EventFilter>({});
  const [sort, setSort] = useState<SortKey | undefined>(undefined);

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
      searchSessions(query, events, RESULT_LIMIT * 3, filter, sort)
        .filter((hit) => isConventionDay(hit.event.start.slice(0, 10)))
        .slice(0, RESULT_LIMIT),
    [query, events, filter, sort],
  );
  // A filter alone is a question — "everything free on Saturday afternoon" has
  // no word in it — so the list opens on either.
  const asked = query.trim().length >= 2 || isAsking(filter);

  return (
    <div className="plan__add">
      <input
        type="search"
        className="search__input"
        placeholder="Search events to add"
        aria-label="Search events to add to your schedule"
        autoComplete="off"
        value={query}
        onChange={(change) => setQuery(change.target.value)}
      />

      {/*
        * No kind row here, unlike the map's search.
        *
        * A schedule holds sessions: they start, they end, and the walk between
        * two of them is the whole point of the column. A taco truck has none of
        * that, so offering "Food" above a box that can only add events would be
        * offering something the schedule cannot then hold. The map's search is
        * where you find lunch; this one is where you decide your Saturday.
        */}
      <EventFilters
        filter={filter}
        sort={sort}
        kinds={false}
        days={feedDays.filter(isConventionDay)}
        choices={choices}
        events={events}
        query={query}
        onChange={setFilter}
        onSort={setSort}
      />

      {asked && (
        <ul className="plan__hits" aria-label="Matching sessions">
          {hits.length === 0 && <li className="search__empty">Nothing matches</li>}
          {hits.map((hit) => {
            const held = plan.planned(hit.event.id);
            return (
              <li key={hit.event.id}>
                <button
                  type="button"
                  className={`plan__hit${held ? ' plan__hit--held' : ''}`}
                  aria-pressed={held}
                  onClick={() => onOpenEvent(hit)}
                >
                  <span className="search__hit-main">{hit.event.title}</span>
                  <span className="search__hit-sub">
                    {[
                      `${dayName(hit.event.start.slice(0, 10))} ${formatTimeRange(hit.event)}`,
                      formatLength(lengthMinutes(hit.event)),
                      formatCost(hit.event.cost),
                      hit.room?.shortName ?? hit.room?.name ?? hit.pin?.name ?? hit.event.locationText,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="plan__hit-mark" aria-hidden="true">
                    {held ? '✓' : '›'}
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
