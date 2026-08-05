import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import {
  CATEGORY_STYLES,
  ROOMS,
  ROOMS_BY_ID,
  VENUES,
  VENUES_BY_ID,
  defaultLevel,
  planDetail,
  roomBounds,
  roomShapes,
  venueBounds,
  venueOutline,
  type Room,
  type Venue,
} from '../data/venues';
import { PLAN_CREDIT, PLAN_LEVELS, type PlanRing } from '../data/plan-geometry';
import { BASEMAPS, type BasemapId } from '../data/basemaps';
import { AMENITIES } from '../data/amenities';
import { placeKey, type DeviceFix, type NavPlace, type RouteSummary } from '../data/navigation';

interface Props {
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string | null) => void;
  onOpenRoom: (room: Room) => void;
  focusRequest: { room: Room; token: number } | null;
  basemapId: BasemapId;
  /** Rooms with at least one event, for the "has events" map badge. */
  eventCounts: Map<string, number>;
  showAmenities: boolean;
  /** The floor each building is showing, where it isn't showing its lowest. */
  levels: Record<string, string>;
  /** The building the map is looking at, so the floor picker knows whose floors to offer. */
  onVenueInView: (venueId: string | null) => void;
  /**
   * The next click picks a place for a route rather than selecting a room. A
   * room click means that room; anywhere else means that point.
   */
  picking: boolean;
  onPickPlace: (place: NavPlace) => void;
  /** The route to draw, once both of its ends are known. */
  route: RouteSummary | null;
  /** Where the device says it is, drawn whenever a route is asking for it. */
  deviceFix: DeviceFix | null;
}

/** Label visibility: room names only make sense once you're zoomed into a venue. */
const ROOM_LABEL_MIN_ZOOM = 16;

/**
 * A label is only drawn once its room is big enough on screen to hold one.
 *
 * The zoom threshold alone isn't enough: a floor of single-table rooms — the
 * Marriott's ten state and city rooms, Union Station's eleven railroad rooms —
 * puts a dozen labels into a space that fits two, and they pile up on top of
 * each other. Sizing the test in screen pixels means the big halls stay
 * labelled at the zoom you see the whole campus at, and the small rooms name
 * themselves as you zoom into the building they're in.
 */
const LABEL_MIN_PIXELS = { width: 38, height: 12 };

function roomFitsLabel(map: L.Map, room: Room) {
  const [nw, se] = roomBounds(room);
  const a = map.latLngToLayerPoint([nw.lat, nw.lng]);
  const b = map.latLngToLayerPoint([se.lat, se.lng]);
  return (
    Math.abs(b.x - a.x) >= LABEL_MIN_PIXELS.width &&
    Math.abs(b.y - a.y) >= LABEL_MIN_PIXELS.height
  );
}

function toLatLngBounds([nw, se]: ReturnType<typeof roomBounds>) {
  return L.latLngBounds([nw.lat, nw.lng], [se.lat, se.lng]);
}

/** OSM footprint and plan rings are both [latitude, longitude] — Leaflet's order. */
function toLatLngs(ring: Venue['footprint'] | PlanRing) {
  return ring.map(([lat, lng]) => L.latLng(lat, lng));
}

/**
 * The floor of a building the map is drawing.
 *
 * Every building starts on its lowest floor and stays there until something
 * changes it — the floor picker, or opening a room upstairs. Buildings hold
 * their floor independently, so reading the JW's 3rd doesn't move the Hyatt.
 */
function levelOf(venueId: string, levels: Record<string, string>) {
  return levels[venueId] ?? defaultLevel(venueId);
}

/** The same floor, named as its plan sheet names it — only the drawn buildings have these. */
function planLevelOf(venueId: string, levels: Record<string, string>) {
  const sheets = PLAN_LEVELS[venueId] ?? [];
  const showing = levelOf(venueId, levels);
  return showing && sheets.includes(showing) ? showing : sheets[0];
}

/**
 * Which building the map is looking at, for the floor picker to offer floors of.
 *
 * The one under the middle of the screen, which is where you point a map at
 * what you want; failing that, the one filling most of it, so a building you
 * have zoomed into but framed off-centre still counts. Below `SHARE` of the
 * view nothing is being looked at in particular and the picker stays away.
 */
const SHARE = 0.12;

