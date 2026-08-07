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
import { VENUE_HALLS } from '../data/venue-plan';
import { BASEMAPS, type BasemapId } from '../data/basemaps';
import { AMENITIES } from '../data/amenities';
import type { Pin } from '../data/offsite';
import { PLACED_BOOTHS } from '../data/booth-place';
import { METRES_PER_DEGREE_LAT } from '../utils/geo';
import { placeKey, type DeviceFix, type NavPlace, type RouteSummary } from '../data/navigation';
import { allVerticals } from '../data/vertical';
import { CONNECTIONS, connectionShown, type Line } from '../data/connections';

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
  /** The building that is open — the only one drawing an inside. */
  openVenueId: string | null;
  onOpenVenue: (venueId: string | null) => void;
  /**
   * The next click picks a place for a route rather than opening a building or
   * a room. A room click means that room; anywhere else means that point.
   */
  /** Places with an address and no room, drawn as marks. */
  pins: ReadonlyArray<{ pin: Pin; events: number }>;
  onOpenPin: (pin: Pin) => void;
  picking: boolean;
  onPickPlace: (place: NavPlace) => void;
  /** The route to draw, once both of its ends are known. */
  route: RouteSummary | null;
  /** Where the device says it is, drawn whenever a route is asking for it. */
  deviceFix: DeviceFix | null;
}

/** Label visibility: room names only make sense once you're zoomed into a venue. */
/**
 * Below this a stand is smaller than the dot standing for it, and 524 dots on
 * a four-hundred-metre building is a smear rather than a map.
 */
export const BOOTH_MIN_ZOOM = 18;
/** And below this the numbers would overprint each other. */
export const BOOTH_LABEL_ZOOM = 20;

export const ROOM_LABEL_MIN_ZOOM = 16;

/** And street names, once you are near enough a street to be walking it. */
const LABEL_MIN_ZOOM = 17;

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
export const LABEL_MIN_PIXELS = { width: 38, height: 12 };

/**
 * All `roomFitsLabel` needs of a map: where a coordinate lands on screen.
 * Narrower than `L.Map` so the rule can be asked at a scale of the caller's
 * choosing, which a map in a zero-height test container cannot provide.
 */
export interface LabelSizer {
  latLngToLayerPoint(latlng: [number, number]): { x: number; y: number };
}

export function roomFitsLabel(map: LabelSizer, room: Room) {
  const [nw, se] = roomBounds(room);
  const a = map.latLngToLayerPoint([nw.lat, nw.lng]);
  const b = map.latLngToLayerPoint([se.lat, se.lng]);
  return (
    Math.abs(b.x - a.x) >= LABEL_MIN_PIXELS.width &&
    Math.abs(b.y - a.y) >= LABEL_MIN_PIXELS.height
  );
}

/**
 * Whether this room writes its name on itself right now.
 *
 * The whole rule in one place, and separate from the effect that applies it,
 * because the effect cannot be asked: it needs a map with a size, and a test
 * container has none — every room comes out big enough at a zoom Leaflet picked
 * out of nothing. Here the zoom and the scale are given, so all three parts can
 * be checked, including the exception, which is the part that matters most:
 * the room you have tapped names itself however small it is, because you have
 * tapped it and being told what it is, is the answer.
 */
export function roomShowsLabel(
  map: LabelSizer,
  room: Room,
  { zoom, selectedRoomId }: { zoom: number; selectedRoomId: string | null },
) {
  if (room.id === selectedRoomId) return true;
  return zoom >= ROOM_LABEL_MIN_ZOOM && roomFitsLabel(map, room);
}

function toLatLngBounds([nw, se]: ReturnType<typeof roomBounds>) {
  return L.latLngBounds([nw.lat, nw.lng], [se.lat, se.lng]);
}

/** OSM footprint and plan rings are both [latitude, longitude] — Leaflet's order. */
export function toLatLngs(ring: Venue['footprint'] | PlanRing | Line) {
  return ring.map(([lat, lng]) => L.latLng(lat, lng));
}

