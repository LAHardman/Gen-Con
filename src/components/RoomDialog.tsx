import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_STYLES, VENUES_BY_ID, type Room } from '../data/venues';
import {
  dayKey,
  formatDayLabel,
  formatTimeRange,
  isHappeningAt,
  type ConEvent,
} from '../data/events';
import type { FeedStatus } from '../hooks/useEventFeed';

interface Props {
  room: Room;
  events: ConEvent[];
  feedStatus: FeedStatus;
  sourceUrl: string;
  /** "Now" as a timestamp, so the caller controls the clock. */
  nowMs: number;
  onClose: () => void;
  onZoomToRoom: (room: Room) => void;
}

export function RoomDialog({
  room,
  events,
  feedStatus,
  sourceUrl,
  nowMs,
  onClose,
  onZoomToRoom,
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
          <span className="dialog__tag" style={{ background: style.fill, borderColor: style.stroke }}>
            {style.label}
          </span>
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

        <h2 className="dialog__title" id="room-dialog-title">
          {room.name}
        </h2>
        <p className="dialog__location">
          {venue?.name} · {room.level}
        </p>

        <p className="dialog__description">{room.description}</p>

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
                      }`}
                    >
                      <span className="schedule__time">{formatTimeRange(event)}</span>
                      <span className="schedule__body">
                        {event.url ? (
                          <a href={event.url} target="_blank" rel="noreferrer noopener">
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
                      {live && <span className="schedule__badge">Now</span>}
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
          Room outlines are placed within the real building footprint but are a schematic
          arrangement, not a surveyed floor plan. Check the official Gen Con program for exact room
          assignments.
        </p>
      </div>
    </div>
  );
}
