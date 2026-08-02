import { useCallback, useEffect, useMemo, useState } from 'react';
import { FloorPicker } from './components/FloorPicker';
import { Legend } from './components/Legend';
import { MapView } from './components/MapView';
import { RoomDialog } from './components/RoomDialog';
import { SearchBar } from './components/SearchBar';
import { ROOMS_BY_ID, defaultLevel, type Room } from './data/venues';
import { BASEMAPS, BASEMAP_IDS, type BasemapId } from './data/basemaps';
import { useEventFeed } from './hooks/useEventFeed';
import { isHappeningAt } from './data/events';

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
  const [venueInView, setVenueInView] = useState<string | null>(null);

  const { status, feed, index } = useEventFeed();

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

  const liveCount = useMemo(() => {
    if (!index) return 0;
    let total = 0;
    for (const events of index.byRoom.values()) {
      total += events.filter((event) => isHappeningAt(event, nowMs)).length;
    }
    return total;
  }, [index, nowMs]);

  // Going to a room means going to its floor, however you got there: the room
  // is on the 3rd and drawing it over the 1st would put it in the wrong
  // building's worth of walls.
  const showRoomsFloor = useCallback((room: Room) => {
    setLevels((current) =>
      current[room.venueId] === room.level ? current : { ...current, [room.venueId]: room.level },
    );
  }, []);

  const handleSelectRoom = useCallback(
    (roomId: string | null) => {
      setSelectedRoomId(roomId);
      const room = roomId ? ROOMS_BY_ID[roomId] : undefined;
      if (room) showRoomsFloor(room);
    },
    [showRoomsFloor],
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
    (room: Room) => {
      setSelectedRoomId(room.id);
      showRoomsFloor(room);
      setFocusRequest({ room, token: Date.now() });
      setOpenRoom(room);
    },
    [showRoomsFloor],
  );

  const selectedRoom = selectedRoomId ? ROOMS_BY_ID[selectedRoomId] : undefined;

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

        <SearchBar index={index} onPick={handlePickSearchResult} />

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

      <main className="app__main">
        <MapView
          selectedRoomId={selectedRoomId}
          onSelectRoom={handleSelectRoom}
          onOpenRoom={setOpenRoom}
          focusRequest={focusRequest}
          basemapId={basemapId}
          eventCounts={eventCounts}
          showAmenities={showAmenities}
          levels={levels}
          onVenueInView={setVenueInView}
        />
        <Legend showAmenities={showAmenities} onToggleAmenities={() => setShowAmenities((on) => !on)} />
        <FloorPicker
          venueId={venueInView}
          level={(venueInView && (levels[venueInView] ?? defaultLevel(venueInView))) ?? null}
          onPick={handlePickFloor}
        />
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
        />
      )}
    </div>
  );
}
