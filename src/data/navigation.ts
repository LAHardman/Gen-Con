/**
 * Getting from one place on the map to another.
 *
 * Three things can be an end of a route, and they are not the same kind of
 * thing: a room is a place the map already knows, the device's position is a
 * reading that arrives late and moves, and a tapped point is a coordinate and
 * nothing else. So a place is stored as which of those it is rather than as a
 * coordinate — a room by its id, the device by nothing at all — and resolved
 * to a position only when a route is drawn. That way a device fix that updates
 * moves the route with it instead of leaving it pinned where you first stood.
 *
 * What is drawn between the two ends is a straight line, and the wording
 * everywhere says so. A real walking route across this campus runs along
 * pavements, through lobbies, and over the skywalks that join the convention
 * centre to the hotels — none of which is in this repository. A line and a
 * distance are honest about being a bearing and a range; turn-by-turn
 * directions derived from the same two points would not be.
 */

import { ROOMS_BY_ID, VENUES_BY_ID, roomBounds, type Room } from './venues';
import { distanceMetres, walkingMinutes, type LatLng } from '../utils/geo';

/** Which end of a route is being chosen. */
export type NavEnd = 'from' | 'to';

export type NavPlace =
  | { kind: 'room'; roomId: string }
  /** Wherever the device says it is, read live rather than captured. */
  | { kind: 'device' }
  /** A point tapped on the map, which names nothing. */
  | { kind: 'point'; position: LatLng };

/** A reading from the device's own positioning, with the radius it claims. */
export interface DeviceFix {
  position: LatLng;
  /** Metres. The browser's own estimate of how wrong it might be. */
  accuracy: number;
}

export const roomPlace = (room: Room): NavPlace => ({ kind: 'room', roomId: room.id });

/** The room a place is, where it is one. */
export function placeRoom(place: NavPlace | null): Room | undefined {
  return place?.kind === 'room' ? ROOMS_BY_ID[place.roomId] : undefined;
}

/**
 * Where a place is, or null when it isn't known yet — which only happens for
 * the device, before its first fix arrives or after it is refused.
 */
export function placePosition(place: NavPlace, device: DeviceFix | null): LatLng | null {
  switch (place.kind) {
    case 'room': {
      const room = ROOMS_BY_ID[place.roomId];
      if (!room) return null;
      // A room's centre. Rooms here are halls and meeting rooms rather than
      // buildings, so the middle of one is close enough to "there".
      const [nw, se] = roomBounds(room);
      return { lat: (nw.lat + se.lat) / 2, lng: (nw.lng + se.lng) / 2 };
    }
    case 'device':
      return device?.position ?? null;
    case 'point':
      return place.position;
  }
}

export function placeLabel(place: NavPlace): string {
  switch (place.kind) {
    case 'room':
      return ROOMS_BY_ID[place.roomId]?.name ?? 'Unknown room';
    case 'device':
      return 'My location';
    case 'point':
      return 'Point on the map';
  }
}

/** The line under the label: which building and floor, or a coordinate. */
export function placeDetail(place: NavPlace, device: DeviceFix | null): string {
  switch (place.kind) {
    case 'room': {
      const room = ROOMS_BY_ID[place.roomId];
      if (!room) return '';
      const venue = VENUES_BY_ID[room.venueId];
      return [venue?.shortName ?? venue?.name, room.level].filter(Boolean).join(' · ');
    }
    // With no fix there is nothing true to say here — whether one is still
    // coming, or was refused, is the device note's job rather than this line's.
    case 'device':
      return device ? `Accurate to about ${Math.round(device.accuracy)} m` : '';
    case 'point':
      return `${place.position.lat.toFixed(5)}, ${place.position.lng.toFixed(5)}`;
  }
}

/**
 * Identity, for React keys and for deciding when the map should refit.
 *
 * The device has one key however far it moves: a route from where you are
 * standing is the same route a step later, and refitting the map on every
 * reading would fight whoever is holding the phone.
 */
export function placeKey(place: NavPlace | null): string {
  if (!place) return 'none';
  switch (place.kind) {
    case 'room':
      return `room:${place.roomId}`;
    case 'device':
      return 'device';
    case 'point':
      return `point:${place.position.lat.toFixed(5)},${place.position.lng.toFixed(5)}`;
  }
}

/**
 * Close enough that the walk is over.
 *
 * Wider than it looks: the ends are room centres, so standing in the doorway of
 * a hall the size of Exhibit Hall A is already tens of metres from its middle.
 */
const ARRIVED_METRES = 25;

/**
 * Past this, the two ends are not on the same campus and a walking time would
 * be a joke rather than an estimate — someone planning the trip from home.
 */
const NOT_A_WALK_METRES = 3_000;

export interface RouteSummary {
  from: NavPlace;
  to: NavPlace;
  fromAt: LatLng;
  toAt: LatLng;
  /** Straight-line metres between the two ends. */
  metres: number;
  /** A walking estimate, or null when the ends are too far apart to walk. */
  minutes: number | null;
  /** Both ends are rooms in the same building, on different floors. */
  floorChange: { from: string; to: string } | null;
  /** Both ends are rooms, in different buildings. */
  venueChange: { from: string; to: string } | null;
  /** The two ends are effectively the same place. */
  arrived: boolean;
}

/**
 * The route between two places, or null while either end is still unknown.
 */
export function routeBetween(
  from: NavPlace,
  to: NavPlace,
  device: DeviceFix | null,
): RouteSummary | null {
  const fromAt = placePosition(from, device);
  const toAt = placePosition(to, device);
  if (!fromAt || !toAt) return null;

  const metres = distanceMetres(fromAt, toAt);
  const fromRoom = placeRoom(from);
  const toRoom = placeRoom(to);

  const sameVenue = !!fromRoom && !!toRoom && fromRoom.venueId === toRoom.venueId;
  const venueName = (room: Room) => {
    const venue = VENUES_BY_ID[room.venueId];
    return venue?.shortName ?? venue?.name ?? room.venueId;
  };

  return {
    from,
    to,
    fromAt,
    toAt,
    metres,
    minutes: metres > NOT_A_WALK_METRES ? null : walkingMinutes(metres),
    floorChange:
      sameVenue && fromRoom!.level !== toRoom!.level
        ? { from: fromRoom!.level, to: toRoom!.level }
        : null,
    venueChange:
      fromRoom && toRoom && !sameVenue
        ? { from: venueName(fromRoom), to: venueName(toRoom) }
        : null,
    // Two rooms one above the other are metres apart and a staircase away, so
    // a floor change is never an arrival however close the centres are.
    arrived:
      metres <= ARRIVED_METRES &&
      !(sameVenue && fromRoom!.level !== toRoom!.level),
  };
}

/** Rounded the way a person would say it: to 10 m up close, to 100 m further out. */
export function formatDistance(metres: number): string {
  if (metres < 100) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  if (metres < 1_000) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1_000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}
