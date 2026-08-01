/**
 * Gen Con venue data, anchored to real-world coordinates.
 *
 * Each venue carries a `anchor` (its north-west corner and real size in metres)
 * that places it on the map, plus a local grid in which its rooms are laid out.
 * Rooms are projected from that anchor, so moving or resizing a venue moves
 * everything inside it.
 *
 * ACCURACY: venue anchors are close but approximate, and interior room
 * positions are a schematic arrangement within the real footprint rather than a
 * surveyed floor plan — the halls are in the right building and the right
 * general part of it, not at surveyed coordinates. The basemap underneath is
 * real. See README.md for how to replace the anchors with exact footprints.
 */

import type { LatLng, LocalRect, VenueAnchor } from '../utils/geo';
import { localRectToBounds } from '../utils/geo';

export type RoomCategory =
  | 'exhibit'
  | 'ballroom'
  | 'meeting'
  | 'gaming'
  | 'amenity'
  | 'lodging'
  | 'venue';

export interface CategoryStyle {
  label: string;
  fill: string;
  stroke: string;
}

export const CATEGORY_STYLES: Record<RoomCategory, CategoryStyle> = {
  exhibit: { label: 'Exhibit hall', fill: '#3f7f8c', stroke: '#7fd4e0' },
  ballroom: { label: 'Ballroom', fill: '#7a5698', stroke: '#c9a3e6' },
  meeting: { label: 'Meeting rooms', fill: '#4a8c5f', stroke: '#8fe0a8' },
  gaming: { label: 'Open gaming', fill: '#b07a2a', stroke: '#f0c471' },
  amenity: { label: 'Services', fill: '#6b7189', stroke: '#b6bdd4' },
  lodging: { label: 'Hotel', fill: '#a0505f', stroke: '#e69aa8' },
  venue: { label: 'Offsite venue', fill: '#3a6d94', stroke: '#8cc2e8' },
};

export interface Room {
  id: string;
  name: string;
  /** Compact label drawn on the map. Falls back to `name`. */
  shortName?: string;
  category: RoomCategory;
  venueId: string;
  level: string;
  /** Position within the venue's local grid. */
  rect: LocalRect;
  description: string;
  highlights: string[];
  /**
   * Extra location strings, as they appear in the event listings, that should
   * resolve to this room. The room's own name and short name are always
   * matched; these cover the abbreviations and alternate spellings the event
   * data uses.
   */
  aliases?: string[];
}

export interface Venue {
  id: string;
  name: string;
  /** Short form used for the on-map label, where full names collide. */
  shortName?: string;
  /** Where the venue sits in the real world. */
  anchor: VenueAnchor;
  /** The venue's own rectangle in its local grid; rooms are placed inside it. */
  grid: LocalRect;
  /** Location strings in the event data that mean "this venue". */
  aliases?: string[];
}

export const VENUES: Venue[] = [
  {
    id: 'icc',
    name: 'Indiana Convention Center',
    shortName: 'Convention Center',
    aliases: ['ICC', 'Convention Center', 'Indianapolis Convention Center'],
    anchor: {
      nw: { lat: 39.766, lng: -86.167 },
      widthMetres: 470,
      heightMetres: 250,
    },
    grid: { x: 180, y: 180, width: 1760, height: 940 },
  },
  {
    id: 'lucas-oil',
    name: 'Lucas Oil Stadium',
    shortName: 'Lucas Oil Stadium',
    aliases: ['LOS', 'Stadium', 'Lucas Oil'],
    anchor: {
      nw: { lat: 39.761, lng: -86.165 },
      widthMetres: 200,
      heightMetres: 190,
    },
    grid: { x: 0, y: 0, width: 100, height: 100 },
  },
  {
    id: 'jw-marriott',
    name: 'JW Marriott Indianapolis',
    shortName: 'JW Marriott',
    aliases: ['JW', 'JW Marriott'],
    anchor: {
      nw: { lat: 39.7668, lng: -86.169 },
      widthMetres: 85,
      heightMetres: 55,
    },
    grid: { x: 0, y: 0, width: 100, height: 100 },
  },
  {
    id: 'marriott-downtown',
    name: 'Indianapolis Marriott Downtown',
    shortName: 'Marriott Downtown',
    aliases: ['Marriott', 'Marriott Downtown'],
    anchor: {
      nw: { lat: 39.7662, lng: -86.1698 },
      widthMetres: 70,
      heightMetres: 45,
    },
    grid: { x: 0, y: 0, width: 100, height: 100 },
  },
  {
    id: 'westin',
    name: 'Westin Indianapolis',
    shortName: 'Westin',
    aliases: ['Westin'],
    anchor: {
      nw: { lat: 39.7671, lng: -86.1668 },
      widthMetres: 70,
      heightMetres: 50,
    },
    grid: { x: 0, y: 0, width: 100, height: 100 },
  },
  {
    id: 'circle-centre',
    name: 'Circle Centre Mall',
    shortName: 'Circle Centre',
    aliases: ['Circle Centre', 'Circle Center'],
    anchor: {
      nw: { lat: 39.7668, lng: -86.16 },
      widthMetres: 200,
      heightMetres: 150,
    },
    grid: { x: 0, y: 0, width: 100, height: 100 },
  },
];

