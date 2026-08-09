import { useCallback, useEffect, useMemo, useState } from 'react';
import { FloorPicker } from './components/FloorPicker';
import { Legend } from './components/Legend';
import { MapView } from './components/MapView';
import { RoomDialog } from './components/RoomDialog';
import { SearchBar } from './components/SearchBar';
import type { SearchHit } from './data/search';
import type { Pin } from './data/offsite';
import { NavPanel } from './components/NavPanel';
import { ROOMS_BY_ID, defaultLevel, type Room } from './data/venues';
import { BASEMAPS, BASEMAP_IDS, type BasemapId } from './data/basemaps';
import { useEventFeed } from './hooks/useEventFeed';
import { useFollowedRoute } from './hooks/useFollowedRoute';
import { useDeviceLocation } from './hooks/useDeviceLocation';
import { useWarmCampus } from './hooks/useWarmCampus';
import { isHappeningAt } from './data/events';
import { buildEventSearchIndex } from './data/search';
import {
  pinPlace,
  placeRoom,
  roomPlace,
  type NavEnd,
  type NavPlace,
} from './data/navigation';

const SOURCE_URL = 'https://gencon.eventdb.us/';
const BASEMAP_KEY = 'genCon.basemap';

export default function App() {
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [openRoom, setOpenRoom] = useState<Room | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ room: Room; token: number } | null>(null);
  const [basemapId, setBasemapId] = useState<BasemapId>('dark');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showAmenities, setShowAmenities] = useState(true);
  // The floor each building is showing, and the building the map is looking at.
  // Only buildings moved off the floor they open on appear here.
  const [levels, setLevels] = useState<Record<string, string>>({});
  // The building you have opened. Nothing draws an inside until one is.
  const [openVenueId, setOpenVenueId] = useState<string | null>(null);

  // Directions. `nav` is null until somebody asks for them; `editing` is the
  // end the panel is choosing a place for, and `pickOnMap` says that end is
  // waiting on a click rather than on the panel's own search.
  const [nav, setNav] = useState<{ from: NavPlace | null; to: NavPlace | null } | null>(null);
  const [editing, setEditing] = useState<NavEnd | null>(null);
  const [pickOnMap, setPickOnMap] = useState(false);

  const { status, feed, index } = useEventFeed();

  // Directions cost a second and a half the first time and 5 ms after it, and
  // that second and a half used to be spent inside the tap. Now it is spent
  // here, while the map is being looked at.
  useWarmCampus();

  // Built once per feed and shared: the header's search and the directions
  // panel search the same 27,000 titles, and lowercasing them twice per feed
  // is twice as much work as it needs to be.
  const eventSearchIndex = useMemo(() => buildEventSearchIndex(index), [index]);

  // Nothing asks the browser where you are until a route says "my location".
  const usingDevice = nav?.from?.kind === 'device' || nav?.to?.kind === 'device';
  const device = useDeviceLocation(!!usingDevice);

  // Held rather than recomputed on every fix, so the line does not rearrange
  // under somebody walking it correctly. `useFollowedRoute` measures each fix
  // against the route it already has and only asks for a new one when they are
  // genuinely off it — see the note there.
  const followed = useFollowedRoute(nav?.from, nav?.to, device.fix);
  const route = followed.route;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(BASEMAP_KEY);
      if (stored && stored in BASEMAPS) setBasemapId(stored as BasemapId);
    } catch {
      // Storage can be blocked; the default basemap is fine.
    }
  }, []);

  // Keep "on now" honest without re-rendering constantly.
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const chooseBasemap = useCallback((id: BasemapId) => {
    setBasemapId(id);
    try {
      window.localStorage.setItem(BASEMAP_KEY, id);
    } catch {
      // Non-fatal.
    }
  }, []);

  const eventCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!index) return counts;
    for (const [roomId, events] of index.byRoom) counts.set(roomId, events.length);
    return counts;
  }, [index]);

  /*
   * The pins, with how many events stand on each.
   *
   * Every pin the schedule reaches, whether or not anything is on today: the
   * map is a map before it is a timetable, and a steakhouse hosting one dinner
   * on Thursday is still somewhere worth being able to see and walk to.
   */
  const pins = useMemo(
    () =>
      index
        ? [...index.byPin.values()].map(({ pin, events }) => ({ pin, events: events.length }))
        : [],
    [index],
  );

  // A pin has no room to select and no building to open, so opening one is
  // asking the way there — the only thing anybody can do with an address.
  const handleOpenPin = useCallback((pin: Pin) => {
    setNav({ from: null, to: pinPlace(pin) });
    setEditing('from');
    setPickOnMap(false);
  }, []);

  const liveCount = useMemo(() => {
    if (!index) return 0;
    let total = 0;
    for (const events of index.byRoom.values()) {
      total += events.filter((event) => isHappeningAt(event, nowMs)).length;
    }
    return total;
  }, [index, nowMs]);

  // Opening a building starts you on the ground floor, wherever you left it
  // last time. Closing it is the same call with null.
  const openVenue = useCallback((venueId: string | null) => {
    setOpenVenueId(venueId);
    if (venueId) {
      setLevels((current) => {
        if (!(venueId in current)) return current;
        const next = { ...current };
        delete next[venueId];
        return next;
      });
    }
  }, []);

  // Going to a room means opening its building on its floor, however you got
  // there: the room is on the 3rd and drawing it over the 1st would put it in
  // the wrong building's worth of walls.
  const showRoom = useCallback((room: Room) => {
    setOpenVenueId(room.venueId);
    setLevels((current) =>
      current[room.venueId] === room.level ? current : { ...current, [room.venueId]: room.level },
    );
  }, []);

  const handleSelectRoom = useCallback(
    (roomId: string | null) => {
      setSelectedRoomId(roomId);
      const room = roomId ? ROOMS_BY_ID[roomId] : undefined;
      if (room) showRoom(room);
    },
    [showRoom],
  );

  // Changing floor under a selected room leaves it a storey away and no longer
  // drawn, so the selection goes with it.
  const handlePickFloor = useCallback((venueId: string, level: string) => {
    setLevels((current) => ({ ...current, [venueId]: level }));
    setSelectedRoomId((current) => {
      const room = current ? ROOMS_BY_ID[current] : undefined;
      return room && room.venueId === venueId && room.level !== level ? null : current;
    });
  }, []);

  const handleZoomToRoom = useCallback((room: Room) => {
    setFocusRequest({ room, token: Date.now() });
    setOpenRoom(null);
  }, []);

  // A search result takes you to the room and opens it, which is the whole
  // point of searching for one: the map flies there behind the dialog, so
  // closing it leaves you looking at the right place.
  const handlePickSearchResult = useCallback(
    (hit: SearchHit) => {
      // A pin has no room to select, no building to open and no floor to
      // switch to — it is a coordinate with an address on it. Picking one puts
      // it straight into directions, because going there is the only thing
      // anybody can do with it.
      if (hit.pin) {
        setNav({ from: null, to: pinPlace(hit.pin) });
        setEditing('from');
        setPickOnMap(false);
        return;
      }
      const room = hit.room!;
      setSelectedRoomId(room.id);
      showRoom(room);
      setFocusRequest({ room, token: Date.now() });
      setOpenRoom(room);
    },
    [showRoom],
  );

  // Directions open with the room you were reading as the destination and
  // nothing to start from, which is the question left to answer.
  const handleNavigateToRoom = useCallback(
    (room: Room) => {
      setNav({ from: null, to: roomPlace(room) });
      setEditing('from');
      setPickOnMap(false);
      setOpenRoom(null);
      setSelectedRoomId(room.id);
      showRoom(room);
    },
    [showRoom],
  );

  const handleSetNavPlace = useCallback(
    (end: NavEnd, place: NavPlace) => {
      const base = nav ?? { from: null, to: null };
      const next = end === 'from' ? { ...base, from: place } : { ...base, to: place };
      setNav(next);
      setEditing(null);
      setPickOnMap(false);

      // A room in a building the map hasn't opened isn't there to look at, so
      // choosing one opens its building on its floor. Where both ends are in
      // the same building, though, showing one floor necessarily hides the
      // other — and between the two, the floor you are going to is the one to
      // draw.
      const origin = placeRoom(next.from);
      const destination = placeRoom(next.to);
      const show =
        origin && destination && origin.venueId === destination.venueId
          ? destination
          : placeRoom(place);
      if (show) showRoom(show);
    },
    [nav, showRoom],
  );

  // A click on the map answers whichever end the panel has open.
  const handlePickPlace = useCallback(
    (place: NavPlace) => {
      if (editing) handleSetNavPlace(editing, place);
    },
    [editing, handleSetNavPlace],
  );

  const handleCloseNav = useCallback(() => {
    setNav(null);
    setEditing(null);
    setPickOnMap(false);
  }, []);

  const selectedRoom = selectedRoomId ? ROOMS_BY_ID[selectedRoomId] : undefined;
  const picking = !!editing && pickOnMap;

  const openRoomEvents = openRoom ? (index?.byRoom.get(openRoom.id) ?? []) : [];

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__logo" aria-hidden="true">
            20
          </span>
          <div>
            <h1>Gen Con Trip</h1>
            <p>
              {status === 'ready' && index
                ? `${index.total.toLocaleString()} events${liveCount > 0 ? ` · ${liveCount} on now` : ''}`
                : status === 'absent'
                  ? 'Venue map · no event data'
                  : status === 'error'
                    ? 'Venue map · event data failed to load'
                    : 'Venue map'}
            </p>
          </div>
        </div>

        <SearchBar events={eventSearchIndex} onPick={handlePickSearchResult} />

        <div className="app__tools">
          <div className="app__basemaps" role="group" aria-label="Basemap style">
            {BASEMAP_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className={`app__basemap${id === basemapId ? ' app__basemap--active' : ''}`}
                aria-pressed={id === basemapId}
                onClick={() => chooseBasemap(id)}
              >
                {BASEMAPS[id].label}
              </button>
            ))}
          </div>
          {selectedRoom && (
            <button
              type="button"
              className="app__selection"
              onClick={() => setOpenRoom(selectedRoom)}
            >
              {selectedRoom.shortName ?? selectedRoom.name}
              <span>Details</span>
            </button>
          )}
        </div>
      </header>

      <main className={`app__main${nav ? ' app__main--navigating' : ''}`}>
        <MapView
          pins={pins}
          onOpenPin={handleOpenPin}
          selectedRoomId={selectedRoomId}
          onSelectRoom={handleSelectRoom}
          onOpenRoom={setOpenRoom}
          focusRequest={focusRequest}
          basemapId={basemapId}
          eventCounts={eventCounts}
          showAmenities={showAmenities}
          levels={levels}
          openVenueId={openVenueId}
          onOpenVenue={openVenue}
          picking={picking}
          onPickPlace={handlePickPlace}
          route={route}
          deviceFix={device.fix}
        />
        <Legend showAmenities={showAmenities} onToggleAmenities={() => setShowAmenities((on) => !on)} />
        <FloorPicker
          venueId={openVenueId}
          level={(openVenueId && (levels[openVenueId] ?? defaultLevel(openVenueId))) ?? null}
          onPick={handlePickFloor}
        />
        {nav && (
          <NavPanel
            from={nav.from}
            to={nav.to}
            editing={editing}
            pickingOnMap={picking}
            covered={!!openRoom}
            device={device}
            route={route}
            progress={followed.progress}
            events={eventSearchIndex}
            onEdit={setEditing}
            onSet={handleSetNavPlace}
            onPickOnMap={setPickOnMap}
            onSwap={() => setNav((current) => (current ? { from: current.to, to: current.from } : current))}
            onClose={handleCloseNav}
          />
        )}
      </main>

      {openRoom && (
        <RoomDialog
          room={openRoom}
          events={openRoomEvents}
          feedStatus={status}
          sourceUrl={feed?.source.url ?? SOURCE_URL}
          nowMs={nowMs}
          onClose={() => setOpenRoom(null)}
          onZoomToRoom={handleZoomToRoom}
          onNavigateToRoom={handleNavigateToRoom}
        />
      )}
    </div>
  );
}
