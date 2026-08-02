import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import {
  CATEGORY_STYLES,
  CONNECTIONS,
  ROOMS,
  ROOMS_BY_ID,
  VENUES,
  VENUES_BY_ID,
  planDetail,
  roomBounds,
  roomShapes,
  venueBounds,
  type Room,
  type Venue,
} from '../data/venues';
import { PLAN_CREDIT, PLAN_LEVELS, type PlanRing } from '../data/plan-geometry';
import { boundsCentre } from '../utils/geo';
import { BASEMAPS, type BasemapId } from '../data/basemaps';

interface Props {
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string | null) => void;
  onOpenRoom: (room: Room) => void;
  focusRequest: { room: Room; token: number } | null;
  basemapId: BasemapId;
  /** Rooms with at least one event, for the "has events" map badge. */
  eventCounts: Map<string, number>;
}

/** Label visibility: room names only make sense once you're zoomed into a venue. */
const ROOM_LABEL_MIN_ZOOM = 16;

function toLatLngBounds([nw, se]: ReturnType<typeof roomBounds>) {
  return L.latLngBounds([nw.lat, nw.lng], [se.lat, se.lng]);
}

/** OSM footprint and plan rings are both [latitude, longitude] — Leaflet's order. */
function toLatLngs(ring: Venue['footprint'] | PlanRing) {
  return ring.map(([lat, lng]) => L.latLng(lat, lng));
}

/**
 * The floor of a building whose plan is drawn.
 *
 * Stacking every level at once turns a plan into noise, so each building shows
 * its ground floor until a room in it is selected, and then the floor that room
 * is on. Buildings other than the one selected are unaffected.
 */
function activePlanLevel(venueId: string, selected: Room | undefined) {
  const levels = PLAN_LEVELS[venueId] ?? [];
  if (selected?.venueId === venueId && levels.includes(selected.level)) return selected.level;
  return levels[0];
}

export function MapView({
  selectedRoomId,
  onSelectRoom,
  onOpenRoom,
  focusRequest,
  basemapId,
  eventCounts,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  // Rectangle and Polygon both, since whole-venue rooms are drawn as outlines.
  const roomLayersRef = useRef(new Map<string, L.Path>());

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

    // The building's fabric belongs under the rooms drawn on top of it, and
    // Leaflet puts every vector in one pane in insertion order, so it needs a
    // pane of its own between the tiles (200) and the overlays (400).
    map.createPane('plan-detail');
    const detailPane = map.getPane('plan-detail');
    if (detailPane) {
      detailPane.style.zIndex = '350';
      detailPane.style.pointerEvents = 'none';
    }

    map.fitBounds(allBounds, { padding: [40, 40] });
    map.on('click', () => handlers.current.onSelectRoom(null));

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: true, metric: true }).addTo(map);
    // The interiors are somebody else's drawings, traced rather than surveyed
    // by us: name them alongside the basemap's own credit.
    map.attributionControl.addAttribution(`Floor plans: ${PLAN_CREDIT}`);

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

  /* -------------------------------------------------- floor-plan geometry */
  /*
   * The building's own fabric, read off its official plans: prefunction halls,
   * service cores, restrooms, the airwall lines the big halls divide along, and
   * any lettered space no room claims. Drawn as map geometry in the map's own
   * palette rather than laid over it as a picture, so it sits under the rooms
   * instead of on top of the basemap.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const selected = selectedRoomId ? ROOMS_BY_ID[selectedRoomId] : undefined;
    const layers: L.Layer[] = [];

    for (const venue of VENUES) {
      const level = activePlanLevel(venue.id, selected);
      if (!level) continue;

      for (const shape of planDetail(venue.id, level)) {
        const points = toLatLngs(shape.ring);
        const options = {
          className: `map__plan map__plan--${shape.kind}`,
          pane: 'plan-detail',
          interactive: false,
        };
        // An airwall is a line across a hall, not an enclosure.
        const layer =
          shape.kind === 'divider' ? L.polyline(points, options) : L.polygon(points, options);
        layer.addTo(map);
        layers.push(layer);
      }
    }

    return () => {
      for (const layer of layers) layer.remove();
    };
  }, [selectedRoomId]);

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

    // Rooms take their real outline from the venue's floor plan where there is
    // one — several outlines, for a block of meeting rooms that share a wall. A
    // room that is its whole venue takes the building's OSM footprint. Anything
    // left is a rectangle in the venue's schematic interior grid.
    for (const room of ROOMS) {
      const style = CATEGORY_STYLES[room.category];
      const shape: L.PathOptions = {
        className: 'map__room',
        color: style.stroke,
        fillColor: style.fill,
        fillOpacity: 0.55,
        weight: 2,
      };
      const drawn = roomShapes(room);
      const shapeLayer =
        drawn.length > 0
          ? L.polygon(drawn.map((ring) => [toLatLngs(ring)]), shape)
          : room.fillsVenue
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
