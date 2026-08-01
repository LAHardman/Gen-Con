import { useCallback, useEffect, useState } from 'react';
import {
  BUILDINGS,
  CATEGORY_STYLES,
  CONNECTORS,
  PRIMARY_AREA,
  ROOMS,
  ROOMS_BY_ID,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type Room,
} from '../data/mapData';
import { usePanZoom, type TapInfo } from '../hooks/usePanZoom';
import { fittingFontPx } from '../utils/text';

interface Props {
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string | null) => void;
  onOpenRoom: (room: Room) => void;
  /** Set by the parent when it wants the map to frame a specific room. */
  focusRequest: { room: Room; token: number } | null;
}

/**
 * Labels are sized in *screen* pixels, not world units, so they stay legible at
 * every zoom level instead of shrinking into noise when zoomed out and
 * ballooning when zoomed in. Each one is drawn only if it actually fits inside
 * its room at the current zoom, which is what makes the map declutter itself as
 * you zoom out.
 */
const LABEL_MIN_PX = 11;
const LABEL_MAX_PX = 21;
/** Type styles, mirroring the CSS so measurement matches what gets drawn. */
const ROOM_LABEL_TYPE = { weight: 600 };
const ROOM_DETAIL_TYPE = { weight: 400, trackingEm: 0.06, uppercase: true };
const BUILDING_TYPE = { weight: 600, trackingEm: 0.14, uppercase: true };

/** Finds the room under a tap. Uses hit-testing because pointer capture retargets events. */
function roomIdAtPoint(clientX: number, clientY: number): string | null {
  const element = document.elementFromPoint(clientX, clientY);
  const owner = element?.closest('[data-room-id]');
  return owner?.getAttribute('data-room-id') ?? null;
}

