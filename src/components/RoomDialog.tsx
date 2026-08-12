import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORY_STYLES,
  NOT_A_BUILDING,
  PLANNED_LAYOUT,
  TRACED_FOOTPRINT,
  VENUES_BY_ID,
  type Room,
} from '../data/venues';
import {
  dayKey,
  eventUrl,
  formatDayLabel,
  formatTimeRange,
  isHappeningAt,
  type ConEvent,
} from '../data/events';
import { STANDS_IN } from '../data/booth-place';
import { planEntry } from '../data/plan';
import type { Plan } from '../hooks/usePlan';
import type { FeedStatus } from '../hooks/useEventFeed';
import { useLocationCheck } from '../hooks/useLocationCheck';

interface Props {
  room: Room;
  events: ConEvent[];
  feedStatus: FeedStatus;
  sourceUrl: string;
  /** "Now" as a timestamp, so the caller controls the clock. */
  nowMs: number;
  onClose: () => void;
  onZoomToRoom: (room: Room) => void;
  /** Start directions with this room as the destination. */
  onNavigateToRoom: (room: Room) => void;
  /**
   * Somebody's schedule, so a session can be added from where it is read.
   *
   * This is the list of individual showings — which is the thing a schedule is
   * made of, and the thing the header's search deliberately collapses. Adding
   * from anywhere else means picking a session out of a group first.
   */
  plan: Plan;
}

