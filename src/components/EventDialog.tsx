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
import { conventionDays, entryWhere, planEntry, type PlanEntry } from '../data/plan';
import { AddStop } from './AddStop';
import { subjectFor } from '../hooks/usePlanDescriptions';
import { foodFacets, formatOpening, isFood, openingFor, parseOpeningHours, vendorById } from '../data/food';
import type { Eatery } from '../data/eateries';
import { VENUES_BY_ID, type Room } from '../data/venues';
import { tagsOf, type Exhibitor } from '../data/exhibitors';
import type { Pin } from '../data/offsite';
import type { Plan } from '../hooks/usePlan';
import { useEventNotes, type NotesSubject } from '../hooks/useEventNotes';

/**
 * What the panel is open on. Exactly one of the three.
 *
 * `planned` is something already on the schedule, and it is deliberately not
 * the same as `event`: what a plan holds is a *copy* — see `plan.ts` — and the
 * panel for it has to work with no feed, underground, next year. So it reads
 * from the entry rather than looking the event back up, and it is where the
 * schedule's own actions live now that a block on the day carries none.
 */
export type Detail =
  | { kind: 'event'; event: ConEvent; room?: Room; pin?: Pin }
  | { kind: 'vendor'; exhibitor: Exhibitor; room?: Room }
  | { kind: 'planned'; entry: PlanEntry; room?: Room }
  | { kind: 'eatery'; eatery: Eatery };

interface Props {
  detail: Detail;
  plan: Plan;
  /** The days the feed knows about, for putting a vendor on one of them. */
  feedDays: readonly string[];
  /** The convention's own offset, so a typed clock means the clock there. */
  offsetMinutes: number | null;
  onClose: () => void;
  /** Take the map to where this is. Only offered when it is in a room. */
  onShowOnMap: (roomId: string) => void;
  /** Open directions with this as the destination. */
  onNavigate: (room: Room | undefined, pin: Pin | undefined) => void;
}

/** The stand a stop's id points at, where it points at one. */
const vendorFor = (id: string) => {
  const found = /^vendor:(\d+)@/.exec(id);
  return found ? vendorById(Number(found[1])) : undefined;
};

/** A restaurant as directions want it: a name and a coordinate. */
const eateryPin = (eatery: Eatery | null): Pin | undefined =>
  eatery
    ? {
        id: `eat:${eatery.id}`,
        name: eatery.name,
        address: eatery.address ?? 'Off site',
        lat: eatery.lat,
        lng: eatery.lng,
      }
    : undefined;

/**
 * A planned entry with no room, as directions want it.
 *
 * Somewhere off campus — a restaurant, an address — is a coordinate and a name,
 * which is exactly what a pin is. Built here rather than saved, because the
 * plan stores what it needs and nothing more.
 */
const plannedPin = (entry: PlanEntry | null): Pin | undefined =>
  entry?.at
    ? { id: entry.id, name: entry.title, address: entry.where, lat: entry.at.lat, lng: entry.at.lng }
    : undefined;

