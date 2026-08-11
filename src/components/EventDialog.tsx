/**
 * One session, in full, before anybody commits to it.
 *
 * WHY A RESULT NO LONGER ADDS ITSELF. Tapping a search result used to put the
 * event straight onto the schedule, which is fine when you already know what it
 * is and wrong the rest of the time — a title and a room is not enough to
 * decide by. Whether it costs forty dollars, whether it is 21+, whether any
 * tickets are left, whether it runs six hours: all of that is in the feed, none
 * of it was on screen, and every one of them is a reason not to add it.
 *
 * So the result opens this instead, and adding is one of three things you can
 * do from it. The other two are the questions the rest of the app answers —
 * where is that, and how do I get there — asked from the place where the
 * question actually arises.
 *
 * THE DESCRIPTION IS ASKED FOR, everything else is already in hand. It is not
 * in the feed — a paragraph each across 27,467 events is several megabytes in
 * front of the first screen — so it costs a request, and nothing spends that
 * request until the button is pressed. Where the event is already on somebody's
 * schedule the copy saved for offline reading is used instead, and no request
 * happens at all.
 */

import { useEffect, useRef, useState } from 'react';
import {
  eventUrl,
  formatDayLabel,
  formatTimeRange,
  dayKey,
  type ConEvent,
} from '../data/events';
import { formatCost, formatLength, lengthMinutes } from '../data/filters';
import { kindName } from '../data/event-kinds';
import { planEntry } from '../data/plan';
import { VENUES_BY_ID, type Room } from '../data/venues';
import type { Pin } from '../data/offsite';
import type { Plan } from '../hooks/usePlan';
import { useEventNotes } from '../hooks/useEventNotes';

interface Props {
  event: ConEvent;
  room?: Room;
  pin?: Pin;
  plan: Plan;
  onClose: () => void;
  /** Take the map to where this is. Only offered when it is in a room. */
  onShowOnMap: (roomId: string) => void;
  /** Open directions with this as the destination. */
  onNavigate: (room: Room | undefined, pin: Pin | undefined) => void;
}

export function EventDialog({ event, room, pin, plan, onClose, onShowOnMap, onNavigate }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const held = plan.planned(event.id);
  const venue = room ? VENUES_BY_ID[room.venueId] : undefined;

  /*
   * The copy kept on the device, where there is one.
   *
   * An entry on the schedule has its description archived — see
   * `usePlanDescriptions` — so opening one underground shows it immediately and
   * asks the network for nothing. An empty string is a real answer there: it
   * means the source was asked and had nothing, which is different from not
   * having asked.
   */
  const saved = plan.entries.find((entry) => entry.id === event.id)?.description;

  const [asked, setAsked] = useState(false);
  const notes = useEventNotes(event.id, asked);
  const description = saved || notes.description;

  useEffect(() => closeRef.current?.focus(), []);
  useEffect(() => {
    const onKeyDown = (key: KeyboardEvent) => key.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /*
   * Everything the feed holds, in the order somebody decides in: when, then how
   * long, then what it costs and whether there is a seat, then who it is for.
   * A row is left out entirely rather than printed empty — "Cost: —" is noise,
   * and the absence of a row is already the honest statement that the source
   * did not say.
   */
  const rows: Array<[string, string]> = [
    ['When', `${formatDayLabel(dayKey(event.start))} · ${formatTimeRange(event)}`],
    ['Runs for', formatLength(lengthMinutes(event))],
    ['Type', kindName(event.type)],
  ];
  if (event.gameSystem) rows.push(['System', event.gameSystem]);
  if (notes.program) rows.push(['Programme', notes.program]);
  if (formatCost(event.cost)) rows.push(['Cost', formatCost(event.cost)!]);
  if (typeof event.ticketsAvailable === 'number') {
    rows.push([
      'Tickets',
      event.ticketsAvailable > 0 ? `${event.ticketsAvailable} left` : 'None left',
    ]);
  }
  if (event.ageRequirement) rows.push(['Age', event.ageRequirement]);
  rows.push([
    'Where',
    [
      room ? (room.shortName ?? room.name) : (pin?.name ?? event.locationText),
      venue?.shortName ?? venue?.name,
      event.tableText && `Table ${event.tableText}`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Not given',
  ]);

  return (
    <div className="dialog__backdrop" onPointerDown={onClose}>
      <div
        className="dialog event-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-dialog-title"
        onPointerDown={(pointer) => pointer.stopPropagation()}
      >
        <div className="dialog__header">
          <span className="dialog__tag">{event.type ?? 'Event'}</span>
          <button
            ref={closeRef}
            type="button"
            className="dialog__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <h2 className="dialog__title" id="event-dialog-title">
          {event.title}
        </h2>

        <dl className="event-dialog__facts">
          {rows.map(([label, value]) => (
            <div key={label} className="event-dialog__fact">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {/*
          * The description, on request.
          *
          * A button rather than an automatic fetch: opening this on a phone in
          * an exhibit hall should not spend a request on a paragraph nobody has
          * asked to read, and on the show floor that request is as likely to
          * hang as to answer. Where the event is on the schedule its saved copy
          * is already here and there is nothing to press.
          */}
        {description ? (
          <p className="event-dialog__description">{description}</p>
        ) : saved === '' ? (
          <p className="event-dialog__note">This event has no description.</p>
        ) : notes.status === 'loading' ? (
          <p className="event-dialog__note">Reading the description…</p>
        ) : notes.status === 'offline' ? (
          <p className="event-dialog__note">
            No connection, and this one is not saved. Add it to your schedule and its description
            will be kept for reading offline.
          </p>
        ) : notes.status === 'unavailable' || notes.status === 'ready' ? (
          <p className="event-dialog__note">Couldn’t read the description.</p>
        ) : (
          <button type="button" className="event-dialog__more" onClick={() => setAsked(true)}>
            Show full description
          </button>
        )}

        <div className="dialog__actions">
          <button
            type="button"
            className={`button${held ? '' : ' button--primary'}`}
            onClick={() => plan.toggle(planEntry(event, room, pin))}
          >
            {held ? 'Remove from schedule' : 'Add to schedule'}
          </button>
          {room && (
            <button type="button" className="button" onClick={() => onShowOnMap(room.id)}>
              Show on map
            </button>
          )}
          {(room || pin) && (
            <button type="button" className="button" onClick={() => onNavigate(room, pin)}>
              Directions
            </button>
          )}
        </div>

        {eventUrl(event) && (
          <a
            className="schedule__source"
            href={eventUrl(event)}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open this event on gencon.com ↗
          </a>
        )}
      </div>
    </div>
  );
}
