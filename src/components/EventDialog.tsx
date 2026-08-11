/**
 * One thing, in full, before anybody commits to it.
 *
 * WHY A RESULT NO LONGER ACTS ON ITSELF. Tapping a search result used to put the
 * event straight onto the schedule, which is fine when you already know what it
 * is and wrong the rest of the time — a title and a room is not enough to
 * decide by. Whether it costs forty dollars, whether it is 21+, whether any
 * tickets are left, whether it runs six hours: all of that is in the feed, none
 * of it was on screen, and every one of them is a reason not to add it.
 *
 * IT SERVES TWO SUBJECTS. An event and a vendor answer different questions —
 * "when does it run and can I still get a ticket" against "what do they sell
 * and when are they open" — but they are the same panel doing the same job, and
 * splitting them would mean two of every failure path. So the rows differ and
 * everything around them does not.
 *
 * THE DESCRIPTION IS ASKED FOR, everything else is already in hand. It is not
 * in the feed — a paragraph each across 27,467 events is several megabytes in
 * front of the first screen — so it costs a request, and nothing spends that
 * request until the button is pressed. Where the event is already on somebody's
 * schedule the copy saved for offline reading is used instead, and no request
 * happens at all.
 *
 * A VENDOR LINKS TO ITSELF. For a food truck, its own page is the nearest thing
 * to a menu that exists anywhere — Gen Con's API carries no dishes and no
 * prices — so that link replaces the one to gencon.com. Fifteen of the
 * forty-three are Facebook pages, which is exactly where a food truck posts
 * what it is cooking.
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
import { foodFacets, formatOpening, isFood, openingFor } from '../data/food';
import { VENUES_BY_ID, type Room } from '../data/venues';
import type { Exhibitor } from '../data/exhibitors';
import type { Pin } from '../data/offsite';
import type { Plan } from '../hooks/usePlan';
import { useEventNotes, type NotesSubject } from '../hooks/useEventNotes';

/** What the panel is open on. Exactly one of the two. */
export type Detail =
  | { kind: 'event'; event: ConEvent; room?: Room; pin?: Pin }
  | { kind: 'vendor'; exhibitor: Exhibitor; room?: Room };

interface Props {
  detail: Detail;
  plan: Plan;
  onClose: () => void;
  /** Take the map to where this is. Only offered when it is in a room. */
  onShowOnMap: (roomId: string) => void;
  /** Open directions with this as the destination. */
  onNavigate: (room: Room | undefined, pin: Pin | undefined) => void;
}

