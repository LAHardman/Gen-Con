import { useEffect, useRef } from 'react';
import { CATEGORY_STYLES, type Room } from '../data/mapData';

interface Props {
  room: Room;
  onClose: () => void;
  onZoomToRoom: (room: Room) => void;
}

/**
 * Detail pop-up for a room. Renders as a centred modal on desktop and a bottom
 * sheet on small screens (see the stylesheet), which is the shape that feels
 * native on a phone.
 */
export function RoomDialog({ room, onClose, onZoomToRoom }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const style = CATEGORY_STYLES[room.category];

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, [room.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="dialog__backdrop" onPointerDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-dialog-title"
        // Stop backdrop dismissal from firing for interactions inside the panel.
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
          {room.building} · {room.level}
        </p>

        <p className="dialog__description">{room.description}</p>

        <ul className="dialog__highlights">
          {room.highlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>

        <div className="dialog__actions">
          <button type="button" className="button button--primary" onClick={() => onZoomToRoom(room)}>
            Zoom to room
          </button>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="dialog__note">
          Layout is a schematic approximation — check the official Gen Con program for exact room
          assignments.
        </p>
      </div>
    </div>
  );
}