/**
 * The floor of a building the map is drawing.
 *
 * Every building starts on its lowest floor and stays there until something
 * changes it — the floor picker, or opening a room upstairs. Buildings hold
 * their floor independently, so reading the JW's 3rd doesn't move the Hyatt.
 */
export function levelOf(venueId: string, levels: Record<string, string>) {
  return levels[venueId] ?? defaultLevel(venueId);
}

/** The same floor, named as its plan sheet names it — only the drawn buildings have these. */
function planLevelOf(venueId: string, levels: Record<string, string>) {
  const sheets = PLAN_LEVELS[venueId] ?? [];
  const showing = levelOf(venueId, levels);
  return showing && sheets.includes(showing) ? showing : sheets[0];
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
  openVenueId,
  onOpenVenue,
  pins,
  onOpenPin,
  picking,
  onPickPlace,
  route,
  deviceFix,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const labelLayerRef = useRef<L.TileLayer | null>(null);
  // Rectangle and Polygon both, since whole-venue rooms are drawn as outlines.
  const roomLayersRef = useRef(new Map<string, L.Path>());
  const venueLayersRef = useRef(new Map<string, L.Path>());

  // Latest callbacks, so the one-time map setup never captures a stale closure.
  // `picking` rides along for the same reason: the click handlers are bound
  // once, and have to read whether a route is asking for a place *now*.
  const handlers = useRef({ onSelectRoom, onOpenRoom, onOpenVenue, onPickPlace, picking });
  handlers.current = { onSelectRoom, onOpenRoom, onOpenVenue, onPickPlace, picking };

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

    // A route is the thing you are following, so nothing on the map may cover
    // it — above the street names and the room labels both, below the popups
    // (700). Nothing in it is clickable.
    map.createPane('route');
    const routePane = map.getPane('route');
    if (routePane) {
      routePane.style.zIndex = '675';
      routePane.style.pointerEvents = 'none';
    }

    map.fitBounds(allBounds, { padding: [40, 40] });
    map.on('click', (event) => {
      // While a route is asking for a place, a click on open ground is that
      // place — and must not also shut the building you are looking inside.
      if (handlers.current.picking) {
        handlers.current.onPickPlace({
          kind: 'point',
          position: { lat: event.latlng.lat, lng: event.latlng.lng },
        });
        return;
      }
      // Otherwise clicking off a building shuts it: the campus goes back to
      // outlines, which is the view you pick the next building from.
      handlers.current.onSelectRoom(null);
      handlers.current.onOpenVenue(null);
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
      // Street names arrive when you are close enough for them to mean
      // something. Over the whole campus they are a screenful of type telling
      // you what you already know — that this is downtown Indianapolis — and
      // they bury the buildings, which at that zoom is the only thing to pick.
      minZoom: LABEL_MIN_ZOOM,
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
      if (venue.id !== openVenueId) continue;
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

    // The hotels' halls, read off Gen Con's plans of them by colour. Each is a
    // polygon with holes — the circulation on a hotel floor is one connected
    // thing that runs round the rooms, so its outside alone would cover them.
    const halls = openVenueId
      ? (VENUE_HALLS[`${openVenueId}/${levelOf(openVenueId, levels)}`] ?? [])
      : [];
    for (const rings of halls) {
      const layer = L.polygon(rings.map((ring) => toLatLngs(ring)), {
        className: 'map__plan map__plan--circulation',
        pane: 'plan-detail',
        interactive: false,
      });
      layer.addTo(map);
      layers.push(layer);
    }

    return () => {
      for (const layer of layers) layer.remove();
    };
  }, [levels, openVenueId]);

  /* ----------------------------------------------------------- connections */
  /*
   * Skywalks and the tunnel: how you get between buildings in August without
   * going outside, and the one thing about this campus a street map can't tell
   * you.
   *
   * They belong to a floor, though — the network runs at the second level
   * throughout — so a span drawn across a building you have open is either the
   * way to the next hotel or a line over your head. Which it is depends on the
   * floor, so an open building draws only the spans that reach it on the floor
   * it is showing. With nothing open they all draw: that view is the campus,
   * and where the covered crossings are is the most useful thing on it.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const layers: L.Layer[] = [];
    for (const connection of CONNECTIONS) {
      if (!connectionShown(connection, openVenueId, openVenueId ? levelOf(openVenueId, levels) : undefined)) {
        continue;
      }
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
  }, [openVenueId, levels]);

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
      if (amenity.venueId !== openVenueId) continue;
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
  }, [showAmenities, levels, openVenueId]);

  /* ---------------------------------------------------------------- booths */
  /*
   * The exhibit hall as stands rather than as six halls.
   *
   * Which is the way round somebody actually needs it: the booth number is
   * printed on the stand, in the programme and on every sign in the building,
   * and the hall letter is on none of them. The halls stay underneath — they
   * are still rooms, still searchable, still where a route goes — and this
   * draws what is in them.
   *
   * Only when the convention centre is open on Level 1, and only past the zoom
   * where a stand is bigger than the mark for it. 524 marks on a campus view
   * would be a smear over four hundred metres.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || openVenueId !== 'icc' || levelOf('icc', levels) !== 'Level 1') return;

    const layers: L.Layer[] = [];
    const draw = () => {
      for (const layer of layers) layer.remove();
      layers.length = 0;
      if (map.getZoom() < BOOTH_MIN_ZOOM) return;
      const named = map.getZoom() >= BOOTH_LABEL_ZOOM;
      const seen = map.getBounds().pad(0.2);
      for (const stand of PLACED_BOOTHS) {
        if (!seen.contains([stand.lat, stand.lng])) continue;
        // The stand's own footprint, which is why a 2x9 island reads as one
        // long shape and a single booth as a square: the size is off the
        // printed map's module and is the one thing about a stand that is not
        // a fit. Half of each side either way from its middle.
        const dLat = stand.deep / 2 / METRES_PER_DEGREE_LAT;
        const dLng = stand.wide / 2 / (METRES_PER_DEGREE_LAT * Math.cos((stand.lat * Math.PI) / 180));
        const outline = L.rectangle(
          [
            [stand.lat - dLat, stand.lng - dLng],
            [stand.lat + dLat, stand.lng + dLng],
          ],
          { className: 'map__booth', interactive: false, weight: 1 },
        );
        outline.addTo(map);
        layers.push(outline);
        if (!named) continue;
        const label = L.marker([stand.lat, stand.lng], {
          icon: L.divIcon({ className: 'map__booth-name', html: `<span>${stand.booth}</span>`, iconSize: [26, 10], iconAnchor: [13, 5] }),
          interactive: false,
          keyboard: false,
        });
        label.addTo(map);
        layers.push(label);
      }
    };
    draw();
    map.on('zoomend moveend', draw);
    return () => {
      map.off('zoomend moveend', draw);
      for (const layer of layers) layer.remove();
    };
  }, [openVenueId, levels]);

  /* ------------------------------------------------------------------ pins */
  /*
   * The places with an address and no plan: a steakhouse, a ballpark, a loft.
   *
   * Drawn as a mark rather than a shape, and always — not only when a building
   * is open — because a pin belongs to no building and has no floor to be on.
   * That is the whole difference between these and a room, and the map should
   * say it rather than hide it: a mark says "here, and that is all anybody
   * knows", which is exactly true of an address.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layers: L.Layer[] = [];
    for (const { pin, events } of pins) {
      const marker = L.marker([pin.lat, pin.lng], {
        icon: L.divIcon({
          className: 'map__pin',
          html: `<span>${events > 0 ? events : ''}</span>`,
          iconSize: [20, 26],
          iconAnchor: [10, 26],
        }),
        interactive: true,
        keyboard: false,
      });
      marker.bindTooltip(pin.name, { direction: 'top', offset: [0, -22], className: 'map__pin-tip' });
      marker.on('click', () => onOpenPin(pin));
      marker.addTo(map);
      layers.push(marker);
    }
    return () => {
      for (const layer of layers) layer.remove();
    };
  }, [pins, onOpenPin]);

  /* ------------------------------------------------------- venues and rooms */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const layers: L.Layer[] = [];

    // Venue outlines: traced from the building's own floor plans where there
    // are any, and otherwise the real footprint straight from OpenStreetMap.
    // A building is what you click, so the outline is the thing that takes the
    // click — closed it is a filled shape asking to be opened, open it is a
    // line round the rooms inside it.
    for (const venue of VENUES) {
      const outline = L.polygon(toLatLngs(venueOutline(venue)), {
        className: 'map__venue',
        interactive: true,
      });
      outline.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        // While a route is asking for a place, a building is a way *in* rather
        // than an answer: what you want from it is one of the rooms inside, and
        // those aren't drawn until it opens. So this opens it and keeps asking,
        // and the next tap — on a room — is the one that answers.
        if (handlers.current.picking) {
          handlers.current.onOpenVenue(venue.id);
          map.flyToBounds(toLatLngBounds(venueBounds(venue)), { padding: [70, 70], maxZoom: 19 });
          return;
        }
        handlers.current.onSelectRoom(null);
        handlers.current.onOpenVenue(venue.id);
        // Opening a building at campus zoom would draw an interior too small to
        // read, so opening it goes there. Capped, because the smallest venues
        // would otherwise fill the screen at a zoom the basemap can't serve.
        map.flyToBounds(toLatLngBounds(venueBounds(venue)), { padding: [70, 70], maxZoom: 19 });
      });
      outline.addTo(map);
      layers.push(outline);
      venueLayersRef.current.set(venue.id, outline);

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
        // Not the room's own colour: an outline in the same hue welds a run of
        // meeting rooms into one shape. This is the map's background, drawn as
        // a seam — so where two rooms of a sort meet, you see the gap between
        // them rather than a single block with a line in it.
        color: '#141822',
        fillColor: style.fill,
        fillOpacity: 0.38,
        weight: 2.5,
      };
      const drawn = roomShapes(room);
      const shapeLayer =
        drawn.length > 0
          ? L.polygon(drawn.map((ring) => [toLatLngs(ring)]), shape)
          : room.fillsVenue
            ? L.polygon(toLatLngs(venueOutline(VENUES_BY_ID[room.venueId])), shape)
            : L.rectangle(toLatLngBounds(roomBounds(room)), shape);

      // One click opens the room. There is nothing else a room click could
      // mean, and making people find that out by double-clicking helped nobody.
      shapeLayer.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        // While a route is asking for a place, a room is that place: picking
        // one shouldn't also change what the map has selected underneath.
        if (handlers.current.picking) {
          handlers.current.onPickPlace({ kind: 'room', roomId: room.id });
          return;
        }
        handlers.current.onSelectRoom(room.id);
        handlers.current.onOpenRoom(room);
      });
      shapeLayer.on('dblclick', (event) => L.DomEvent.stopPropagation(event));

      shapeLayer.addTo(map);
      layers.push(shapeLayer);
      roomLayersRef.current.set(room.id, shapeLayer);
    }

    return () => {
      for (const layer of layers) layer.remove();
      roomLayersRef.current.clear();
      venueLayersRef.current.clear();
    };
  }, []);

  /*
   * Whether a room is drawn at all, and how.
   *
   * A building keeps its inside to itself until you open it — fourteen sets of
   * rooms over one downtown is a mess nobody can read, and at the zoom you see
   * the campus at none of them are legible anyway. So a closed building draws
   * none of its rooms.
   *
   * Within the open one, a flat map still stacks the floors: rooms 201-212 sit
   * directly over 101-117, because that is where they are. Only the floor it is
   * showing is drawn properly; the rest are ghosts, faint enough not to read as
   * rooms, present enough to say there is more here than one storey.
   */
  const roomState = (room: Room) => {
    if (room.venueId !== openVenueId) return 'closed';
    return room.level === levelOf(room.venueId, levels) ? 'shown' : 'ghost';
  };

  /* ----------------------------------------------- labels, counts, selection */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyLabels = () => {
      const zoom = map.getZoom();
      for (const room of ROOMS) {
        const layer = roomLayersRef.current.get(room.id);
        if (!layer) continue;

        layer.unbindTooltip();
        if (roomState(room) !== 'shown') continue;
        if (!roomShowsLabel(map, room, { zoom, selectedRoomId })) continue;

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
  }, [eventCounts, selectedRoomId, levels, openVenueId]);

  useEffect(() => {
    for (const [roomId, layer] of roomLayersRef.current) {
      const room = ROOMS_BY_ID[roomId];
      const state = room ? roomState(room) : 'closed';
      const element = layer.getElement();
      element?.classList.toggle('map__room--selected', roomId === selectedRoomId);
      element?.classList.toggle('map__room--other-floor', state === 'ghost');
      element?.classList.toggle('map__room--closed', state === 'closed');
    }
    for (const [venueId, layer] of venueLayersRef.current) {
      layer.getElement()?.classList.toggle('map__venue--open', venueId === openVenueId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomId, levels, openVenueId]);

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

  /* --------------------------------------------------------------- stairs */
  /*
   * Where you change floor, marked on both floors it joins.
   *
   * Drawn only inside the building you have open, because that is the only
   * building whose floors you can be on — and drawn as a ring rather than a
   * solid mark, deliberately. No source in this repository says where a
   * staircase is (see `vertical.ts`); what is known is the stretch of floor it
   * has to be on, and a ring around that stretch says "along here" where a pin
   * would say "exactly here" and be making it up.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !openVenueId) return;

    const showing = levelOf(openVenueId, levels);
    const layers: L.Layer[] = [];
    for (const link of allVerticals()) {
      if (link.venueId !== openVenueId) continue;
      if (link.from !== showing && link.to !== showing) continue;
      const other = link.from === showing ? link.to : link.from;
      const marker = L.marker([link.at.lat, link.at.lng], {
        icon: L.divIcon({
          className: 'map__stairs',
          html: '<span>⇅</span>',
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        pane: 'route',
        interactive: true,
        keyboard: false,
      });
      marker.bindTooltip(`Stairs and lifts to ${other} — somewhere along here`, {
        direction: 'top',
        className: 'map__amenity-tip',
      });
      marker.addTo(map);
      layers.push(marker);
    }

    return () => {
      for (const layer of layers) layer.remove();
    };
  }, [openVenueId, levels]);

  /* ---------------------------------------------------------------- routes */
  /*
   * A route is drawn as the legs it is made of, because they are not the same
   * kind of claim. A walk along a floor is a line over surface the plans drew,
   * and a pavement leg is a line over a footway OpenStreetMap has surveyed, so
   * both are solid. An outdoor leg is the unmapped ground between a door and
   * the kerb — a straight line across a forecourt — so it stays dashed, as the
   * whole line used to be when the whole line was a guess.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route) return;

    const layers: L.Layer[] = [];
    const legs = route.walk?.legs ?? [
      {
        kind: 'outdoor' as const,
        points: [route.fromAt, route.toAt],
        metres: route.straightMetres,
        text: '',
        venueId: undefined,
        level: undefined,
      },
    ];

    for (const leg of legs) {
      const points = leg.points.map((point) => L.latLng(point.lat, point.lng));
      if (points.length < 2) continue;
      // A leg on a floor the map isn't showing is drawn faintly rather than
      // hidden: the route goes that way whether or not you are looking at it.
      const elsewhere =
        !!leg.venueId && !!leg.level && leg.level !== levelOf(leg.venueId, levels);
      layers.push(
        L.polyline(points, {
          className: `map__route map__route--${leg.kind}${elsewhere ? ' map__route--elsewhere' : ''}`,
          dashArray: leg.kind === 'outdoor' ? '3 10' : undefined,
          weight: 5,
          pane: 'route',
          interactive: false,
        }).addTo(map),
      );
    }

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
    if (route.from.kind !== 'device') {
      layers.push(endpoint(L.latLng(route.fromAt.lat, route.fromAt.lng), 'start', 'A'));
    }
    if (route.to.kind !== 'device') {
      layers.push(endpoint(L.latLng(route.toAt.lat, route.toAt.lng), 'end', 'B'));
    }

    return () => {
      for (const layer of layers) layer.remove();
    };
  }, [route, levels]);

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
