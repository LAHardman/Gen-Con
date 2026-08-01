import { useCallback, useEffect, useState } from 'react';
import { Legend } from './components/Legend';
import { MapView } from './components/MapView';
import { RoomDialog } from './components/RoomDialog';
import { ROOMS_BY_ID, type Room } from './data/mapData';

const HINT_DISMISSED_KEY = 'genCon.hintDismissed';

/** Coarse pointers (touch) get the pinch/tap wording, everything else mouse wording. */
function usesTouch() {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

export default function App() {
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [openRoom, setOpenRoom] = useState<Room | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ room: Room; token: number } | null>(null);
  const [hintVisible, setHintVisible] = useState(false);

  useEffect(() => {
    try {
      setHintVisible(window.localStorage.getItem(HINT_DISMISSED_KEY) !== '1');
    } catch {
      // Private browsing can block storage; showing the hint is the safe default.
      setHintVisible(true);
    }
  }, []);

  const dismissHint = useCallback(() => {
    setHintVisible(false);
    try {
      window.localStorage.setItem(HINT_DISMISSED_KEY, '1');
    } catch {
      // Non-fatal: the hint simply returns next visit.
    }
  }, []);

  const handleZoomToRoom = useCallback((room: Room) => {
    setFocusRequest({ room, token: Date.now() });
    setOpenRoom(null);
  }, []);

  const selectedRoom = selectedRoomId ? ROOMS_BY_ID[selectedRoomId] : undefined;

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__logo" aria-hidden="true">
            20
          </span>
          <div>
            <h1>Gen Con Trip</h1>
            <p>Venue map</p>
          </div>
        </div>
        {selectedRoom && (
          <button
            type="button"
            className="app__selection"
            onClick={() => setOpenRoom(selectedRoom)}
          >
            {selectedRoom.name}
            <span>Details</span>
          </button>
        )}
      </header>

      <main className="app__main">
        <MapView
          selectedRoomId={selectedRoomId}
          onSelectRoom={setSelectedRoomId}
          onOpenRoom={setOpenRoom}
          focusRequest={focusRequest}
        />
        <Legend />

        {hintVisible && (
          <div className="hint" role="note">
            <span>
              {usesTouch()
                ? 'Drag to pan · pinch to zoom · double-tap a room for details'
                : 'Drag to pan · scroll wheel to zoom · double-click a room for details'}
            </span>
            <button type="button" onClick={dismissHint} aria-label="Dismiss hint">
              ✕
            </button>
          </div>
        )}
      </main>

      {openRoom && (
        <RoomDialog
          room={openRoom}
          onClose={() => setOpenRoom(null)}
          onZoomToRoom={handleZoomToRoom}
        />
      )}
    </div>
  );
}