export function EventDialog({ detail, plan, onClose, onShowOnMap, onNavigate }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const room = detail.room;
  const pin = detail.kind === 'event' ? detail.pin : undefined;
  const venue = room ? VENUES_BY_ID[room.venueId] : undefined;

  const event = detail.kind === 'event' ? detail.event : null;
  const vendor = detail.kind === 'vendor' ? detail.exhibitor : null;
  const held = !!event && plan.planned(event.id);

  /*
   * The copy kept on the device, where there is one.
   *
   * An entry on the schedule has its description archived — see
   * `usePlanDescriptions` — so opening one underground shows it immediately and
   * asks the network for nothing. An empty string is a real answer there: it
   * means the source was asked and had nothing, which is different from not
   * having asked.
   */
  const saved = event ? plan.entries.find((entry) => entry.id === event.id)?.description : undefined;

  const subject: NotesSubject | null = event
    ? { kind: 'event', id: event.id }
    : vendor?.id !== undefined
      ? { kind: 'vendor', id: vendor.id }
      : null;

  const [asked, setAsked] = useState(false);
  const notes = useEventNotes(subject, asked);
  const description = saved || notes.description;

  useEffect(() => closeRef.current?.focus(), []);
  useEffect(() => {
    const onKeyDown = (key: KeyboardEvent) => key.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /*
   * Room, then building, then the spot inside it — minus the repetition.
   *
   * The Block Party is a room called Block Party in a venue called Block Party,
   * and printing both reads as a stutter rather than as detail. Deduplicated
   * rather than special-cased, because the same is true of anywhere else whose
   * room is its whole building.
   */
  const where =
    [
      room ? (room.shortName ?? room.name) : (pin?.name ?? event?.locationText),
      venue?.shortName ?? venue?.name,
      event?.tableText && `Table ${event.tableText}`,
      vendor?.spot,
    ]
      .filter(Boolean)
      .filter((part, at, all) => all.indexOf(part) === at)
      .join(' · ') || 'Not given';

  /*
   * Everything the source holds, in the order somebody decides in. A row is
   * left out entirely rather than printed empty — "Cost: —" is noise, and the
   * absence of a row is already the honest statement that nothing said.
   */
  const rows: Array<[string, string]> = [];
  if (event) {
    rows.push(['When', `${formatDayLabel(dayKey(event.start))} · ${formatTimeRange(event)}`]);
    rows.push(['Runs for', formatLength(lengthMinutes(event))]);
    rows.push(['Type', kindName(event.type)]);
    if (event.gameSystem) rows.push(['System', event.gameSystem]);
    if (notes.program) rows.push(['Programme', notes.program]);
    if (formatCost(event.cost)) rows.push(['Cost', formatCost(event.cost)]);
    if (typeof event.ticketsAvailable === 'number') {
      rows.push(['Tickets', event.ticketsAvailable > 0 ? `${event.ticketsAvailable} left` : 'None left']);
    }
    if (event.ageRequirement) rows.push(['Age', event.ageRequirement]);
  }

  const opening = vendor ? openingFor(vendor) : null;
  if (vendor) {
    /*
     * "Open" rather than "When", because a vendor is a place with hours and not
     * a session with a start time. Gen Con publishes hours for the Block Party
     * and nowhere else, so everywhere else this row is simply absent — see the
     * note in `food.ts` for the four sources that were checked.
     */
    if (opening) rows.push(['Open', `${formatOpening(opening)} (${opening.year} hours)`]);
    // No "Kind" row: the tag at the top of the panel is already that word, and
    // a fact list that repeats the heading is a fact list somebody stops reading.
    if (isFood(vendor)) {
      const facets = foodFacets(vendor);
      if (facets.cuisine.length) rows.push(['Cuisine', facets.cuisine.join(', ')]);
      if (facets.dish.length) rows.push(['Serves', facets.dish.join(', ')]);
      if (facets.dietary.length) rows.push(['Dietary', facets.dietary.join(', ')]);
      if (facets.other.length) rows.push(['Also', facets.other.join(', ')]);
    }
  }
  rows.push(['Where', where]);

  const link = vendor?.website
    ? { href: vendor.website, label: 'Open their own site ↗' }
    : event && eventUrl(event)
      ? { href: eventUrl(event)!, label: 'Open this event on gencon.com ↗' }
      : null;

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
          <span className="dialog__tag">{event ? (event.type ?? 'Event') : (vendor?.kind ?? 'Vendor')}</span>
          <button ref={closeRef} type="button" className="dialog__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <h2 className="dialog__title" id="event-dialog-title">
          {event ? event.title : vendor?.name}
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
        ) : !subject ? null : notes.status === 'loading' ? (
          <p className="event-dialog__note">Reading the description…</p>
        ) : notes.status === 'offline' ? (
          <p className="event-dialog__note">
            No connection, and this one is not saved.
            {event ? ' Add it to your schedule and its description will be kept for reading offline.' : ''}
          </p>
        ) : notes.status === 'unavailable' || notes.status === 'ready' ? (
          <p className="event-dialog__note">Couldn’t read the description.</p>
        ) : (
          <button type="button" className="event-dialog__more" onClick={() => setAsked(true)}>
            Show full description
          </button>
        )}

        <div className="dialog__actions">
          {event && (
            <button
              type="button"
              className={`button${held ? '' : ' button--primary'}`}
              onClick={() => plan.toggle(planEntry(event, room, pin))}
            >
              {held ? 'Remove from schedule' : 'Add to schedule'}
            </button>
          )}
          {room && (
            <button
              type="button"
              className={`button${vendor ? ' button--primary' : ''}`}
              onClick={() => onShowOnMap(room.id)}
            >
              Show on map
            </button>
          )}
          {(room || pin) && (
            <button type="button" className="button" onClick={() => onNavigate(room, pin)}>
              Directions
            </button>
          )}
        </div>

        {link && (
          <a className="schedule__source" href={link.href} target="_blank" rel="noreferrer noopener">
            {link.label}
          </a>
        )}
      </div>
    </div>
  );
}
