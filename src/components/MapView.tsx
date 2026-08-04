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
import { CONNECTIONS, type Line } from '../data/connections';

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
function toLatLngs(ring: Venue['footprint'] | PlanRing | Line) {
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
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const labelLayerRef = useRef<L.TileLayer | null>(null);
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
      // Leaflet draws vectors into one SVG sized to the screen plus a margin,
      // and redraws it only when a drag ends. At the stock margin of a tenth of
      // the screen, a drag of any length runs off the edge of what was drawn
      // and rooms vanish until you let go. The whole campus is a few hundred
      // shapes, so a margin of six-tenths — over three times the area — costs
      // little and outruns any drag.
      renderer: L.svg({ padding: 0.6 }),
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

    // The skywalks cross over the streets and over the rooms either side of
    // them, so they are drawn over both — above the overlays (400), below the
    // markers (600).
    map.createPane('connections');
    const connectionPane = map.getPane('connections');
    if (connectionPane) connectionPane.style.zIndex = '450';

    // Street names belong on top of the buildings, not under them. Everything
    // this app draws is opaque enough to bury the basemap's own labels, and a
    // map you can't read the streets off is no use for getting anywhere — so
    // the labels are drawn again above the lot, in a pane of their own above
    // the overlays (400) and the markers (600).
    map.createPane('labels');
    const labelPane = map.getPane('labels');
    if (labelPane) {
      labelPane.style.zIndex = '650';
      labelPane.style.pointerEvents = 'none';
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
    labelLayerRef.current?.remove();

    const layer = L.tileLayer(basemap.url, {
      attribution: basemap.attribution,
      maxZoom: 21,
      // Real tiles usually stop around z19–20; keep zooming by upscaling the
      // last real tile rather than showing blank squares.
      maxNativeZoom: basemap.maxNativeZoom,
      subdomains: basemap.subdomains ?? 'abc',
      // The id class is what lets one tileset be pushed harder than another —
      // see `.map__tiles--dark`, whose streets need it.
      className: `map__tiles map__tiles--${basemap.id}`,
      // A ring of tiles either side of the screen, so a drag runs onto tiles
      // that are already there instead of onto blank squares.
      keepBuffer: 4,
    });
    layer.addTo(map);
    layer.bringToBack();
    tileLayerRef.current = layer;

    const labels = L.tileLayer(basemap.labelsUrl, {
      maxZoom: 21,
      maxNativeZoom: basemap.maxNativeZoom,
      subdomains: basemap.subdomains ?? 'abc',
      // Not the id class: the writing is already legible and doesn't want
      // whatever is being done to the map underneath it.
      className: 'map__tiles',
      pane: 'labels',
      keepBuffer: 4,
    });
    labels.addTo(map);
    labelLayerRef.current = labels;
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

  /* ----------------------------------------------------------- connections */
  /*
   * Skywalks and the tunnel: how you get between buildings in August without
   * going outside, and the one thing about this campus a street map can't tell
   * you. Drawn once and left alone — they belong to no floor, and they don't
   * change when the map does.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const layers: L.Layer[] = [];
    for (const connection of CONNECTIONS) {
      const points = toLatLngs(connection.line);
      // A casing wide enough to notice and to put a pointer on, and a dashed
      // core over it — one line drawn twice, as a map draws a path.
      const casing = L.polyline(points, {
        className: `map__link map__link--${connection.kind}`,
        pane: 'connections',
        interactive: true,
      });
      casing.bindTooltip(connection.kind === 'skywalk' ? 'Skywalk' : 'Tunnel', {
        direction: 'top',
        className: 'map__link-tip',
      });
      const core = L.polyline(points, {
        className: `map__link-core map__link--${connection.kind}`,
        pane: 'connections',
        interactive: false,
      });
      casing.addTo(map);
      core.addTo(map);
      layers.push(casing, core);
    }

    return () => {
      for (const layer of layers) layer.remove();
    };
  }, []);

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
        fillOpacity: 0.5,
        // Heavy enough to read as the wall of a room at the zoom you pick a
        // room at, and to tell two rooms sharing one apart.
        weight: 3,
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
