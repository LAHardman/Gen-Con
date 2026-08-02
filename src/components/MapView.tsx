import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import {
  CATEGORY_STYLES,
  CONNECTIONS,
  ROOMS,
  ROOMS_BY_ID,
  VENUES,
  VENUES_BY_ID,
  roomBounds,
  venueBounds,
  type Room,
  type Venue,
} from '../data/venues';
import { boundsCentre } from '../utils/geo';
import { BASEMAPS, type BasemapId } from '../data/basemaps';
import type { Floorplan } from '../hooks/useFloorplans';

interface Props {
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string | null) => void;
  onOpenRoom: (room: Room) => void;
  focusRequest: { room: Room; token: number } | null;
  basemapId: BasemapId;
  /** Rooms with at least one event, for the "has events" map badge. */
  eventCounts: Map<string, number>;
  /**
   * Real floor plans to draw over the basemap, one per venue that has any.
   * Empty unless public/floorplans.json lists some.
   */
  floorplans: Array<{ venueId: string; plan: Floorplan }>;
}

/** Label visibility: room names only make sense once you're zoomed into a venue. */
const ROOM_LABEL_MIN_ZOOM = 16;

function toLatLngBounds([nw, se]: ReturnType<typeof roomBounds>) {
  return L.latLngBounds([nw.lat, nw.lng], [se.lat, se.lng]);
}

/** OSM footprint rings are already [latitude, longitude], which is Leaflet's order. */
function toLatLngs(footprint: Venue['footprint']) {
  return footprint.map(([lat, lng]) => L.latLng(lat, lng));
}

