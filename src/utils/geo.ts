/**
 * Conversions between real-world coordinates and the building-local layouts
 * used to position rooms.
 *
 * Each venue is anchored to a real latitude/longitude with a real size in
 * metres. Rooms inside it are authored in a simple local grid, which keeps the
 * floor layout readable and editable, and are projected onto the map from that
 * anchor. Correcting a venue's position on the real map is therefore a change
 * to one anchor, not to every room inside it.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** A rectangle in a venue's local layout grid. */
export interface LocalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a venue sits in the world: its north-west corner and its real size. */
export interface VenueAnchor {
  nw: LatLng;
  widthMetres: number;
  heightMetres: number;
}

/** Metres per degree of latitude. Constant enough at city scale. */
export const METRES_PER_DEGREE_LAT = 111_320;

/** Metres per degree of longitude, which narrows as you move away from the equator. */
function metresPerDegreeLng(lat: number) {
  return METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
}

export function offsetLatLng(origin: LatLng, eastMetres: number, southMetres: number): LatLng {
  return {
    lat: origin.lat - southMetres / METRES_PER_DEGREE_LAT,
    lng: origin.lng + eastMetres / metresPerDegreeLng(origin.lat),
  };
}

/**
 * Projects a rectangle from a venue's local grid onto real coordinates.
 * `container` is the venue's own rectangle in that same local grid, which
 * defines what "full width/height of the venue" means.
 */
export function localRectToBounds(
  rect: LocalRect,
  container: LocalRect,
  anchor: VenueAnchor,
): [LatLng, LatLng] {
  const left = (rect.x - container.x) / container.width;
  const right = (rect.x + rect.width - container.x) / container.width;
  const top = (rect.y - container.y) / container.height;
  const bottom = (rect.y + rect.height - container.y) / container.height;

  return [
    offsetLatLng(anchor.nw, left * anchor.widthMetres, top * anchor.heightMetres),
    offsetLatLng(anchor.nw, right * anchor.widthMetres, bottom * anchor.heightMetres),
  ];
}

/** Great-circle-ish distance in metres. Flat-earth is fine over a few city blocks. */
export function distanceMetres(a: LatLng, b: LatLng) {
  const east = (b.lng - a.lng) * metresPerDegreeLng((a.lat + b.lat) / 2);
  const south = (a.lat - b.lat) * METRES_PER_DEGREE_LAT;
  return Math.hypot(east, south);
}

/** Rough walking time, at an unhurried convention-crowd pace. */
export function walkingMinutes(metres: number) {
  const METRES_PER_MINUTE = 70;
  return Math.max(1, Math.round(metres / METRES_PER_MINUTE));
}