export function EventDialog({
  detail,
  plan,
  feedDays,
  offsetMinutes,
  onClose,
  onShowOnMap,
  onNavigate,
}: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const room = detail.kind === 'eatery' ? undefined : detail.room;
  const pin = detail.kind === 'event' ? detail.pin : undefined;
  const venue = room ? VENUES_BY_ID[room.venueId] : undefined;

  const event = detail.kind === 'event' ? detail.event : null;
  const vendor = detail.kind === 'vendor' ? detail.exhibitor : null;
  const planned = detail.kind === 'planned' ? detail.entry : null;
  /*
   * A restaurant, which Gen Con has never heard of.
   *
   * Everything about it comes from OpenStreetMap — see `eateries.ts` — so there
   * is no description to fetch and no id to ask Gen Con about. What it has is a
   * cuisine, hours somebody volunteered, and its own site.
   */
  const eatery = detail.kind === 'eatery' ? detail.eatery : null;
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
  const saved = planned
    ? planned.description
    : event
      ? plan.entries.find((entry) => entry.id === event.id)?.description
      : // A vendor on the schedule is saved under `vendor:<id>@<when>`, and the
        // same truck can be on it twice — so the first copy of the words, from
        // whichever visit fetched them first.
        vendor?.id !== undefined
        ? plan.entries.find((entry) => entry.id.startsWith(`vendor:${vendor.id}@`))?.description
        : undefined;

  const subject: NotesSubject | null = eatery
    ? null
    : planned
    ? subjectFor(planned.id)
    : event
      ? { kind: 'event', id: event.id }
      : vendor?.id !== undefined
        ? { kind: 'vendor', id: vendor.id }
        : null;

  const [asked, setAsked] = useState(false);
  const notes = useEventNotes(subject, asked);
  const description = saved || notes.description;

  /*
   * The vendor a planned stop is a stop at.
   *
   * A stop holds `vendor:14179@…` and nothing else about the truck, so the
   * catalogue is asked. It is bundled rather than fetched, so this answers with
   * no network — which matters, because their own page is the nearest thing to
   * a menu that exists anywhere, and the schedule is where somebody standing on
   * South Street at one o'clock actually wants it.
   */
  const plannedVendor = planned?.kind === 'stop' ? vendorFor(planned.id) : undefined;

  /*
   * Putting a vendor on a day.
   *
   * A session brings its own times and this panel only has to say yes to them.
   * A food truck brings none, so "add" here opens the same little form the
   * schedule's own search uses — and the entry it makes is an entry like any
   * other, walked to and drawn like any other.
   */
  const [placing, setPlacing] = useState(false);
  const days = conventionDays(feedDays, plan.entries);
  // Nothing to put it on, or nothing to read a typed clock against. Both mean
  // the same thing — nobody has said when the convention is — and offering a
  // form that could only produce a timestamp at the wrong hour would be worse
  // than not offering one.
  const canPlace = !!(vendor || eatery) && days.length > 0 && offsetMinutes !== null;

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
  const where = eatery
    ? [eatery.address, 'Off site'].filter(Boolean).join(' · ')
    : planned
    ? entryWhere(planned)
    : [
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
  if (planned) {
    /*
     * From the copy on the device, not from the feed.
     *
     * The whole reason a plan holds a copy is that this panel has to open in an
     * exhibit hall with no signal, and next year, when the feed that made it is
     * a different convention. So it prints what was saved rather than looking
     * anything back up.
     */
    const as = planned as ConEvent & PlanEntry;
    rows.push(['When', `${formatDayLabel(dayKey(planned.start))} · ${formatTimeRange(as)}`]);
    rows.push(['Runs for', formatLength(lengthMinutes(as))]);
  }
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

  /*
   * "Open" rather than "When", because a vendor is a place with hours and not a
   * session with a start time. Gen Con publishes hours for the Block Party and
   * nowhere else, so everywhere else this row is simply absent — see the note in
   * `food.ts` for the four sources that were checked. A stop already *on* the
   * schedule has its own When and had this checked when it was added, so it does
   * not carry it twice.
   */
  const opening = vendor ? openingFor(vendor) : null;
  if (opening) rows.push(['Open', `${formatOpening(opening)} (${opening.year} hours)`]);

  /*
   * What a stand sells, wherever the panel is showing one.
   *
   * The same rows for a vendor being looked at on the map and for one already
   * on somebody's Saturday. "Venezuelan · arepas · vegan options" is the answer
   * to "what is this" in both places, and the schedule is where it is most
   * needed: standing on South Street at one o'clock, deciding whether to walk.
   *
   * No "Kind" row anywhere: the tag at the top of the panel is already that
   * word, and a fact list that repeats its own heading is one people stop
   * reading.
   */
  if (eatery) {
    const opening = eatery.hours ? parseOpeningHours(eatery.hours) : null;
    /*
     * The hours as this reads them, or exactly as they were written.
     *
     * `parseOpeningHours` refuses rather than guesses — see `hours.ts` — and a
     * line it will not read is still worth showing, because somebody can read
     * "Mo-Fr 07:00-20:00; Sa[1] off" and this cannot.
     */
    if (eatery.hours) {
      rows.push(['Open', opening ? formatOpening(opening) : eatery.hours]);
    }
    if (eatery.cuisine.length) rows.push(['Cuisine', eatery.cuisine.join(', ')]);
    if (eatery.diet.length) rows.push(['Dietary', eatery.diet.join(', ')]);
  }

  const stand = vendor ?? plannedVendor;
  if (stand && isFood(stand)) {
    const facets = foodFacets(stand);
    if (facets.cuisine.length) rows.push(['Cuisine', facets.cuisine.join(', ')]);
    if (facets.dish.length) rows.push(['Serves', facets.dish.join(', ')]);
    if (facets.dietary.length) rows.push(['Dietary', facets.dietary.join(', ')]);
    if (facets.other.length) rows.push(['Also', facets.other.join(', ')]);
  } else if (stand) {
    /*
     * Everything else keeps its tags in one row, unsplit.
     *
     * The food ones are filed into three because somebody looking for lunch is
     * asking exactly one of "what kitchen", "what dish", "can I eat it". A
     * stand's 74 are not three questions wearing one coat — they are what it
     * is (`Publisher`, `Retailer`), what it sells (`Board Games`, `Apparel`),
     * what genre (`Fantasy`, `Horror`) and who runs it (`LGBTQIA Plus Owned`),
     * and inventing a classification for them would be inventing four labels
     * Gen Con has not written and nobody has checked. Its own word is "tags",
     * and it is the word the filter uses too.
     */
    const held = tagsOf(stand);
    if (held.length) rows.push(['Tags', held.join(', ')]);
  }

  rows.push(['Where', where]);

  /*
   * Where to read more about it, on somebody else's site.
   *
   * A planned *session* still links to its page — the id is the one Gen Con
   * uses. A planned stop does not: its id ends in a clock, and `eventUrl` would
   * happily turn "…T13:00" into gencon.com/events/00.
   */
  const linkedEvent = event ?? (planned?.kind !== 'stop' ? (planned as ConEvent | null) : null);
  const site = vendor?.website ?? plannedVendor?.website ?? eatery?.website;
  const link = site
    ? { href: site, label: 'Open their own site ↗' }
    : linkedEvent && eventUrl(linkedEvent)
      ? { href: eventUrl(linkedEvent)!, label: 'Open this event on gencon.com ↗' }
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
          <span className="dialog__tag">
            {event
              ? (event.type ?? 'Event')
              : planned
                ? 'On your schedule'
                : (eatery?.kind ?? vendor?.kind ?? 'Vendor')}
          </span>
          <button ref={closeRef} type="button" className="dialog__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <h2 className="dialog__title" id="event-dialog-title">
          {event ? event.title : (planned?.title ?? eatery?.name ?? vendor?.name)}
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

        {placing && canPlace && (
          <AddStop
            stop={
              eatery
                ? {
                    key: `eat:${eatery.id}`,
                    title: eatery.name,
                    where,
                    at: { lat: eatery.lat, lng: eatery.lng },
                  }
                : {
                    key: `vendor:${vendor!.id ?? `${vendor!.name}:${vendor!.spot}`}`,
                    title: vendor!.name,
                    where,
                    roomId: room?.id,
                  }
            }
            opening={eatery ? (eatery.hours ? parseOpeningHours(eatery.hours) : null) : opening}
            days={days}
            day={days[0]}
            offsetMinutes={offsetMinutes!}
            entries={plan.entries}
            onAdd={(entry) => {
              plan.add(entry);
              setPlacing(false);
            }}
            onCancel={() => setPlacing(false)}
          />
        )}

        <div className="dialog__actions">
          {canPlace && !placing && (
            <button type="button" className="button button--primary" onClick={() => setPlacing(true)}>
              Add to schedule
            </button>
          )}
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
              // The primary action of a panel opened *from* the schedule is the
              // map: you already know when it is — you put it there.
              className={`button${planned || (vendor && !canPlace) ? ' button--primary' : ''}`}
              onClick={() => onShowOnMap(room.id)}
            >
              Show on map
            </button>
          )}
          {(room || pin || planned?.at || eatery) && (
            <button
              type="button"
              className={`button${eatery ? ' button--primary' : ''}`}
              onClick={() => onNavigate(room, pin ?? plannedPin(planned) ?? eateryPin(eatery))}
            >
              Directions
            </button>
          )}
          {/*
            * Removing lives here rather than on the block.
            *
            * A block is a quarter of a phone wide and twenty-six pixels tall
            * for a stop, and two links in it left no room for the thing's own
            * name. Removing something from a schedule is also not an action
            * anybody should be one mis-tap away from, and this is the panel
            * they opened to check what it was.
            */}
          {planned && (
            <button
              type="button"
              className="button"
              onClick={() => {
                plan.remove(planned.id);
                onClose();
              }}
            >
              Remove from schedule
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