export function MapView({
  selectedRoomId,
  onSelectRoom,
  onOpenRoom,
  focusRequest,
  basemapId,
  eventCounts,
  floorplans,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  // Rectangle and Polygon both, since whole-venue rooms are drawn as outlines.
  const roomLayersRef = useRef(new Map<string, L.Path>());
  const floorplanRef = useRef<L.ImageOverlay[]>([]);

  // Latest callbacks, so the one-time map setup never captures a stale closure.
  const handlers = useRef({ onSelectRoom, onOpenRoom });
  handlers.current = { onSelectRoom, onOpenRoom };

  const allBounds = useMemo(() => {
    const bounds = L.latLngBounds([]);
    for (const venue of VENUES) bounds.extend(toLatLngBounds(venueBounds(venue)));
    return bounds;
  }, []);

  /* ------------------------------------------------------------ map creation */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      // Double-click is reserved for opening room details, so it must not zoom.
      doubleClickZoom: false,
      // Leaflet's own gesture handling covers all three platforms: drag to pan,
      // wheel to zoom on desktop, pinch to zoom on touch.
      dragging: true,
      scrollWheelZoom: true,
      touchZoom: true,
      maxZoom: 21,
      minZoom: 13,
    });

    // Floor plans belong under the rooms drawn on top of them. Leaflet puts
    // images and vectors in the same pane, in insertion order, so they need a
    // pane of their own between the tiles (200) and the overlays (400).
    map.createPane('floorplan');
    const floorplanPane = map.getPane('floorplan');
    if (floorplanPane) {
      floorplanPane.style.zIndex = '350';
      floorplanPane.style.pointerEvents = 'none';
    }

    map.fitBounds(allBounds, { padding: [40, 40] });
    map.on('click', () => handlers.current.onSelectRoom(null));

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: true, metric: true }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      roomLayersRef.current.clear();
    };
  }, [allBounds]);

  /* --------------------------------------------------------------- basemap */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const basemap = BASEMAPS[basemapId] ?? BASEMAPS.dark;
    tileLayerRef.current?.remove();
    const layer = L.tileLayer(basemap.url, {
      attribution: basemap.attribution,
      maxZoom: 21,
      // Real tiles usually stop around z19–20; keep zooming by upscaling the
      // last real tile rather than showing blank squares.
      maxNativeZoom: basemap.maxNativeZoom,
      subdomains: basemap.subdomains ?? 'abc',
      className: basemap.filtered ? 'map__tiles map__tiles--filtered' : 'map__tiles',
    });
    layer.addTo(map);
    layer.bringToBack();
    tileLayerRef.current = layer;
  }, [basemapId]);

  /* ------------------------------------------------- optional floor-plan image */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const layer of floorplanRef.current) layer.remove();
    floorplanRef.current = [];

    for (const { venueId, plan } of floorplans) {
      const venue = VENUES_BY_ID[venueId];
      if (!venue) continue;

      // A plan's own corners when it has them — a drawing rarely stops exactly
      // at the building's outline — falling back to the footprint's bounds.
      const corners = plan.bounds;
      const bounds = corners
        ? L.latLngBounds([corners.north, corners.west], [corners.south, corners.east])
        : toLatLngBounds(venueBounds(venue));

      const overlay = L.imageOverlay(plan.url, bounds, {
        opacity: plan.opacity ?? 0.85,
        interactive: false,
        pane: 'floorplan',
        className: 'map__floorplan',
        // Somebody else's drawing: name whoever made it, next to the basemap's.
        attribution: plan.credit ? `Floor plan: ${plan.credit}` : undefined,
      });
      overlay.addTo(map);
      floorplanRef.current.push(overlay);
    }
  }, [floorplans]);

  /* ------------------------------------------------------- venues and rooms */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const layers: L.Layer[] = [];

    // Skywalk links between venues, drawn under everything else.
    for (const link of CONNECTIONS) {
      const from = VENUES_BY_ID[link.from];
      const to = VENUES_BY_ID[link.to];
      if (!from || !to) continue;
      const a = boundsCentre(venueBounds(from));
      const b = boundsCentre(venueBounds(to));
      const line = L.polyline(
        [
          [a.lat, a.lng],
          [b.lat, b.lng],
        ],
        { className: 'map__link', interactive: false },
      );
      line.addTo(map);
      layers.push(line);
    }

    // Venue outlines: the real building footprints, straight from OpenStreetMap.
    for (const venue of VENUES) {
      const outline = L.polygon(toLatLngs(venue.footprint), {
        className: 'map__venue',
        interactive: false,
      });
      outline.addTo(map);
      layers.push(outline);

      // Anchor the name to the top edge rather than binding it to the outline:
      // a tooltip bound to a shape hangs off its centre, which drops the label
      // into the middle of the building on top of its own rooms.
      const [nw, se] = venueBounds(venue);
      const label = L.tooltip({
        permanent: true,
        direction: 'top',
        className: 'map__venue-label',
        offset: [0, -4],
      })
        .setLatLng([nw.lat, (nw.lng + se.lng) / 2])
        .setContent(venue.shortName ?? venue.name);
      label.addTo(map);
      layers.push(label);
    }

    // Rooms. A room that is its whole venue takes the building's real outline;
    // the rest are rectangles in the venue's schematic interior grid.
    for (const room of ROOMS) {
      const style = CATEGORY_STYLES[room.category];
      const shape: L.PathOptions = {
        className: 'map__room',
        color: style.stroke,
        fillColor: style.fill,
        fillOpacity: 0.55,
        weight: 2,
      };
      const shapeLayer = room.fillsVenue
        ? L.polygon(toLatLngs(VENUES_BY_ID[room.venueId].footprint), shape)
        : L.rectangle(toLatLngBounds(roomBounds(room)), shape);

      shapeLayer.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        handlers.current.onSelectRoom(room.id);
      });
      shapeLayer.on('dblclick', (event) => {
        L.DomEvent.stopPropagation(event);
        handlers.current.onSelectRoom(room.id);
        handlers.current.onOpenRoom(room);
      });

      shapeLayer.addTo(map);
      layers.push(shapeLayer);
      roomLayersRef.current.set(room.id, shapeLayer);
    }

    return () => {
      for (const layer of layers) layer.remove();
      roomLayersRef.current.clear();
    };
  }, []);

  /*
   * A flat map of a building with several floors stacks them: the convention
   * centre's rooms 201-212 sit directly over 101-117, because that is where
   * they are. Selecting a room therefore drops the rest of its building's
   * floors out of the way, matching the floor plan the map draws underneath.
   */
  const hiddenByFloor = (room: Room) => {
    const selected = selectedRoomId ? ROOMS_BY_ID[selectedRoomId] : undefined;
    return Boolean(
      selected && room.venueId === selected.venueId && room.level !== selected.level,
    );
  };

  /* ----------------------------------------------- labels, counts, selection */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyLabels = () => {
      const showLabels = map.getZoom() >= ROOM_LABEL_MIN_ZOOM;
      for (const room of ROOMS) {
        const layer = roomLayersRef.current.get(room.id);
        if (!layer) continue;

        layer.unbindTooltip();
        if (!showLabels || hiddenByFloor(room)) continue;

        const count = eventCounts.get(room.id) ?? 0;
        const label = room.shortName ?? room.name;
        layer.bindTooltip(
          count > 0
            ? `<span class="map__room-name">${label}</span><span class="map__room-count">${count}</span>`
            : `<span class="map__room-name">${label}</span>`,
          {
            permanent: true,
            direction: 'center',
            className: 'map__room-label',
            opacity: 1,
          },
        );
      }
    };

    applyLabels();
    map.on('zoomend', applyLabels);
    return () => {
      map.off('zoomend', applyLabels);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventCounts, selectedRoomId]);

  useEffect(() => {
    for (const [roomId, layer] of roomLayersRef.current) {
      const room = ROOMS_BY_ID[roomId];
      const element = layer.getElement();
      element?.classList.toggle('map__room--selected', roomId === selectedRoomId);
      element?.classList.toggle('map__room--other-floor', room ? hiddenByFloor(room) : false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomId]);

  /* -------------------------------------------------------- focus requests */
  const focusToken = focusRequest?.token ?? null;
  useEffect(() => {
    const map = mapRef.current;
    const room = focusRequest?.room;
    if (!map || !room) return;
    map.flyToBounds(toLatLngBounds(roomBounds(room)), { padding: [80, 80], maxZoom: 20 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  return (
    <div className="map">
      <div
        ref={containerRef}
        className="map__canvas"
        role="application"
        aria-label="Gen Con venue map. Drag to pan, scroll or pinch to zoom, double-click a room for details."
      />
      <button
        type="button"
        className="map__fit"
        onClick={() => mapRef.current?.fitBounds(allBounds, { padding: [40, 40] })}
      >
        Fit all venues
      </button>
    </div>
  );
}

export { ROOMS_BY_ID };
