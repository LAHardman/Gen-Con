import { useCallback, useEffect, useMemo, useState } from 'react';
import { Legend } from './components/Legend';
import { MapView } from './components/MapView';
import { RoomDialog } from './components/RoomDialog';
import { ROOMS_BY_ID, type Room } from './data/venues';
import { BASEMAPS, BASEMAP_IDS, type BasemapId } from './data/basemaps';
import { useEventFeed } from './hooks/useEventFeed';
import { activeFloorplans, useFloorplans } from './hooks/useFloorplans';
import { isHappeningAt } from './data/events';

const SOURCE_URL = 'https://gencon.eventdb.us/';
const BASEMAP_KEY = 'genCon.basemap';

export default function App() {
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [openRoom, setOpenRoom] = useState<Room | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ room: Room; token: number } | null>(null);
  const [basemapId, setBasemapId] = useState<BasemapId>('dark');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const { status, feed, index } = useEventFeed();

  // Real floor plans, where any have been supplied. Every building that has one
  // shows it straight away; selecting a room only changes which floor of that
  // building is drawn.
  const floorplanManifest = useFloorplans();

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

  const handleZoomToRoom = useCallback((room: Room) => {
    setFocusRequest({ room, token: Date.now() });
    setOpenRoom(null);
  }, []);

  const selectedRoom = selectedRoomId ? ROOMS_BY_ID[selectedRoomId] : undefined;

  const floorplans = useMemo(
    () =>
      activeFloorplans(
        floorplanManifest,
        selectedRoom && { venueId: selectedRoom.venueId, level: selectedRoom.level },
      ),
    [floorplanManifest, selectedRoom],
  );
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
          onSelectRoom={setSelectedRoomId}
          onOpenRoom={setOpenRoom}
          focusRequest={focusRequest}
          basemapId={basemapId}
          eventCounts={eventCounts}
          floorplans={floorplans}
        />
        <Legend />
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
