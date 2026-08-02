/**
 * Gen Con venue data, anchored to real-world coordinates.
 *
 * Each venue carries its surveyed footprint from OpenStreetMap (see
 * `footprints.ts`) and an `anchor` derived from that footprint's bounding box:
 * its north-west corner and its real size in metres. Rooms are authored in a
 * local grid and projected from that anchor, so moving or resizing a venue
 * moves everything inside it.
 *
 * ACCURACY: the venue outlines are the real building footprints as mapped in
 * OpenStreetMap, not estimates — the shapes on screen are the shapes on the
 * ground. Interior room positions are still a schematic arrangement within
 * that footprint rather than a surveyed floor plan: halls are in the right
 * building and the right general part of it, not at surveyed coordinates. The
 * basemap underneath is real. See README.md.
 *
 * The venues and aliases below were tuned against the live event database:
 * every `Venue.aliases` entry is a `Location` string the source actually
 * publishes, and every `Room.aliases` entry is drawn from its `Room` values.
 */

import type { LatLng, LocalRect, VenueAnchor } from '../utils/geo';
import { localRectToBounds } from '../utils/geo';
import { VENUE_FOOTPRINTS, type FootprintRing } from './footprints';

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
   * Extra strings, as they appear in the event listings' `Room` field, that
   * should resolve to this room. The room's own name and short name are always
   * matched; these cover the abbreviations, spans and misspellings the event
   * data uses.
   */
  aliases?: string[];
  /**
   * Set where the room *is* the whole venue, as it is for every building whose
   * interior the map doesn't break out. Such a room is drawn as the venue's
   * surveyed footprint rather than as `rect`, so it takes the real shape of the
   * building instead of a rectangle poking out of it. `rect` still gives the
   * bounds used to zoom to it.
   */
  fillsVenue?: boolean;
}

export interface Venue {
  id: string;
  name: string;
  /** Short form used for the on-map label, where full names collide. */
  shortName?: string;
  /** Where the venue sits in the real world, from its OSM footprint's bounds. */
  anchor: VenueAnchor;
  /** The real building outline, drawn as the venue's shape on the map. */
  footprint: FootprintRing;
  /** The venue's own rectangle in its local grid; rooms are placed inside it. */
  grid: LocalRect;
  /**
   * `Location` strings in the event data that mean "this venue". The importer
   * writes that field verbatim, so these are the source's own short forms.
   */
  aliases?: string[];
}

/**
 * A local grid measured in metres, matching the venue's real size, so room
 * rectangles below can be read as real distances.
 */
const metresGrid = (anchor: VenueAnchor): LocalRect => ({
  x: 0,
  y: 0,
  width: anchor.widthMetres,
  height: anchor.heightMetres,
});

/** Single-room venues use a plain 0–100 grid; their one room fills it. */
const UNIT_GRID: LocalRect = { x: 0, y: 0, width: 100, height: 100 };

/** Fills a whole single-room venue, inset slightly so its outline stays visible. */
const WHOLE_VENUE: LocalRect = { x: 6, y: 6, width: 88, height: 88 };

const ICC_ANCHOR: VenueAnchor = {
  nw: { lat: 39.765683, lng: -86.166846 },
  widthMetres: 420,
  heightMetres: 443,
};