export function RoomDialog({
  room,
  events,
  feedStatus,
  sourceUrl,
  nowMs,
  onClose,
  onZoomToRoom,
  onNavigateToRoom,
  plan,
}: Props) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const style = CATEGORY_STYLES[room.category];
  const venue = VENUES_BY_ID[room.venueId];

  const days = useMemo(() => {
    const set = new Set(events.map((event) => dayKey(event.start)));
    return [...set].sort();
  }, [events]);

  // Open on the day that's actually happening, falling back to the first day of
  // the convention when it isn't on right now.
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const [day, setDay] = useState<string | null>(null);
  const activeDay = day ?? (days.includes(today) ? today : days[0]) ?? null;

  useEffect(() => setDay(null), [room.id]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, [room.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const dayEvents = useMemo(
    () =>
      events
        .filter((event) => dayKey(event.start) === activeDay)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    [events, activeDay],
  );

  const liveCount = dayEvents.filter((event) => isHappeningAt(event, nowMs)).length;

  // Opening a room re-reads the source for the events still to come in it, so a
  // room change made since the schedule was imported shows up here rather than
  // waiting for the next full pull.
  const check = useLocationCheck(room.id, events, nowMs);
  const movedIds = new Set(check.moved.map((entry) => entry.event.id));

  return (
    <div className="dialog__backdrop" onPointerDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <span className="dialog__tag" style={{ background: style.fill }}>
            {style.label}
          </span>
          <div className="dialog__header-actions">
            {/* The one action here rather than in the row at the bottom: it
                takes over the whole map, so it belongs next to the close
                button as the other way out of this dialog. */}
            <button
              type="button"
              className="dialog__icon"
              onClick={() => onNavigateToRoom(room)}
              aria-label={`Directions to ${room.name}`}
              title="Directions to this room"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M21.4 2.6 2.9 9.7a.8.8 0 0 0 .06 1.5l7.3 2.5 2.5 7.3a.8.8 0 0 0 1.5.06l7.1-18.5a.8.8 0 0 0-1-1Z" />
              </svg>
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              className="dialog__close"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <h2 className="dialog__title" id="room-dialog-title">
          {room.name}
        </h2>
        <p className="dialog__location">
          {venue?.name} · {room.level}
        </p>

        <p className="dialog__description">{room.description}</p>

        {/*
          What is on the floor, said out loud for an exhibit hall.

          An exhibit hall drawn with nothing in it reads as a page that failed
          to load rather than as a hall that has demo tables in it instead of
          booths — and five of the eleven are exactly that. Gen Con's own
          exhibit-hall map covers Halls F to K; A to E hold publisher demo
          areas, which the schedule names but the map does not draw.
        */}
        {room.category === 'exhibit' && (
          <p className="dialog__stands">
            {STANDS_IN[room.id]
              ? `${STANDS_IN[room.id]} exhibitor stands, drawn on the map from Gen Con’s own exhibit-hall plan.`
              : 'No exhibitor stands in this hall — Gen Con’s exhibit-hall map puts them all in Halls F to K. What is scheduled here is below.'}
          </p>
        )}

        <ul className="dialog__highlights">
          {room.highlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>

        <section className="schedule">
          <div className="schedule__head">
            <h3>What's on here</h3>
            {liveCount > 0 && <span className="schedule__live">{liveCount} on now</span>}
          </div>

          {check.status !== 'idle' && (
            <p className={`schedule__check schedule__check--${check.status}`}>
              {check.status === 'checking' && 'Checking the source that these are still here…'}
              {check.status === 'confirmed' &&
                `Still here: the next ${check.checked} ${
                  check.checked === 1 ? 'event is' : 'events are'
                } listed in this room on the source right now.`}
              {check.status === 'unavailable' &&
                'Could not reach the source to confirm these are still here, so they are as imported. Room changes are not published in the source’s change log, so check the Gen Con program if it matters.'}
              {check.status === 'moved' && (
                <>
                  <strong>
                    {check.moved.length} of the next {check.checked} {check.checked === 1 ? 'event has' : 'events have'} moved
                  </strong>{' '}
                  since the schedule was imported. The source now lists:
                  <span className="schedule__moved">
                    {check.moved.map(({ event, locationText, roomText }) => (
                      <span key={event.id}>
                        {event.title} → {[locationText, roomText].filter(Boolean).join(' · ') || 'no location'}
                      </span>
                    ))}
                  </span>
                </>
              )}
            </p>
          )}

          {feedStatus !== 'ready' ? (
            <p className="schedule__empty">
              {feedStatus === 'loading'
                ? 'Loading the event schedule…'
                : feedStatus === 'absent'
                  ? 'No event data loaded yet. Run npm run fetch:events to pull the schedule.'
                  : 'Could not load the event schedule.'}
            </p>
          ) : events.length === 0 ? (
            <p className="schedule__empty">
              No events in the schedule list this room. It may be a service area, or the source may
              name it differently.
            </p>
          ) : (
            <>
              {days.length > 1 && (
                <div className="schedule__days" role="tablist">
                  {days.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={value === activeDay}
                      className={`schedule__day${value === activeDay ? ' schedule__day--active' : ''}`}
                      onClick={() => setDay(value)}
                    >
                      {formatDayLabel(value)}
                    </button>
                  ))}
                </div>
              )}

              <ol className="schedule__list">
                {dayEvents.map((event) => {
                  const live = isHappeningAt(event, nowMs);
                  const done = !live && Date.parse(event.start) < nowMs;
                  return (
                    <li
                      key={event.id}
                      className={`schedule__item${live ? ' schedule__item--live' : ''}${
                        done ? ' schedule__item--past' : ''
                      }${movedIds.has(event.id) ? ' schedule__item--moved' : ''}`}
                    >
                      <span className="schedule__time">{formatTimeRange(event)}</span>
                      <span className="schedule__body">
                        {eventUrl(event) ? (
                          <a href={eventUrl(event)} target="_blank" rel="noreferrer noopener">
                            {event.title}
                          </a>
                        ) : (
                          event.title
                        )}
                        <span className="schedule__meta">
                          {[
                            event.type,
                            event.tableText && `Table ${event.tableText}`,
                            typeof event.ticketsAvailable === 'number' &&
                              `${event.ticketsAvailable} tickets`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      {movedIds.has(event.id) ? (
                        <span className="schedule__badge schedule__badge--moved">Moved</span>
                      ) : (
                        live && <span className="schedule__badge">Now</span>
                      )}
                      <button
                        type="button"
                        className={`schedule__add${plan.planned(event.id) ? ' schedule__add--held' : ''}`}
                        aria-pressed={plan.planned(event.id)}
                        aria-label={`${plan.planned(event.id) ? 'Remove' : 'Add'} ${event.title} ${
                          plan.planned(event.id) ? 'from' : 'to'
                        } your schedule`}
                        title={plan.planned(event.id) ? 'On your schedule' : 'Add to your schedule'}
                        onClick={() => plan.toggle(planEntry(event, room))}
                      >
                        {plan.planned(event.id) ? '✓' : '+'}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          )}

          <a className="schedule__source" href={sourceUrl} target="_blank" rel="noreferrer noopener">
            Browse all events on the Gen Con event database ↗
          </a>
        </section>

        <div className="dialog__actions">
          <button type="button" className="button button--primary" onClick={() => onZoomToRoom(room)}>
            Zoom to room
          </button>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="dialog__note">
          {NOT_A_BUILDING.has(room.venueId)
            ? 'This is a street closed to traffic, not a building — drawn kerb to kerb from the surveyed street, over the block that closes. It has no floor plan because it has no floor. Check the official Gen Con program for exact locations.'
            : room.venueId === 'icc'
            ? 'Room outlines are traced from the convention centre’s official floor plans, which the map draws underneath. Check the official Gen Con program for exact room assignments.'
            : TRACED_FOOTPRINT.has(room.venueId)
              ? 'This building is not in OpenStreetMap, so even its outline is traced from a published plan rather than surveyed — it is the one venue on the map whose shape and position are both approximate. Its rooms come from that same plan. Check the official Gen Con program for exact room assignments.'
              : PLANNED_LAYOUT.has(room.venueId)
              ? 'Which rooms are on this floor, and how they sit relative to each other, come from a published floor plan of the building. Their outlines are rectangles inside the real footprint rather than measured shapes. Check the official Gen Con program for exact room assignments.'
              : 'Room outlines are placed within the real building footprint but are a schematic arrangement, not a surveyed floor plan. Check the official Gen Con program for exact room assignments.'}
        </p>
      </div>
    </div>
  );
}