function venueInView(map: L.Map): string | null {
  const view = map.getBounds();
  const centre = map.getCenter();
  const viewArea = (view.getNorth() - view.getSouth()) * (view.getEast() - view.getWest());

  let best: { id: string; share: number } | null = null;
  for (const venue of VENUES) {
    const [nw, se] = venueBounds(venue);
    const bounds = L.latLngBounds([se.lat, nw.lng], [nw.lat, se.lng]);
    if (bounds.contains(centre)) return venue.id;

    const lat = Math.min(bounds.getNorth(), view.getNorth()) - Math.max(bounds.getSouth(), view.getSouth());
    const lng = Math.min(bounds.getEast(), view.getEast()) - Math.max(bounds.getWest(), view.getWest());
    if (lat <= 0 || lng <= 0) continue;
    const share = (lat * lng) / viewArea;
    if (!best || share > best.share) best = { id: venue.id, share };
  }
  return best && best.share >= SHARE ? best.id : null;
}

export function MapView({
  selectedRoomId,
  onSelectRoom,
  onOpenRoom,
  focusRequest,
  basemapId,
  eventCounts,
  showAmenities,
  levels,
  onVenueInView,
  picking,
  onPickPlace,
  route,
  deviceFix,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  // Rectangle and Polygon both, since whole-venue rooms are drawn as outlines.
  const roomLayersRef = useRef(new Map<string, L.Path>());

  // Latest callbacks, so the one-time map setup never captures a stale closure.
  // `picking` rides along for the same reason: the room click handlers are
  // bound once, and have to read whether a route is asking for a place *now*.
  const handlers = useRef({ onSelectRoom, onOpenRoom, onPickPlace, picking });
  handlers.current = { onSelectRoom, onOpenRoom, onPickPlace, picking };

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

    // A route is the thing you are following, so nothing on the map may cover
    // it — above the room labels in the tooltip pane (650), below the popups
    // (700). Nothing in it is clickable.
    map.createPane('route');
    const routePane = map.getPane('route');
    if (routePane) {
      routePane.style.zIndex = '675';
      routePane.style.pointerEvents = 'none';
    }

    map.fitBounds(allBounds, { padding: [40, 40] });
    map.on('click', (event) => {
      if (handlers.current.picking) {
        handlers.current.onPickPlace({
          kind: 'point',
          position: { lat: event.latlng.lat, lng: event.latlng.lng },
        });
        return;
      }
      handlers.current.onSelectRoom(null);
    });

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

  /* ------------------------------------------------------- building in view */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const report = () => onVenueInView(venueInView(map));
    report();
    map.on('moveend zoomend', report);
    return () => {
      map.off('moveend zoomend', report);
    };
  }, [onVenueInView]);

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

    const layers: L.Layer[] = [];

    for (const venue of VENUES) {
      const level = planLevelOf(venue.id, levels);
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
  }, [levels]);

  /* ------------------------------------------------------------- amenities */
  /*
   * Restrooms, as markers rather than shapes: the convention centre's are real
   * outlines off its plans, but everywhere else they are a pictogram's
   * position, and drawing those at different fidelities would imply a
   * precision the second sort doesn't have. A mark says "here" either way.
   *
   * They follow the same floor rule as the rooms — an amenity on a floor you
   * aren't looking at would be a direction to a toilet on the wrong storey.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !showAmenities) return;

    const layers: L.Layer[] = [];

    for (const amenity of AMENITIES) {
      if (amenity.level !== levelOf(amenity.venueId, levels)) continue;
      const marker = L.marker([amenity.position.lat, amenity.position.lng], {
        icon: L.divIcon({
          className: `map__amenity map__amenity--${amenity.kind}`,
          html: amenity.kind === 'restroom' ? '<span>WC</span>' : '<span>💧</span>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        interactive: true,
        keyboard: false,
      });
      marker.bindTooltip(amenity.kind === 'restroom' ? 'Restrooms' : 'Water', {
        direction: 'top',
        className: 'map__amenity-tip',
      });
      marker.addTo(map);
      layers.push(marker);
    }

    return () => {
      for (const layer of layers) layer.remove();
    };
  }, [showAmenities, levels]);

  /* ------------------------------------------------------- venues and rooms */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const layers: L.Layer[] = [];

    // Venue outlines: traced from the building's own floor plans where there
    // are any, and otherwise the real footprint straight from OpenStreetMap.
    for (const venue of VENUES) {
      const outline = L.polygon(toLatLngs(venueOutline(venue)), {
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
            ? L.polygon(toLatLngs(venueOutline(VENUES_BY_ID[room.venueId])), shape)
            : L.rectangle(toLatLngBounds(roomBounds(room)), shape);

      shapeLayer.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        // While a route is asking for a place, a room is that place: picking
        // one shouldn't also change what the map has selected underneath.
        if (handlers.current.picking) {
          handlers.current.onPickPlace({ kind: 'room', roomId: room.id });
          return;
        }
        handlers.current.onSelectRoom(room.id);
      });
      shapeLayer.on('dblclick', (event) => {
        L.DomEvent.stopPropagation(event);
        if (handlers.current.picking) return;
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
   * they are. So only the floor the building is showing is drawn properly, and
   * the rest are left as ghosts — faint enough not to read as rooms, present
   * enough to say there is more here than one storey.
   */
  const hiddenByFloor = (room: Room) => room.level !== levelOf(room.venueId, levels);

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
        if (hiddenByFloor(room)) continue;
        // The room you've picked always names itself, however small it is.
        if (room.id !== selectedRoomId && (!showLabels || !roomFitsLabel(map, room))) continue;

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
  }, [eventCounts, selectedRoomId, levels]);

  useEffect(() => {
    for (const [roomId, layer] of roomLayersRef.current) {
      const room = ROOMS_BY_ID[roomId];
      const element = layer.getElement();
      element?.classList.toggle('map__room--selected', roomId === selectedRoomId);
      element?.classList.toggle('map__room--other-floor', room ? hiddenByFloor(room) : false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomId, levels]);

  /* -------------------------------------------------------- focus requests */
  const focusToken = focusRequest?.token ?? null;
  useEffect(() => {
    const map = mapRef.current;
    const room = focusRequest?.room;
    if (!map || !room) return;
    map.flyToBounds(toLatLngBounds(roomBounds(room)), { padding: [80, 80], maxZoom: 20 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  /* ---------------------------------------------------------- your position */
  /*
   * Drawn whenever a route is asking for it, whether or not it is an end of
   * one: seeing where the device thinks you are is how you tell whether to
   * trust the line. The halo is the accuracy the browser reports, which indoors
   * is often tens of metres, and drawing it stops a confident-looking dot from
   * claiming a precision it hasn't got.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !deviceFix) return;

    const at = L.latLng(deviceFix.position.lat, deviceFix.position.lng);
    const halo = L.circle(at, {
      radius: deviceFix.accuracy,
      className: 'map__device-halo',
      pane: 'route',
      interactive: false,
    }).addTo(map);
    const dot = L.marker(at, {
      icon: L.divIcon({ className: 'map__device', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      pane: 'route',
      interactive: false,
      keyboard: false,
    }).addTo(map);

    return () => {
      halo.remove();
      dot.remove();
    };
  }, [deviceFix]);

  /* ---------------------------------------------------------------- routes */
  /*
   * A dashed line and two marks. Dashed on purpose: a solid line along a road
   * is a route somebody surveyed, and this is a bearing between two points.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route) return;

    const from = L.latLng(route.fromAt.lat, route.fromAt.lng);
    const to = L.latLng(route.toAt.lat, route.toAt.lng);
    const layers: L.Layer[] = [];

    layers.push(
      L.polyline([from, to], {
        className: 'map__route',
        dashArray: '3 10',
        weight: 4,
        pane: 'route',
        interactive: false,
      }).addTo(map),
    );

    const endpoint = (at: L.LatLng, kind: 'start' | 'end', label: string) =>
      L.marker(at, {
        icon: L.divIcon({
          className: `map__route-end map__route-end--${kind}`,
          html: `<span>${label}</span>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
        pane: 'route',
        interactive: false,
        keyboard: false,
      }).addTo(map);

    // Where you are standing is already the device dot; a second mark on top of
    // it would just be two marks in one place.
    if (route.from.kind !== 'device') layers.push(endpoint(from, 'start', 'A'));
    if (route.to.kind !== 'device') layers.push(endpoint(to, 'end', 'B'));

    return () => {
      for (const layer of layers) layer.remove();
    };
  }, [route]);

  /*
   * Frame a route when it is first drawn, and when either end changes — but not
   * when a device fix merely moves, or the map would haul itself back into
   * position every few seconds while you were trying to read it.
   */
  const routeKey = route ? `${placeKey(route.from)}|${placeKey(route.to)}` : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route) return;
    map.flyToBounds(L.latLngBounds([route.fromAt.lat, route.fromAt.lng], [route.toAt.lat, route.toAt.lng]), {
      padding: [70, 70],
      maxZoom: 19,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  return (
    <div className={`map${picking ? ' map--picking' : ''}`}>
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
