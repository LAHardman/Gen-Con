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
  formatTime,
  formatTimeRange,
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
  SHORTEST_BLOCK,
  type DayAxis,
  type PlanEntry,
  type PlannedItem,
  type Stop,
} from '../data/plan';
import {
  hitLabel,
  search,
  searchSessions,
  type EventSearchIndex,
  type SearchHit,
  type SessionHit,
} from '../data/search';
import { biteOpening, type Opening } from '../data/food';
import { AddStop } from './AddStop';
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
  /**
   * The convention's own offset — see `conventionOffset`. Null when nothing has
   * said what it is, and then nothing here is today and no stop can be timed.
   */
  offsetMinutes: number | null;
  nowMs: number;
  /** Open a session in full, which is where adding actually happens. */
  onOpenEvent: (hit: SessionHit) => void;
  /** Open something already on the schedule — where removing it happens. */
  onOpenEntry: (entry: PlanEntry) => void;
}

/**
 * Pixels per minute.
 *
 * An hour is 66 px, which is enough to write a start time and a title in and
 * small enough that a fourteen-hour Saturday is one comfortable scroll rather
 * than four. A half-hour seminar still gets a block you can hit with a thumb.
 */
const PER_MINUTE = 1.1;

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

export function PlanView({
  plan,
  feedDays,
  events,
  choices,
  offsetMinutes,
  nowMs,
  onOpenEvent,
  onOpenEntry,
}: Props) {
  const days = useMemo(() => conventionDays(feedDays, plan.entries), [feedDays, plan.entries]);

  /*
   * Which day it is *there*, at the offset the data carries rather than a
   * constant. With nothing to take one from, nothing is today — which is
   * correct: nothing has said when the convention is.
   */
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
        day={shown}
        offsetMinutes={offsetMinutes}
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
                      onOpen={onOpenEntry}
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

/**
 * How much is on a day.
 *
 * "Planned" rather than "events", because a day can hold a seminar, a food
 * truck and twenty minutes at a stand, and calling those three events would be
 * calling two of them something they are not.
 */
const countOn = (entries: readonly PlanEntry[], day: string) => {
  const on = entries.filter((entry) => entry.start.slice(0, 10) === day).length;
  return on === 0 ? 'nothing yet' : `${on} planned`;
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
  onOpen,
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
  onOpen: (entry: PlanEntry) => void;
}) {
  const top = (atMs: number) => atMinute(axis, minutesInto(atMs, day, offsetMinutes));

  return (
    <div
      className={`plan__column${shown ? ' plan__column--shown' : ''}${today ? ' plan__column--today' : ''}`}
      aria-label={dayName(day)}
    >
      {items.length === 0 && <p className="plan__empty plan__empty--column">Nothing planned</p>}

      {items.map((item) => (
        <Block key={item.entry.id} item={item} top={top} onOpen={onOpen} />
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
  onOpen,
}: {
  item: PlannedItem;
  top: (atMs: number) => number;
  onOpen: (entry: PlanEntry) => void;
}) {
  const { entry, startMs, endMs, travelMinutes, leaveByMs, clash, lane, lanes } = item;
  const minutes = Math.max(SHORTEST_BLOCK, (endMs - startMs) / 60_000);
  const where = entryWhere(entry);

  /*
   * Twenty minutes is twenty-six pixels, and three stacked lines are sixty.
   *
   * Stacked in a box that short the flex items shrink to nothing, so a short
   * block is laid out as one line instead: the time, the name and the walk,
   * which are the three things it exists to say. The place goes, into the
   * tooltip and the panel — it is the one thing already visible on the map.
   */
  const short = minutes * PER_MINUTE < 62;

  /*
   * A walk of no minutes is not a walk.
   *
   * Two stops at the same food truck, or two sessions in one hall, measure zero
   * — and "0 min" beside a band of no height says nothing except that something
   * was calculated. The clash colour still applies where it applies: that one is
   * about the times overlapping, not about the distance.
   */
  const walk = travelMinutes !== null && travelMinutes > 0 ? travelMinutes : null;

  // Side by side where two things overlap — see `inLanes`. A percentage of the
  // column rather than a fraction of a fixed width, because a column is a
  // quarter of a phone on one layout and a third of a desktop on another.
  const across = {
    left: `${(lane / lanes) * 100}%`,
    width: `${100 / lanes}%`,
  };

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
      {walk !== null && leaveByMs !== null && (
        <div
          className={`plan__travel${clash ? ' plan__travel--clash' : ''}`}
          style={{
            top: `${top(leaveByMs)}px`,
            height: `${walk * PER_MINUTE}px`,
            ...across,
          }}
          aria-hidden="true"
        />
      )}

      {/*
        * The block is the button.
        *
        * It used to carry a "Map" and a "Remove" of its own, and on a stop —
        * twenty-six pixels tall in a column a quarter of a phone wide — those
        * two links were the only thing that fitted, so the block said "Map
        * Remove" and not what it was. Now the whole block opens what it is, and
        * both actions live in the panel that opens. Removing something from a
        * schedule is not an action to be one mis-tap away from either.
        */}
      <button
        type="button"
        className={`plan__block${clash ? ' plan__block--clash' : ''}${short ? ' plan__block--short' : ''}`}
        style={{ top: `${top(startMs)}px`, height: `${minutes * PER_MINUTE}px`, ...across }}
        onClick={() => onOpen(entry)}
        // The colour carries the alarm and the line beside the time carries the
        // number; a column can be a quarter of a phone wide, so the sentence
        // that explains it lives here rather than being truncated on screen —
        // along with the place, which a short block has no room to print.
        title={
          [
            short ? `${entry.title} · ${where}` : null,
            clash
              ? `The event before this one is still running when you would have to leave for it — a ${travelMinutes} minute walk.`
              : null,
          ]
            .filter(Boolean)
            .join(' — ') || undefined
        }
      >
        {/*
          * On a short block the range becomes a start and the walk moves out of
          * the time into its own place at the end. Both for the same reason:
          * one line has room for the name or for "1:00 PM – 1:25 PM · 14 min
          * walk", and the name is what the block is for.
          */}
        <span className="plan__block-time">
          {short ? formatTime(entry.start) : formatTimeRange(entry as ConEvent & PlanEntry)}
          {walk !== null && !short && (
            <span className={`plan__block-walk${clash ? ' plan__block-walk--clash' : ''}`}>
              {clash ? ` · ${walk} min walk · tight` : ` · ${walk} min walk`}
            </span>
          )}
        </span>
        <span className="plan__block-title">{entry.title}</span>
        {short && walk !== null && (
          // No "tight" here: the colour says it, the band above says it, and
          // the word costs four characters the name needs more.
          <span className={`plan__block-walk${clash ? ' plan__block-walk--clash' : ''}`}>
            {`${walk} min`}
          </span>
        )}
        {!short && <span className="plan__block-where">{where}</span>}
      </button>
    </>
  );
}

/* --------------------------------------------------------------- adding */

/**
 * A search hit as something to be somewhere at.
 *
 * The key is the *thing* rather than the entry: a stand keeps Gen Con's own id
 * where it has one and its name where it does not, and a room keeps its room id.
 * `stopEntry` is what puts the time on the end of it, so that the same truck at
 * nine in the morning and at seven in the evening are two entries and not one
 * overwriting the other.
 *
 * The room is the hall, exactly as it is for a session: nobody walks to a booth,
 * they walk to the hall and then look for the aisle — which is also why the walk
 * to a stand costs what the walk to a session in the same hall costs.
 */
function stopFor(hit: SearchHit, title: string, where: string): Stop {
  const key = hit.exhibitor
    ? `vendor:${hit.exhibitor.id ?? `${hit.exhibitor.name}:${hit.exhibitor.spot}`}`
    : hit.eatery
      ? `eat:${hit.eatery.id}`
      : hit.room
        ? `place:${hit.room.id}`
        : `pin:${hit.pin!.id}`;
  return {
    key,
    title,
    where,
    roomId: hit.room?.id,
    at: hit.pin ? { lat: hit.pin.lat, lng: hit.pin.lng } : undefined,
  };
}

function PlanSearch({
  plan,
  events,
  choices,
  feedDays,
  day,
  offsetMinutes,
  onOpenEvent,
}: {
  plan: Plan;
  events: EventSearchIndex;
  choices: FilterChoices;
  feedDays: readonly string[];
  /** The day the schedule is showing, which a new stop lands on by default. */
  day: string | null;
  /** The convention's own offset. Null when nothing has said what it is. */
  offsetMinutes: number | null;
  onOpenEvent: (hit: SessionHit) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<EventFilter>({});
  const [sort, setSort] = useState<SortKey | undefined>(undefined);
  /** The thing whose times are being chosen, once one has been picked. */
  const [placing, setPlacing] = useState<{ stop: Stop; opening: Opening | null } | null>(null);
  const kind = filter.kind ?? 'all';
  const days = useMemo(() => conventionDays(feedDays, plan.entries), [feedDays, plan.entries]);

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

  /*
   * The things that are not sessions, when those are what is being asked for.
   *
   * A different search, because they are a different question: `searchSessions`
   * answers with showings and these have none. Only run when a kind that can
   * produce one is chosen, so the ordinary case pays nothing for it.
   */
  const stops = useMemo(
    () =>
      kind === 'food' || kind === 'vendor' || kind === 'place'
        ? search(query, events, RESULT_LIMIT, filter, sort).filter((hit) => hit.room || hit.pin)
        : [],
    [kind, query, events, filter, sort],
  );
  // A filter alone is a question — "everything free on Saturday afternoon" has
  // no word in it, and neither has "food" — so the list opens on either.
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
        * The kind row is here too, but it can only offer what a day can hold.
        *
        * A session brings its own times; a truck, a stand and a hall do not, so
        * those three are added through the little form below instead. Where
        * nothing has said what the convention's offset is there is no day to put
        * one on and no clock to read a typed time against, so only sessions —
        * which carry their own timestamps — can be added at all.
        */}
      <EventFilters
        filter={filter}
        sort={sort}
        kinds={offsetMinutes !== null && days.length > 0}
        days={feedDays.filter(isConventionDay)}
        choices={choices}
        events={events}
        query={query}
        onChange={(next) => {
          setFilter(next);
          setPlacing(null);
        }}
        onSort={setSort}
      />

      {placing && offsetMinutes !== null && days.length > 0 && (
        <AddStop
          stop={placing.stop}
          opening={placing.opening}
          days={days}
          day={day && days.includes(day) ? day : days[0]}
          offsetMinutes={offsetMinutes}
          entries={plan.entries}
          onAdd={(entry) => {
            plan.add(entry);
            setPlacing(null);
          }}
          onCancel={() => setPlacing(null)}
        />
      )}

      {asked && stops.length > 0 && (
        <ul className="plan__hits" aria-label="Places to add">
          {stops.map((hit) => {
            const { title, detail } = hitLabel(hit);
            return (
              <li key={hit.key}>
                <button
                  type="button"
                  className="plan__hit"
                  onClick={() =>
                    setPlacing({
                      stop: stopFor(hit, title, detail),
                      // A truck's hours are Gen Con's, a restaurant's are
                      // OpenStreetMap's, and both come back as one `Opening`.
                      opening: hit.exhibitor
                        ? biteOpening({ truck: hit.exhibitor })
                        : hit.eatery
                          ? biteOpening({ eatery: hit.eatery })
                          : null,
                    })
                  }
                >
                  <span className="search__hit-main">{title}</span>
                  <span className="search__hit-sub">{detail}</span>
                  <span className="plan__hit-mark" aria-hidden="true">
                    ＋
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        * Sessions, unless something else was asked for. `searchSessions` has no
        * idea what a kind is — it answers with showings and only showings — so
        * the question of whether showings were wanted is asked here.
        */}
      {asked && (kind === 'all' || kind === 'event') && (
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