export function MapView({ selectedRoomId, onSelectRoom, onOpenRoom, focusRequest }: Props) {
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);

  const handleTap = useCallback(
    (tap: TapInfo) => {
      onSelectRoom(roomIdAtPoint(tap.clientX, tap.clientY));
    },
    [onSelectRoom],
  );

  const handleDoubleTap = useCallback(
    (tap: TapInfo) => {
      const roomId = roomIdAtPoint(tap.clientX, tap.clientY);
      if (!roomId) return;
      const room = ROOMS_BY_ID[roomId];
      if (!room) return;
      onSelectRoom(roomId);
      onOpenRoom(room);
    },
    [onSelectRoom, onOpenRoom],
  );

  const { containerRef, transform, isPanning, zoomBy, fitToView, focusOnRect, handlers } =
    usePanZoom({
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
      primaryArea: PRIMARY_AREA,
      onTap: handleTap,
      onDoubleTap: handleDoubleTap,
    });

  // The parent bumps `token` each time it wants a fresh framing, so repeated
  // requests for the same room still take effect.
  const focusToken = focusRequest?.token ?? null;
  const focusRoom = focusRequest?.room ?? null;
  useEffect(() => {
    if (!focusRoom) return;
    focusOnRect(focusRoom);
    // `focusToken` is the trigger; the room is read at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  const { k } = transform;

  return (
    <div className="map">
      <div
        ref={containerRef}
        className={`map__canvas${isPanning ? ' map__canvas--panning' : ''}`}
        role="application"
        aria-label="Gen Con venue map. Drag to pan, scroll or pinch to zoom, double-click a room for details."
        {...handlers}
      >
        <svg className="map__svg" aria-hidden="false">
          <defs>
            <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
              <path d="M 80 0 L 0 0 0 80" fill="none" stroke="#1c1f2b" strokeWidth="1" />
            </pattern>
          </defs>

          <g transform={`translate(${transform.x} ${transform.y}) scale(${k})`}>
            <rect
              x={-WORLD_WIDTH}
              y={-WORLD_HEIGHT}
              width={WORLD_WIDTH * 3}
              height={WORLD_HEIGHT * 3}
              fill="url(#grid)"
            />

            {CONNECTORS.map((connector) => (
              <polyline
                key={connector.id}
                className="map__connector"
                points={connector.points.map(([x, y]) => `${x},${y}`).join(' ')}
              >
                <title>{connector.label}</title>
              </polyline>
            ))}

            {BUILDINGS.map((building) => {
              // Buildings sit shoulder to shoulder, so a label that overflows
              // its own footprint runs straight into its neighbour's.
              const namePx = Math.min(
                12,
                fittingFontPx(building.name, building.width * k - 24, BUILDING_TYPE),
              );
              const showName = namePx >= 9;
              return (
                <g key={building.id}>
                  <rect
                    className="map__building"
                    x={building.x}
                    y={building.y}
                    width={building.width}
                    height={building.height}
                    rx={building.radius ?? 16}
                  />
                  {showName && (
                    <text
                      className="map__building-label"
                      x={building.x + 12 / k}
                      y={building.y - 9 / k}
                      fontSize={namePx / k}
                    >
                      {building.name}
                    </text>
                  )}
                </g>
              );
            })}

            {ROOMS.map((room) => {
              const style = CATEGORY_STYLES[room.category];
              const isSelected = room.id === selectedRoomId;
              const isHovered = room.id === hoveredRoomId;
              const screenWidth = room.width * k;
              const screenHeight = room.height * k;
              const centerX = room.x + room.width / 2;
              const centerY = room.y + room.height / 2;

              // Bigger rooms carry bigger type, within a range that stays
              // readable and never dominates the shape. A label too wide for its
              // room shrinks to fit first and is only dropped once shrinking
              // would make it illegible.
              const label = room.shortName ?? room.name;
              const available = screenWidth - 10;
              const labelPx = Math.min(
                LABEL_MAX_PX,
                Math.max(LABEL_MIN_PX, screenWidth / 9),
                fittingFontPx(label, available, ROOM_LABEL_TYPE),
              );
              const detailPx = Math.min(
                labelPx * 0.7,
                fittingFontPx(style.label, available, ROOM_DETAIL_TYPE),
              );
              const showLabel = labelPx >= LABEL_MIN_PX && screenHeight >= labelPx * 1.6;
              const showDetail =
                showLabel && detailPx >= 9 && screenHeight >= (labelPx + detailPx) * 1.9;

              // Divide by the map scale to convert a screen size back to world
              // units, cancelling out the parent <g>'s scale().
              const labelSize = labelPx / k;
              const detailSize = detailPx / k;

              return (
                <g
                  key={room.id}
                  data-room-id={room.id}
                  className={`map__room${isSelected ? ' map__room--selected' : ''}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${room.name}, ${style.label}`}
                  onMouseEnter={() => setHoveredRoomId(room.id)}
                  onMouseLeave={() => setHoveredRoomId((id) => (id === room.id ? null : id))}
                  onFocus={() => onSelectRoom(room.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectRoom(room.id);
                      onOpenRoom(room);
                    }
                  }}
                >
                  <rect
                    className="map__room-shape"
                    x={room.x}
                    y={room.y}
                    width={room.width}
                    height={room.height}
                    rx={10}
                    fill={style.fill}
                    stroke={isSelected || isHovered ? '#f2f4f8' : style.stroke}
                  />
                  {showLabel && (
                    <text
                      className="map__room-label"
                      x={centerX}
                      y={showDetail ? centerY - detailSize * 0.7 : centerY}
                      fontSize={labelSize}
                    >
                      {label}
                    </text>
                  )}
                  {showDetail && (
                    <text
                      className="map__room-sublabel"
                      x={centerX}
                      y={centerY + labelSize * 0.85}
                      fontSize={detailSize}
                      fill={style.stroke}
                    >
                      {style.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="map__controls">
        <button type="button" onClick={() => zoomBy(1.4)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">
          &minus;
        </button>
        <button type="button" onClick={fitToView} aria-label="Fit map to screen" title="Fit to screen">
          ⤢
        </button>
      </div>

      <div className="map__zoom-readout" aria-live="off">
        {Math.round(k * 100)}%
      </div>
    </div>
  );
}