export const VENUES: Venue[] = [
  {
    id: 'icc',
    name: 'Indiana Convention Center',
    shortName: 'Convention Center',
    aliases: ['ICC', 'Convention Center', 'Indiana Convention Center'],
    anchor: ICC_ANCHOR,
    footprint: VENUE_FOOTPRINTS.icc,
    // Metres, so the room rectangles below are real distances inside the
    // building. The footprint's bounding box is taller than the building: the
    // convention center proper occupies y 0–265, and below that only the thin
    // skywalk arm down to Lucas Oil runs on to y 443. Rooms therefore live in
    // y 20–258, and within the width the footprint actually covers at that
    // depth — roughly x 52–388 in the north half and x 128–408 in the south.
    grid: metresGrid(ICC_ANCHOR),
  },
  {
    id: 'lucas-oil',
    name: 'Lucas Oil Stadium',
    shortName: 'Lucas Oil Stadium',
    aliases: ['Stadium', 'Lucas Oil', 'LOS'],
    anchor: {
      nw: { lat: 39.761396, lng: -86.165373 },
      widthMetres: 268,
      heightMetres: 295,
    },
    footprint: VENUE_FOOTPRINTS['lucas-oil'],
    grid: UNIT_GRID,
  },
  {
    id: 'jw-marriott',
    name: 'JW Marriott Indianapolis',
    shortName: 'JW Marriott',
    aliases: ['JW', 'JW Marriott'],
    anchor: {
      nw: { lat: 39.767158, lng: -86.169402 },
      widthMetres: 172,
      heightMetres: 132,
    },
    footprint: VENUE_FOOTPRINTS['jw-marriott'],
    grid: UNIT_GRID,
  },
  {
    id: 'marriott-downtown',
    name: 'Indianapolis Marriott Downtown',
    shortName: 'Marriott Downtown',
    aliases: ['Marriott', 'Marriott Downtown'],
    anchor: {
      nw: { lat: 39.767057, lng: -86.165204 },
      widthMetres: 70,
      heightMetres: 122,
    },
    footprint: VENUE_FOOTPRINTS['marriott-downtown'],
    grid: UNIT_GRID,
  },
  {
    id: 'westin',
    name: 'Westin Indianapolis',
    shortName: 'Westin',
    aliases: ['Westin'],
    anchor: {
      nw: { lat: 39.766936, lng: -86.164279 },
      widthMetres: 97,
      heightMetres: 112,
    },
    footprint: VENUE_FOOTPRINTS.westin,
    grid: UNIT_GRID,
  },
  {
    id: 'hyatt',
    name: 'Hyatt Regency Indianapolis',
    shortName: 'Hyatt Regency',
    aliases: ['Hyatt', 'Hyatt Regency'],
    anchor: {
      nw: { lat: 39.766972, lng: -86.161563 },
      widthMetres: 121,
      heightMetres: 124,
    },
    footprint: VENUE_FOOTPRINTS.hyatt,
    grid: UNIT_GRID,
  },
  {
    id: 'crowne-plaza',
    name: 'Crowne Plaza at Historic Union Station',
    shortName: 'Crowne Plaza',
    // The event data files these under two different location names; both are
    // the same building.
    aliases: ['Crowne Plaza', 'Union Station'],
    anchor: {
      nw: { lat: 39.763336, lng: -86.161762 },
      widthMetres: 285,
      heightMetres: 170,
    },
    footprint: VENUE_FOOTPRINTS['crowne-plaza'],
    grid: UNIT_GRID,
  },
  {
    id: 'hilton',
    name: 'Hilton Indianapolis Hotel & Suites',
    shortName: 'Hilton',
    // "HIlton" is how a run of the source's own records spell it.
    aliases: ['Hilton', 'HIlton'],
    anchor: {
      nw: { lat: 39.769241, lng: -86.161258 },
      widthMetres: 109,
      heightMetres: 62,
    },
    footprint: VENUE_FOOTPRINTS.hilton,
    grid: UNIT_GRID,
  },
  {
    id: 'omni',
    name: 'Omni Severin Hotel',
    shortName: 'Omni',
    aliases: ['Omni', 'Omni Severin'],
    anchor: {
      nw: { lat: 39.764159, lng: -86.159868 },
      widthMetres: 56,
      heightMetres: 63,
    },
    footprint: VENUE_FOOTPRINTS.omni,
    grid: UNIT_GRID,
  },
  {
    id: 'embassy-suites',
    name: 'Embassy Suites Indianapolis Downtown',
    shortName: 'Embassy Suites',
    aliases: ['Embassy Suites', 'Embassy'],
    anchor: {
      nw: { lat: 39.767829, lng: -86.160829 },
      widthMetres: 67,
      heightMetres: 60,
    },
    footprint: VENUE_FOOTPRINTS['embassy-suites'],
    grid: UNIT_GRID,
  },
  {
    id: 'indiana-rep',
    name: 'Indiana Repertory Theatre',
    shortName: 'Indiana Rep',
    // The source spells it "Theater".
    aliases: ['Indiana Repertory Theater', 'Indiana Repertory'],
    anchor: {
      nw: { lat: 39.767885, lng: -86.161278 },
      widthMetres: 40,
      heightMetres: 65,
    },
    footprint: VENUE_FOOTPRINTS['indiana-rep'],
    grid: UNIT_GRID,
  },
  {
    id: 'escape-room',
    name: 'The Escape Room USA',
    shortName: 'Escape Room',
    aliases: ['The Escape Room USA', 'Escape Room'],
    anchor: {
      nw: { lat: 39.764139, lng: -86.159092 },
      widthMetres: 63,
      heightMetres: 31,
    },
    footprint: VENUE_FOOTPRINTS['escape-room'],
    grid: UNIT_GRID,
  },
  {
    id: 'circle-centre',
    name: 'Circle Centre Mall',
    shortName: 'Circle Centre',
    // No events are scheduled here; it is on the map for food and shelter.
    aliases: ['Circle Centre', 'Circle Center'],
    anchor: {
      nw: { lat: 39.76695, lng: -86.159841 },
      widthMetres: 129,
      heightMetres: 287,
    },
    footprint: VENUE_FOOTPRINTS['circle-centre'],
    grid: UNIT_GRID,
  },
];