export const VENUES_BY_ID: Record<string, Venue> = Object.fromEntries(
  VENUES.map((venue) => [venue.id, venue]),
);

/** Fills a whole single-room venue, inset slightly so its outline stays visible. */
const WHOLE_VENUE: LocalRect = { x: 6, y: 6, width: 88, height: 88 };

export const ROOMS: Room[] = [
  // ------------------------------------------- Indiana Convention Center, north
  {
    id: 'sagamore-ballroom',
    name: 'Sagamore Ballroom',
    category: 'ballroom',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 220, y: 220, width: 480, height: 210 },
    aliases: ['Sagamore', 'Sagamore Ballroom 1', 'ICC : Sagamore Ballroom'],
    description:
      'The largest ballroom in the convention center, usually divided into lettered sections for seminars, industry panels and the biggest ticketed events.',
    highlights: ['Keynotes & industry panels', 'True Dungeon staging', 'Divisible into 8 sections'],
  },
  {
    id: 'wabash-ballroom',
    name: 'Wabash Ballroom',
    category: 'ballroom',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 715, y: 220, width: 360, height: 210 },
    aliases: ['Wabash', 'ICC : Wabash Ballroom'],
    description:
      'Mid-size ballroom on the north concourse. Typically hosts the larger RPG blocks, costume contests and evening entertainment.',
    highlights: ['Costume contest', 'Large RPG blocks', 'Evening entertainment'],
  },
  {
    id: 'ballroom-500',
    name: '500 Ballroom',
    category: 'ballroom',
    venueId: 'icc',
    level: 'Level 5',
    rect: { x: 1090, y: 220, width: 300, height: 210 },
    aliases: ['500 Ballroom', 'Ballroom 500'],
    description:
      'Upper-level ballroom reached from the north escalators. Quieter than the main floor and a common home for workshops and author events.',
    highlights: ['Workshops', 'Author events', 'Quieter than Level 1'],
  },
  {
    id: 'rooms-101-107',
    name: 'Meeting Rooms 101–107',
    shortName: '101–107',
    category: 'meeting',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 1405, y: 220, width: 240, height: 210 },
    aliases: ['101', '102', '103', '104', '105', '106', '107'],
    description:
      'Small breakout rooms off the Level 1 concourse. Expect scheduled RPG tables, seminars and GM briefings.',
    highlights: ['Scheduled RPGs', 'Seminars', 'Seats roughly 40–80 each'],
  },
  {
    id: 'rooms-108-114',
    name: 'Meeting Rooms 108–114',
    shortName: '108–114',
    category: 'meeting',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 1660, y: 220, width: 240, height: 210 },
    aliases: ['108', '109', '110', '111', '112', '113', '114'],
    description:
      'Continuation of the Level 1 breakout block toward the east end of the building. Closest rooms to the Georgia Street entrance.',
    highlights: ['Scheduled RPGs', 'Board game demos', 'Near the east entrance'],
  },

  // ------------------------------------------------------ Concourse services
  {
    id: 'registration',
    name: 'Registration & Will Call',
    shortName: 'Registration',
    category: 'amenity',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 220, y: 450, width: 360, height: 150 },
    aliases: ['Will Call', 'Registration'],
    description:
      'Badge pickup, will call and on-site registration. Lines are longest Wednesday evening and Thursday morning — pick up your badge early if you can.',
    highlights: ['Badge pickup', 'On-site registration', 'Busiest Thu AM'],
  },
  {
    id: 'gen-con-central',
    name: 'Gen Con Central',
    category: 'amenity',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 595, y: 450, width: 300, height: 150 },
    aliases: ['Central', 'Customer Service'],
    description:
      'The information and customer service hub: event ticket exchanges, generic ticket sales, lost and found, and answers to "where is…?"',
    highlights: ['Ticket exchange', 'Generic tickets', 'Lost & found'],
  },
  {
    id: 'food-court',
    name: 'Concourse Food Court',
    shortName: 'Food Court',
    category: 'amenity',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 910, y: 450, width: 280, height: 150 },
    description:
      'Concession stands along the main concourse. Fast, expensive, and reliably packed between noon and 2pm — Georgia Street food trucks are the usual escape valve.',
    highlights: ['Concessions & seating', 'Peak 12–2pm', 'Nearest restrooms'],
  },
  {
    id: 'rooms-201-212',
    name: 'Meeting Rooms 201–212',
    shortName: '201–212',
    category: 'meeting',
    venueId: 'icc',
    level: 'Level 2',
    rect: { x: 1205, y: 450, width: 340, height: 150 },
    aliases: ['201', '202', '203', '204', '205', '206', '207', '208', '209', '210', '211', '212'],
    description:
      'Level 2 breakout rooms above the main concourse. A large share of the scheduled RPG and workshop slots land here.',
    highlights: ['Scheduled RPGs', 'Workshops', 'Reached by escalator'],
  },
  {
    id: 'rooms-231-243',
    name: 'Meeting Rooms 231–243',
    shortName: '231–243',
    category: 'meeting',
    venueId: 'icc',
    level: 'Level 2',
    rect: { x: 1560, y: 450, width: 340, height: 150 },
    aliases: ['231', '232', '233', '234', '235', '236', '237', '238', '239', '240', '241', '242', '243'],
    description:
      'East end of the Level 2 block. Often used for tournaments and multi-session campaign play that needs a room for the whole day.',
    highlights: ['Tournaments', 'All-day campaigns', 'Near east escalators'],
  },

  // ---------------------------------------------------------- Exhibit halls
  {
    id: 'hall-a',
    name: 'Exhibit Hall A',
    shortName: 'Hall A',
    category: 'exhibit',
    venueId: 'icc',
    level: 'Exhibit level',
    rect: { x: 220, y: 630, width: 268, height: 230 },
    aliases: ['Hall A', 'Exhibit Hall A'],
    description:
      'West end of the exhibit hall. Traditionally the entrance-adjacent aisles — the first wall of booths you hit when the hall opens.',
    highlights: ['Main hall entrance', 'Large publisher booths', 'Very busy 10am–2pm'],
  },
  {
    id: 'hall-b',
    name: 'Exhibit Hall B',
    shortName: 'Hall B',
    category: 'exhibit',
    venueId: 'icc',
    level: 'Exhibit level',
    rect: { x: 500, y: 630, width: 268, height: 230 },
    aliases: ['Hall B', 'Exhibit Hall B'],
    description:
      'Core exhibit space, generally the largest booths and the demo tables that go with them.',
    highlights: ['Flagship publisher booths', 'Demo tables', 'Release-day queues'],
  },
  {
    id: 'hall-c',
    name: 'Exhibit Hall C',
    shortName: 'Hall C',
    category: 'exhibit',
    venueId: 'icc',
    level: 'Exhibit level',
    rect: { x: 780, y: 630, width: 268, height: 230 },
    aliases: ['Hall C', 'Exhibit Hall C'],
    description: 'Mid-hall aisles: mid-size publishers, accessory makers and dice vendors.',
    highlights: ['Dice & accessories', 'Mid-size publishers', 'Art prints'],
  },
  {
    id: 'hall-d',
    name: 'Exhibit Hall D',
    shortName: 'Hall D',
    category: 'exhibit',
    venueId: 'icc',
    level: 'Exhibit level',
    rect: { x: 1060, y: 630, width: 268, height: 230 },
    aliases: ['Hall D', 'Exhibit Hall D'],
    description:
      'Continues the mid-hall aisles toward the east. Common home for miniatures, terrain and painting supplies.',
    highlights: ['Miniatures & terrain', 'Paint & hobby supplies', 'Painting demos'],
  },
  {
    id: 'hall-e',
    name: 'Exhibit Hall E',
    shortName: 'Hall E',
    category: 'exhibit',
    venueId: 'icc',
    level: 'Exhibit level',
    rect: { x: 1340, y: 630, width: 268, height: 230 },
    aliases: ['Hall E', 'Exhibit Hall E'],
    description:
      'East exhibit aisles. Usually a mix of smaller publishers, crowdfunding pickups and first-time exhibitors.',
    highlights: ['First-time exhibitors', 'Crowdfunding pickups', 'Small press'],
  },
  {
    id: 'hall-f',
    name: 'Exhibit Hall F',
    shortName: 'Hall F',
    category: 'exhibit',
    venueId: 'icc',
    level: 'Exhibit level',
    rect: { x: 1620, y: 630, width: 268, height: 230 },
    aliases: ['Hall F', 'Exhibit Hall F'],
    description:
      'Far east end of the exhibit hall, adjacent to the east entrance. Quietest aisles in the morning.',
    highlights: ['East entrance', 'Quieter mornings', 'Artists & crafters'],
  },
  {
    id: 'hall-g',
    name: 'Exhibit Hall G',
    shortName: 'Hall G',
    category: 'exhibit',
    venueId: 'icc',
    level: 'Exhibit level',
    rect: { x: 220, y: 875, width: 322, height: 205 },
    aliases: ['Hall G', 'Exhibit Hall G'],
    description:
      'South exhibit block. Frequently used for the used-game auction area and larger retail booths.',
    highlights: ['Auction & retail', 'Bring a bag', 'Wide aisles'],
  },
  {
    id: 'hall-h',
    name: 'Exhibit Hall H',
    shortName: 'Hall H',
    category: 'exhibit',
    venueId: 'icc',
    level: 'Exhibit level',
    rect: { x: 557, y: 875, width: 322, height: 205 },
    aliases: ['Hall H', 'Exhibit Hall H'],
    description: 'South exhibit block continued — costume, prop and accessory vendors cluster here.',
    highlights: ['Costume & props', 'Leatherwork', 'Photo backdrops'],
  },
  {
    id: 'hall-i',
    name: 'Exhibit Hall I',
    shortName: 'Hall I',
    category: 'exhibit',
    venueId: 'icc',
    level: 'Exhibit level',
    rect: { x: 894, y: 875, width: 322, height: 205 },
    aliases: ['Hall I', 'Exhibit Hall I'],
    description:
      'Often converted into event space rather than booths: large scheduled play areas and tournament banks.',
    highlights: ['Tournament banks', 'Scheduled play', 'Table seating'],
  },
  {
    id: 'hall-j',
    name: 'Exhibit Hall J — Open Gaming',
    shortName: 'Hall J',
    category: 'gaming',
    venueId: 'icc',
    level: 'Exhibit level',
    rect: { x: 1231, y: 875, width: 322, height: 205 },
    aliases: ['Hall J', 'Exhibit Hall J', 'Open Gaming'],
    description:
      'Open gaming: rows of free tables, first come first served. Grab one, put a game out, and strangers will sit down.',
    highlights: ['Free open tables', 'Library check-out', 'Runs late into the night'],
  },
  {
    id: 'hall-k',
    name: 'Exhibit Hall K — Family Fun',
    shortName: 'Hall K',
    category: 'gaming',
    venueId: 'icc',
    level: 'Exhibit level',
    rect: { x: 1568, y: 875, width: 322, height: 205 },
    aliases: ['Hall K', 'Exhibit Hall K', 'Family Fun'],
    description:
      'Family and kids programming, plus overflow open gaming. Lower noise and shorter sessions than the main hall.',
    highlights: ['Kids & family events', 'Short sessions', 'Overflow open gaming'],
  },

  // -------------------------------------------------------- Offsite venues
  {
    id: 'lucas-oil-floor',
    name: 'Lucas Oil Stadium',
    category: 'venue',
    venueId: 'lucas-oil',
    level: 'Field & club level',
    rect: WHOLE_VENUE,
    description:
      'The stadium absorbs the events that outgrow the convention center: massive miniatures battles, large-scale open gaming and the biggest scheduled blocks. Allow a solid ten minutes to walk over via the skywalk.',
    highlights: ['Large-scale miniatures', 'Overflow gaming', 'Skywalk from the ICC'],
  },
  {
    id: 'jw-marriott-rooms',
    name: 'JW Marriott Indianapolis',
    shortName: 'JW Marriott',
    category: 'lodging',
    venueId: 'jw-marriott',
    level: 'Meeting floors',
    rect: WHOLE_VENUE,
    description:
      'The tall hotel on the west side of the campus. Its meeting floors host a large share of the RPG and seminar overflow, and it connects to the convention center by skywalk.',
    highlights: ['RPG & seminar overflow', 'Skywalk connected', 'Late-night bar scene'],
  },
  {
    id: 'marriott-downtown-rooms',
    name: 'Indianapolis Marriott Downtown',
    shortName: 'Marriott',
    category: 'lodging',
    venueId: 'marriott-downtown',
    level: 'Meeting floors',
    rect: WHOLE_VENUE,
    description:
      'Adjacent to the JW and part of the same connected block. Meeting rooms here run scheduled events all four days.',
    highlights: ['Scheduled events', 'Skywalk connected', 'Quieter than the ICC'],
  },
  {
    id: 'westin-rooms',
    name: 'Westin Indianapolis',
    shortName: 'Westin',
    category: 'lodging',
    venueId: 'westin',
    level: 'Meeting floors',
    rect: WHOLE_VENUE,
    description:
      'North of the convention center and connected by skywalk. Hosts smaller event tracks and is a short indoor walk to registration.',
    highlights: ['Small event tracks', 'Shortest indoor walk', 'Skywalk connected'],
  },
  {
    id: 'circle-centre-mall',
    name: 'Circle Centre Mall',
    shortName: 'Circle Centre',
    category: 'amenity',
    venueId: 'circle-centre',
    level: 'Levels 1–4',
    rect: WHOLE_VENUE,
    description:
      'Skywalk-connected mall with a food court and restaurants. The reliable option when convention center concession lines are 30 deep.',
    highlights: ['Food court', 'Restaurants', 'Skywalk connected'],
  },
];

export const ROOMS_BY_ID: Record<string, Room> = Object.fromEntries(
  ROOMS.map((room) => [room.id, room]),
);

/** A room's footprint on the real map, derived from its venue's anchor. */
export function roomBounds(room: Room): [LatLng, LatLng] {
  const venue = VENUES_BY_ID[room.venueId];
  return localRectToBounds(room.rect, venue.grid, venue.anchor);
}

/** A venue's own footprint on the real map. */
export function venueBounds(venue: Venue): [LatLng, LatLng] {
  return localRectToBounds(venue.grid, venue.grid, venue.anchor);
}

/** Skywalk and concourse links, drawn between venue centres. */
export const CONNECTIONS: Array<{ from: string; to: string; label: string }> = [
  { from: 'icc', to: 'lucas-oil', label: 'Skywalk to Lucas Oil Stadium' },
  { from: 'icc', to: 'jw-marriott', label: 'Skywalk to the JW Marriott' },
  { from: 'icc', to: 'marriott-downtown', label: 'Skywalk to the Marriott Downtown' },
  { from: 'icc', to: 'westin', label: 'Skywalk to the Westin' },
  { from: 'icc', to: 'circle-centre', label: 'Skywalk to Circle Centre' },
];
