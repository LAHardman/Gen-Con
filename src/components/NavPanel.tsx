import type { Progress } from '../data/progress';
import { walkingMinutes } from '../utils/geo';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatDistance,
  placeDetail,
  placeLabel,
  placeSpot,
  type NavEnd,
  type NavPlace,
  type RouteSummary,
} from '../data/navigation';
import { hitLabel, hitPlace, hitSpot, search, type EventSearchIndex } from '../data/search';
import { formatRough, roughMinutes } from '../data/nearby';
import { deviceMessage, type DeviceLocation } from '../hooks/useDeviceLocation';

interface Props {
  from: NavPlace | null;
  to: NavPlace | null;
  /** Which end the panel is choosing a place for, if either. */
  editing: NavEnd | null;
  /** The next click on the map chooses the end being edited. */
  pickingOnMap: boolean;
  /**
   * A room's dialog is open over the panel, and owns the keyboard while it is:
   * Escape belongs to whatever is on top, and both handling it would close two
   * things at once.
   */
  covered: boolean;
  device: DeviceLocation;
  route: RouteSummary | null;
  /** Where along it the device is, while a route is being followed. */
  progress?: Progress | null;
  /** Prepared once per feed by the app, and shared with the header's search. */
  events: EventSearchIndex;
  onEdit: (end: NavEnd | null) => void;
  onSet: (end: NavEnd, place: NavPlace) => void;
  onPickOnMap: (picking: boolean) => void;
  onSwap: () => void;
  onClose: () => void;
}

const RESULT_LIMIT = 6;

const END_LABEL: Record<NavEnd, string> = { from: 'From', to: 'To' };
const END_PROMPT: Record<NavEnd, string> = {
  from: 'Choose a starting point',
  to: 'Choose a destination',
};