export const VENUES_BY_ID: Record<string, Venue> = Object.fromEntries(
  VENUES.map((venue) => [venue.id, venue]),
);

/** Numeric meeting-room aliases: `numberRange(120, 133)` -> ['120', …, '133']. */
function numberRange(first: number, last: number): string[] {
  return Array.from({ length: last - first + 1 }, (_, index) => String(first + index));
}

export const ROOMS: Room[] = [
  // ----------------------------------- Indiana Convention Center, north wing
  {
    id: 'sagamore-ballroom',
    name: 'Sagamore Ballroom',
    category: 'ballroom',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 52, y: 20, width: 120, height: 52 },
    // The source misspells it "Sagamaore" on most of its records, so both
    // spellings have to resolve.
    aliases: ['Sagamore', 'Sagamaore', 'Sagamore Ballroom', 'Sagamaore Ballroom'],
    description:
      'The largest ballroom in the convention center, usually divided into numbered sections for seminars, industry panels and the biggest ticketed events.',
    highlights: ['Keynotes & industry panels', 'True Dungeon staging', 'Divided into sections 1–8'],
  },
  {
    id: 'wabash-ballroom',
    name: 'Wabash Ballroom',
    category: 'ballroom',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 180, y: 20, width: 104, height: 52 },
    aliases: ['Wabash', 'Wabash Ballroom'],
    description:
      'Mid-size ballroom on the west concourse. Typically hosts the larger RPG blocks, costume contests and evening entertainment.',
    highlights: ['Costume contest', 'Large RPG blocks', 'Evening entertainment'],
  },
  {
    id: 'registration',
    name: 'Registration & Will Call',
    shortName: 'Registration',
    category: 'amenity',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 52, y: 80, width: 76, height: 56 },
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
    rect: { x: 136, y: 80, width: 72, height: 56 },
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
    rect: { x: 216, y: 80, width: 68, height: 56 },
    aliases: ['Serpentine Lobby'],
    description:
      'Concession stands along the main concourse. Fast, expensive, and reliably packed between noon and 2pm — Georgia Street food trucks are the usual escape valve.',
    highlights: ['Concessions & seating', 'Peak 12–2pm', 'Nearest restrooms'],
  },

  // -------------------------------- Convention center, north end of the main block
  {
    id: 'ballroom-500',
    name: '500 Ballroom',
    category: 'ballroom',
    venueId: 'icc',
    level: 'Level 5',
    rect: { x: 292, y: 20, width: 84, height: 52 },
    aliases: ['500 Ballroom', 'Ballroom 500'],
    description:
      'Upper-level ballroom reached from the escalators. Quieter than the main floor and a common home for workshops and author events.',
    highlights: ['Workshops', 'Author events', 'Quieter than Level 1'],
  },
  {
    id: 'rooms-101-107',
    name: 'Meeting Rooms 101–107',
    shortName: '101–107',
    category: 'meeting',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 292, y: 80, width: 84, height: 56 },
    aliases: numberRange(101, 107),
    description:
      'Small breakout rooms off the Level 1 concourse. Expect scheduled RPG tables, seminars and GM briefings.',
    highlights: ['Scheduled RPGs', 'Seminars', 'Seats roughly 40–80 each'],
  },

  // ---------------------------------------------------------- Exhibit halls
  {
    id: 'hall-a',
    name: 'Exhibit Hall A',
    shortName: 'Hall A',
    category: 'exhibit',
    venueId: 'icc',
    level: 'Exhibit level',
    rect: { x: 128, y: 146, width: 42, height: 44 },
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
    rect: { x: 175, y: 146, width: 42, height: 44 },
    aliases: ['Hall B', 'Exhibit Hall B', 'Event Hall B'],
    description:
      'The busiest demo space in the building: publisher tables run back-to-back sessions here all four days, each signed with the company running it.',
    highlights: ['Publisher demo tables', 'Colour-coded sections', 'Release-day queues'],
  },
  {
    id: 'hall-c',
    name: 'Exhibit Hall C',
    shortName: 'Hall C',
    category: 'exhibit',
    venueId: 'icc',
    level: 'Exhibit level',
    rect: { x: 222, y: 146, width: 42, height: 44 },
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
    rect: { x: 269, y: 146, width: 42, height: 44 },
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
    rect: { x: 316, y: 146, width: 42, height: 44 },
    aliases: ['Hall E', 'Exhibit Hall E'],
    description:
      'East exhibit aisles, and where the biggest brands put their organised play: long banks of tables running scheduled sessions.',
    highlights: ['Organised play banks', 'Major publishers', 'Painting & hobby events'],
  },
  {
    id: 'hall-f',
    name: 'Exhibit Hall F',
    shortName: 'Hall F',
    category: 'exhibit',
    venueId: 'icc',
    level: 'Exhibit level',
    rect: { x: 363, y: 146, width: 42, height: 44 },
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
    rect: { x: 128, y: 196, width: 50, height: 36 },
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
    rect: { x: 184, y: 196, width: 50, height: 36 },
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
    rect: { x: 240, y: 196, width: 50, height: 36 },
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
    rect: { x: 296, y: 196, width: 50, height: 36 },
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
    rect: { x: 352, y: 196, width: 50, height: 36 },
    aliases: ['Hall K', 'Exhibit Hall K', 'Family Fun'],
    description:
      'Family and kids programming, plus overflow open gaming. Lower noise and shorter sessions than the main hall.',
    highlights: ['Kids & family events', 'Short sessions', 'Overflow open gaming'],
  },

  // --------------------------------------------- Convention center meeting rooms
  {
    id: 'rooms-120-133',
    name: 'Meeting Rooms 120–133',
    shortName: '120–133',
    category: 'meeting',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 128, y: 238, width: 64, height: 20 },
    aliases: numberRange(120, 133),
    description:
      'The west half of the Level 1 breakout block. A large share of the scheduled RPG and workshop slots land here.',
    highlights: ['Scheduled RPGs', 'Workshops', 'Seats roughly 40–120 each'],
  },
  {
    id: 'rooms-134-145',
    name: 'Meeting Rooms 134–145',
    shortName: '134–145',
    category: 'meeting',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 198, y: 238, width: 64, height: 20 },
    aliases: numberRange(134, 145),
    description:
      'The east half of the Level 1 breakout block, closest to the Georgia Street entrance. The busiest meeting rooms in the building.',
    highlights: ['Scheduled RPGs', 'Board game demos', 'Near the east entrance'],
  },
  {
    id: 'rooms-201-212',
    name: 'Meeting Rooms 201–212',
    shortName: '201–212',
    category: 'meeting',
    venueId: 'icc',
    level: 'Level 2',
    rect: { x: 268, y: 238, width: 64, height: 20 },
    aliases: numberRange(201, 212),
    description:
      'Level 2 breakout rooms above the main concourse, reached by the escalators that double as the convention’s default meeting spot.',
    highlights: ['Scheduled RPGs', 'Workshops', 'Reached by escalator'],
  },
  {
    id: 'rooms-231-245',
    name: 'Meeting Rooms 231–245',
    shortName: '231–245',
    category: 'meeting',
    venueId: 'icc',
    level: 'Level 2',
    rect: { x: 338, y: 238, width: 64, height: 20 },
    aliases: numberRange(231, 245),
    description:
      'East end of the Level 2 block. Often used for tournaments and multi-session campaign play that needs a room for the whole day.',
    highlights: ['Tournaments', 'All-day campaigns', 'Near east escalators'],
  },

  // -------------------------------------------------------- Offsite venues
  {
    id: 'lucas-oil-floor',
    name: 'Lucas Oil Stadium',
    category: 'venue',
    venueId: 'lucas-oil',
    level: 'Field, concourse & club level',
    rect: WHOLE_VENUE,
    fillsVenue: true,
    description:
      'The stadium absorbs the events that outgrow the convention center. The field itself is divided into colour-coded and sponsor-named blocks, with more in the exhibit halls, the east concourse and the club lounges. Allow a solid ten minutes to walk over via the skywalk.',
    highlights: ['Field blocks & open gaming', 'Exhibit Halls 1–2', 'Skywalk from the ICC'],
  },
  {
    id: 'jw-marriott-rooms',
    name: 'JW Marriott Indianapolis',
    shortName: 'JW Marriott',
    category: 'lodging',
    venueId: 'jw-marriott',
    level: 'Meeting floors',
    rect: WHOLE_VENUE,
    fillsVenue: true,
    description:
      'The tall hotel on the west side of the campus, and the busiest offsite venue after the stadium. Griffin Hall, the White River and Grand ballrooms and three floors of numbered rooms carry most of the RPG and seminar overflow. Skywalk connected.',
    highlights: ['Griffin Hall', 'White River & Grand ballrooms', 'Skywalk connected'],
  },
  {
    id: 'marriott-downtown-rooms',
    name: 'Indianapolis Marriott Downtown',
    shortName: 'Marriott',
    category: 'lodging',
    venueId: 'marriott-downtown',
    level: 'Meeting floors',
    rect: WHOLE_VENUE,
    fillsVenue: true,
    description:
      'Part of the same connected block as the JW. Its Indiana and Marriott ballrooms and its state- and city-named meeting rooms run scheduled events all four days.',
    highlights: ['Indiana & Marriott ballrooms', 'Skywalk connected', 'Quieter than the ICC'],
  },
  {
    id: 'westin-rooms',
    name: 'Westin Indianapolis',
    shortName: 'Westin',
    category: 'lodging',
    venueId: 'westin',
    level: 'Meeting floors',
    rect: WHOLE_VENUE,
    fillsVenue: true,
    description:
      'North of the convention center and connected by skywalk. The Grand and Capitol ballrooms host the film festival and smaller event tracks, and it is a short indoor walk to registration.',
    highlights: ['Film festival', 'Grand & Capitol ballrooms', 'Shortest indoor walk'],
  },
  {
    id: 'hyatt-rooms',
    name: 'Hyatt Regency Indianapolis',
    shortName: 'Hyatt Regency',
    category: 'lodging',
    venueId: 'hyatt',
    level: 'Meeting floors',
    rect: WHOLE_VENUE,
    fillsVenue: true,
    description:
      'North-east of the convention center. The Cosmopolitan and Regency ballrooms take the larger sessions, with the Studio, Concept and Directors rooms for small tables.',
    highlights: ['Cosmopolitan & Regency ballrooms', 'Small-table rooms', 'Skywalk connected'],
  },
  {
    id: 'crowne-plaza-rooms',
    name: 'Crowne Plaza at Historic Union Station',
    shortName: 'Crowne Plaza',
    category: 'lodging',
    venueId: 'crowne-plaza',
    level: 'Meeting floors',
    rect: WHOLE_VENUE,
    fillsVenue: true,
    description:
      'The hotel built into Union Station, south-east of the convention center. Grand Central and the Illinois Street Ballroom carry the bulk of it; the smaller rooms are named after the railroads that used to run through the building.',
    highlights: ['Grand Central A–D', 'Illinois Street Ballroom', 'Railroad-named rooms'],
  },
  {
    id: 'hilton-rooms',
    name: 'Hilton Indianapolis Hotel & Suites',
    shortName: 'Hilton',
    category: 'lodging',
    venueId: 'hilton',
    level: 'Meeting floors',
    rect: WHOLE_VENUE,
    fillsVenue: true,
    description:
      'North of the convention center on Meridian Street, a few minutes further out than the skywalk hotels. Victory Ballroom and Monument Hall take most of its schedule.',
    highlights: ['Victory Ballroom', 'Monument Hall', 'Walk, not skywalk'],
  },
  {
    id: 'omni-rooms',
    name: 'Omni Severin Hotel',
    shortName: 'Omni',
    category: 'lodging',
    venueId: 'omni',
    level: 'Meeting floors',
    rect: WHOLE_VENUE,
    fillsVenue: true,
    description:
      'Across from Union Station, next to Circle Centre. Gates and McClellan halls run scheduled events, with small parlour and boardroom sessions alongside.',
    highlights: ['Gates & McClellan halls', 'Small parlour rooms', 'Next to Circle Centre'],
  },
  {
    id: 'embassy-suites-rooms',
    name: 'Embassy Suites Indianapolis Downtown',
    shortName: 'Embassy Suites',
    category: 'lodging',
    venueId: 'embassy-suites',
    level: 'Meeting floors',
    rect: WHOLE_VENUE,
    fillsVenue: true,
    description:
      'North-east of the convention center on Georgia Street. A small schedule in the Ambassador, Chancellor and Coronation rooms.',
    highlights: ['Ambassador rooms', 'Small event tracks', 'Short walk to the ICC'],
  },
  {
    id: 'indiana-rep-stage',
    name: 'Indiana Repertory Theatre',
    shortName: 'Indiana Rep',
    category: 'venue',
    venueId: 'indiana-rep',
    level: 'Auditorium',
    rect: WHOLE_VENUE,
    fillsVenue: true,
    description:
      'Working theatre on Washington Street, a couple of blocks north-east of the convention center, used for a handful of staged and performance events.',
    highlights: ['Staged performances', 'Ticketed seating', 'Two blocks north-east'],
  },
  {
    id: 'escape-room-venue',
    name: 'The Escape Room USA',
    shortName: 'Escape Room',
    category: 'venue',
    venueId: 'escape-room',
    level: '200 S. Meridian St',
    rect: WHOLE_VENUE,
    fillsVenue: true,
    // The source files these events under the room name "200 S. Meridian St".
    aliases: ['200 S. Meridian St', '200 South Meridian'],
    description:
      'A commercial escape-room venue two blocks south-east of the convention center, running booked sessions through the convention. Its events are ticketed like any other and it is a ten-minute walk each way.',
    highlights: ['Booked escape rooms', 'Ten-minute walk', 'Offsite — allow travel time'],
  },
  {
    id: 'circle-centre-mall',
    name: 'Circle Centre Mall',
    shortName: 'Circle Centre',
    category: 'amenity',
    venueId: 'circle-centre',
    level: 'Levels 1–4',
    rect: WHOLE_VENUE,
    fillsVenue: true,
    description:
      'Skywalk-connected mall with a food court and restaurants. No events are scheduled here — it is the reliable option when convention center concession lines are 30 deep.',
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

/** A venue's own footprint on the real map: the bounds of its OSM outline. */
export function venueBounds(venue: Venue): [LatLng, LatLng] {
  return localRectToBounds(venue.grid, venue.grid, venue.anchor);
}

/** Skywalk and concourse links, drawn between venue centres. */
export const CONNECTIONS: Array<{ from: string; to: string; label: string }> = [
  { from: 'icc', to: 'lucas-oil', label: 'Skywalk to Lucas Oil Stadium' },
  { from: 'icc', to: 'jw-marriott', label: 'Skywalk to the JW Marriott' },
  { from: 'icc', to: 'marriott-downtown', label: 'Skywalk to the Marriott Downtown' },
  { from: 'icc', to: 'westin', label: 'Skywalk to the Westin' },
  { from: 'icc', to: 'hyatt', label: 'Skywalk to the Hyatt Regency' },
  { from: 'icc', to: 'crowne-plaza', label: 'Skywalk to the Crowne Plaza' },
  { from: 'icc', to: 'circle-centre', label: 'Skywalk to Circle Centre' },
  { from: 'circle-centre', to: 'omni', label: 'Walk to the Omni Severin' },
  { from: 'circle-centre', to: 'embassy-suites', label: 'Walk to the Embassy Suites' },
  { from: 'hyatt', to: 'hilton', label: 'Walk to the Hilton' },
  { from: 'embassy-suites', to: 'indiana-rep', label: 'Walk to the Indiana Rep' },
];