export function NavPanel({
  from,
  to,
  editing,
  pickingOnMap,
  covered,
  device,
  route,
  progress,
  events,
  onEdit,
  onSet,
  onPickOnMap,
  onSwap,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Each end gets a fresh search: the text typed to find where you are standing
  // is not a useful start for finding where you are going.
  useEffect(() => setQuery(''), [editing]);

  // Choosing a place is what the panel is for, so the search takes the caret as
  // soon as an end opens — except when the map is doing the choosing.
  useEffect(() => {
    if (editing && !pickingOnMap) inputRef.current?.focus();
  }, [editing, pickingOnMap]);

  const hits = useMemo(() => search(query, events, RESULT_LIMIT), [query, events]);

  /*
   * How far each candidate is from the end that is already settled.
   *
   * This is the question the panel exists to answer and could not: you had to
   * pick a destination, wait for a route, read the time, and go back if it was
   * not the one you wanted. Reading it off the table costs nothing, so every
   * candidate can carry it — which is the difference between choosing and
   * guessing-then-checking.
   *
   * Measured from the *other* end, so choosing a destination measures from
   * where you are starting and choosing a start measures from where you are
   * going. Null while that other end is not settled, and while a "my location"
   * end has had no fix.
   */
  const settled = editing === 'to' ? from : to;
  const away = useMemo(() => {
    const spot = placeSpot(settled ?? null, device.fix);
    if (!spot || (!spot.roomId && !spot.at)) return hits.map(() => null);
    return hits.map((hit) => roughMinutes(spot, hitSpot(hit)));
  }, [hits, settled, device.fix]);

  // Escape backs out one step at a time: first whatever is being chosen, then
  // the directions themselves — so it never throws away a route you had.
  useEffect(() => {
    if (covered) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pickingOnMap) onPickOnMap(false);
      else if (editing) onEdit(null);
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [covered, pickingOnMap, editing, onPickOnMap, onEdit, onClose]);

  const choose = (end: NavEnd, place: NavPlace) => {
    onSet(end, place);
    onPickOnMap(false);
    setQuery('');
  };

  /*
   * Why there is no route yet, when an end is "my location" and the device
   * hasn't said where that is. Deliberately not part of the chooser: choosing
   * "use my location" closes the chooser, and a refusal that only appeared
   * while it was open would never be seen by the person it is for.
   */
  const usesDevice = from?.kind === 'device' || to?.kind === 'device';
  const deviceNote = usesDevice ? deviceMessage(device.status) : null;

  return (
    <section className="nav" aria-label="Directions">
      <header className="nav__header">
        <h2 className="nav__title">Directions</h2>
        <button type="button" className="nav__close" onClick={onClose} aria-label="Close directions">
          ✕
        </button>
      </header>

      <div className="nav__ends">
        <div className="nav__rows">
          {(['from', 'to'] as const).map((end) => {
            const place = end === 'from' ? from : to;
            const open = editing === end;
            return (
              <button
                key={end}
                type="button"
                className={`nav__row${open ? ' nav__row--editing' : ''}`}
                aria-expanded={open}
                onClick={() => {
                  onPickOnMap(false);
                  onEdit(open ? null : end);
                }}
              >
                <span className="nav__end">{END_LABEL[end]}</span>
                <span className="nav__place">
                  <span className="nav__place-name">{place ? placeLabel(place) : END_PROMPT[end]}</span>
                  {place && (
                    <span className="nav__place-detail">{placeDetail(place, device.fix)}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="nav__swap"
          onClick={onSwap}
          disabled={!from && !to}
          aria-label="Swap start and destination"
          title="Swap start and destination"
        >
          ⇅
        </button>
      </div>

      {editing && (
        <div className="nav__chooser">
          <div className="nav__ways">
            <button
              type="button"
              className="nav__way"
              onClick={() => choose(editing, { kind: 'device' })}
            >
              Use my location
            </button>
            <button
              type="button"
              className={`nav__way${pickingOnMap ? ' nav__way--armed' : ''}`}
              aria-pressed={pickingOnMap}
              onClick={() => onPickOnMap(!pickingOnMap)}
            >
              {pickingOnMap ? 'Tap the map…' : 'Pick on the map'}
            </button>
          </div>

          {pickingOnMap ? (
            <p className="nav__hint">
              Tap a building to look inside it, a room to {editing === 'from' ? 'start from' : 'go to'}{' '}
              it, or open ground to drop a point.
            </p>
          ) : (
            <>
              <input
                ref={inputRef}
                type="search"
                className="search__input nav__search"
                placeholder="Search rooms and events"
                aria-label={END_PROMPT[editing]}
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && hits.length > 0) {
                    event.preventDefault();
                    choose(editing, hitPlace(hits[0]));
                  }
                }}
              />

              {query.trim().length >= 2 && (
                <ul className="search__results search__results--inline" role="listbox">
                  {hits.length === 0 && (
                    <li className="search__empty">Nothing matches “{query.trim()}”</li>
                  )}
                  {hits.map((hit, position) => {
                    const { title, detail } = hitLabel(hit);
                    return (
                      <li key={hit.key}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={false}
                          className="search__hit"
                          onClick={() => choose(editing, hitPlace(hit))}
                        >
                          <span className="search__hit-main">{title}</span>
                          <span className="search__hit-sub">{detail}</span>
                          {away[position] !== null && (
                            <span className="search__hit-away">{formatRough(away[position]!)}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}

        </div>
      )}

      {deviceNote && <p className="nav__note nav__note--device">{deviceNote}</p>}

      {route && !editing && (() => {
        /*
         * Following, rather than merely routed: there is a walk, a position on
         * it, and that position is actually on it. Somebody whose fix has
         * wandered gets the whole route's numbers back rather than a countdown
         * measured from a place they are not.
         */
        const walking = !!progress?.onRoute && !!route.walk;
        const left = walking
          ? walkingMinutes(progress!.remainingMetres)
          : route.minutes;
        return (
        <div className="nav__summary">
          {route.arrived ? (
            <p className="nav__distance">You are already there.</p>
          ) : (
            <>
              {/*
                * While a route is being followed, what is left to walk — not
                * what it was when it started. Somebody halfway down a hall
                * wants the number to have moved; a figure that stays at "320 m"
                * until they arrive is the app not watching.
                */}
              <p className="nav__distance">
                <strong>{formatDistance(walking ? progress!.remainingMetres : route.metres)}</strong>
                {walking ? ' left' : route.walk ? ' to walk' : ' in a straight line'}
                {left !== null && (
                  <>
                    {' · '}
                    <strong>{left} min</strong>
                  </>
                )}
              </p>
              {route.minutes === null && (
                <p className="nav__leg">Too far to walk — this is the distance to the campus.</p>
              )}

              {route.walk ? (
                <ol className="nav__steps">
                  {route.walk.legs.map((leg, at) => (
                    <li key={`${leg.kind}-${at}`} className={`nav__step nav__step--${leg.kind}`}>
                      <span className="nav__step-text">{leg.text}</span>
                      <span className="nav__step-metres">{formatDistance(leg.metres)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <>
                  {route.floorChange && (
                    <p className="nav__leg">
                      Same building: {route.floorChange.from} → {route.floorChange.to}. The line is
                      drawn flat, so it can’t show the stairs.
                    </p>
                  )}
                  {route.venueChange && (
                    <p className="nav__leg">
                      {route.venueChange.from} → {route.venueChange.to}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
        );
      })()}

      {route && !editing && !route.arrived && (
        <p className="nav__note">
          {route.walk
            ? route.walk.indoors
              ? 'Followed along the floors the plans draw — corridors, skywalks and the tunnel. Kept under cover: where crossing the street would be shorter, it was not shorter by much.'
              : 'Followed along the floors the plans draw and the pavements OpenStreetMap has surveyed. The dashed legs are the ground between a door and the nearest footway, which nothing maps, so those are straight lines rather than routes.'
            : 'A straight line between the two, not a walking route: nothing here has floor drawn for it to follow, so it goes through walls and ignores the streets.'}
        </p>
      )}
    </section>
  );
}
