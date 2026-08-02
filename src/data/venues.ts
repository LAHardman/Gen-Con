/**
 * Gen Con venue data, anchored to real-world coordinates.
 *
 * Each venue carries its surveyed footprint from OpenStreetMap (see
 * `footprints.ts`) and an `anchor` derived from that footprint's bounding box:
 * its north-west corner and its real size in metres. Rooms are authored in a
 * local grid and projected from that anchor, so moving or resizing a venue
 * moves everything inside it.
 *
 * ACCURACY: the venue outlines are real, not estimates — the shapes on screen
 * are the shapes on the ground. The convention centre's halls and meeting rooms
 * are read straight off its official floor plans (`plans/`, converted by
 * `scripts/plan-to-geometry.mjs`): each is drawn as the outline the architect
 * drew, in the position the plan puts it, and the line around the building is
 * traced from those same plans so the two agree. Three of its rooms —
 * registration, Gen Con Central and the food court — are services the plan
 * doesn't letter, so they keep a schematic rectangle on the Level 1 concourse.
 * Every other venue is outlined by its OpenStreetMap footprint, with an
 * interior that is a schematic arrangement inside it: rooms are in the right
 * building and the right general part of it, not at surveyed coordinates. The
 * basemap underneath is real. See README.md.
 *
 * ORIENTATION: for the JW Marriott, the Marriott Downtown, the Westin, the
 * Crowne Plaza and the Omni, that arrangement is read off published floor
 * plans — Gen Con's own for all but the JW, whose 1st floor comes from the
 * hotel's. Gen Con draws its plans with south at the top, which its own room
 * names confirm (Grand Hall Southeast is drawn above Grand Hall Northeast),
 * so the rectangles below are those plans turned through half a turn. What
 * that fixes is which rooms exist, which floor each is on, and how they sit
 * relative to one another; it does not make them surveyed.
 *
 * The venues and aliases below were tuned against the live event database:
 * every `Venue.aliases` entry is a `Location` string the source actually
 * publishes, and every `Room.aliases` entry is drawn from its `Room` values.
 */

import type { LatLng, LocalRect, VenueAnchor } from '../utils/geo';
import { localRectToBounds } from '../utils/geo';
import { VENUE_FOOTPRINTS, type FootprintRing } from './footprints';
import {
  PLAN_DETAIL,
  PLAN_OUTLINE,
  PLAN_SHAPES,
  type PlanDetail,
  type PlanRing,
} from './plan-geometry';

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
  /**
   * Position within the venue's local grid. Where `plan` names shapes on a
   * real floor plan those are drawn instead, and this only has to be close
   * enough to put the room in the right part of the building.
   */
  rect: LocalRect;
  /**
   * Labels printed on the venue's floor plan, exactly as they appear on it,
   * naming the spaces this room covers — `['HALL A']`, or every number along a
   * block of meeting rooms. The room is then drawn as the outline the
   * architect drew rather than as `rect`. Resolved against the room's own
   * level. See `plan-geometry.ts`.
   */
  plan?: readonly string[];
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
   * interior the map doesn't break out. Such a room is drawn as the venue's own
   * outline rather than as `rect`, so it takes the real shape of the building
   * instead of a rectangle poking out of it. `rect` still gives the bounds used
   * to zoom to it.
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
  /**
   * The building's surveyed outline from OpenStreetMap. Drawn as the venue's
   * shape unless its floor plans give a better one — see `venueOutline`.
   */
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

/**
 * Venues whose rooms are laid out from a published floor plan of the building
 * rather than invented: which rooms exist, which floor each is on, and how
 * they sit relative to one another all come off the plan. The coordinates
 * still don't — the plans carry no scale that can be fitted, so these rooms
 * are drawn as rectangles inside the real footprint, not as measured outlines.
 * The convention centre is not in this list because its rooms are better than
 * this: they are the plan's own geometry (`plan-geometry.ts`).
 */
export const PLANNED_LAYOUT = new Set([
  'jw-marriott',
  'marriott-downtown',
  'westin',
  'crowne-plaza',
  'omni',
]);

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
    level: 'Level 2',
    rect: { x: 300, y: 31, width: 76, height: 23 },
    plan: ['SAGAMORE', ...numberRange(1, 7)],
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
    rect: { x: 207, y: 22, width: 41, height: 20 },
    plan: ['WABASH BALLROOM'],
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
    rect: { x: 40, y: 24, width: 74, height: 12 },
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
    rect: { x: 120, y: 24, width: 62, height: 12 },
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
    rect: { x: 250, y: 24, width: 58, height: 12 },
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
    level: 'Level 1',
    rect: { x: 339, y: 88, width: 45, height: 28 },
    plan: ['500 BALLROOM'],
    aliases: ['500 Ballroom', 'Ballroom 500'],
    description:
      'Upper-level ballroom reached from the escalators. Quieter than the main floor and a common home for workshops and author events.',
    highlights: ['Workshops', 'Author events', 'Quieter than Level 1'],
  },
  {
    id: 'rooms-101-117',
    name: 'Meeting Rooms 101–117',
    shortName: '101–117',
    category: 'meeting',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 294, y: 46, width: 90, height: 28 },
    plan: numberRange(101, 117),
    aliases: numberRange(101, 117),
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
    level: 'Level 1',
    rect: { x: 44, y: 53, width: 48, height: 74 },
    plan: ['HALL A'],
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
    level: 'Level 1',
    rect: { x: 92, y: 53, width: 47, height: 74 },
    plan: ['HALL B'],
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
    level: 'Level 1',
    rect: { x: 139, y: 53, width: 47, height: 74 },
    plan: ['HALL C'],
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
    level: 'Level 1',
    rect: { x: 185, y: 54, width: 86, height: 42 },
    plan: ['HALL D'],
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
    level: 'Level 1',
    rect: { x: 185, y: 96, width: 86, height: 44 },
    plan: ['HALL E'],
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
    level: 'Level 1',
    rect: { x: 146, y: 127, width: 72, height: 70 },
    plan: ['HALL F'],
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
    level: 'Level 1',
    rect: { x: 146, y: 197, width: 72, height: 58 },
    plan: ['HALL G'],
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
    level: 'Level 1',
    rect: { x: 218, y: 174, width: 66, height: 97 },
    plan: ['HALL H'],
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
    level: 'Level 1',
    rect: { x: 284, y: 174, width: 66, height: 114 },
    plan: ['HALL I'],
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
    level: 'Level 1',
    rect: { x: 350, y: 174, width: 50, height: 57 },
    plan: ['HALL J'],
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
    level: 'Level 1',
    rect: { x: 350, y: 230, width: 50, height: 62 },
    plan: ['HALL K'],
    aliases: ['Hall K', 'Exhibit Hall K', 'Family Fun'],
    description:
      'Family and kids programming, plus overflow open gaming. Lower noise and shorter sessions than the main hall.',
    highlights: ['Kids & family events', 'Short sessions', 'Overflow open gaming'],
  },

  // --------------------------------------------- Convention center meeting rooms
  {
    id: 'rooms-120-128',
    name: 'Meeting Rooms 120–128',
    shortName: '120–128',
    category: 'meeting',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 91, y: 18, width: 93, height: 14 },
    plan: numberRange(120, 128),
    aliases: numberRange(120, 128),
    description:
      'The west half of the Level 1 breakout block. A large share of the scheduled RPG and workshop slots land here.',
    highlights: ['Scheduled RPGs', 'Workshops', 'Seats roughly 40–120 each'],
  },
  {
    id: 'rooms-130-145',
    name: 'Meeting Rooms 130–145',
    shortName: '130–145',
    category: 'meeting',
    venueId: 'icc',
    level: 'Level 1',
    rect: { x: 223, y: 135, width: 153, height: 14 },
    plan: numberRange(130, 145),
    aliases: numberRange(130, 145),
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
    rect: { x: 278, y: 49, width: 63, height: 68 },
    plan: numberRange(201, 212),
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
    rect: { x: 250, y: 137, width: 136, height: 14 },
    plan: numberRange(231, 245),
    aliases: numberRange(231, 245),
    description:
      'East end of the Level 2 block. Often used for tournaments and multi-session campaign play that needs a room for the whole day.',
    highlights: ['Tournaments', 'All-day campaigns', 'Near east escalators'],
  },

  // ----------------------------------------------- Lucas Oil Stadium
  {
    id: 'lucas-oil-field',
    name: 'Stadium Field',
    shortName: 'Field',
    category: 'gaming',
    venueId: 'lucas-oil',
    level: 'Field level',
    rect: { x: 33, y: 30, width: 34, height: 41 },
    aliases: ['Field'],
    description:
      'The playing field, boarded over and divided into colour-coded and sponsor-named blocks. The single busiest space at the convention outside the exhibit hall, and the one most worth allowing extra time to find your way around.',
    highlights: ['Colour & sponsor blocks', 'Large-scale miniatures', 'Busiest space in the stadium'],
  },
  {
    id: 'lucas-oil-exhibit-halls',
    name: 'Exhibit Halls 1–2',
    shortName: 'Exhibit 1–2',
    category: 'exhibit',
    venueId: 'lucas-oil',
    level: 'Level 1',
    rect: { x: 34, y: 75, width: 30, height: 13 },
    aliases: ['Exhibit Hall 1', 'Exhibit Hall 2', 'Exhibit Hall 1--2'],
    description:
      'The stadium’s own exhibit halls, numbered rather than lettered like the convention centre’s. Scheduled play and overflow from the main hall.',
    highlights: ['Scheduled play', 'Overflow from the ICC', 'Numbered, not lettered'],
  },
  {
    id: 'lucas-oil-east-concourse',
    name: 'East Concourse',
    category: 'amenity',
    venueId: 'lucas-oil',
    level: 'Concourse level',
    rect: { x: 70, y: 38, width: 17, height: 22 },
    aliases: ['East Concourse'],
    description:
      'The wide east walkway, lined with tables. Easy to find and easy to get turned around in — it wraps the whole bowl.',
    highlights: ['Table banks', 'Concessions', 'Wraps the bowl'],
  },
  {
    id: 'lucas-oil-west-concourse',
    name: 'West Concourse',
    category: 'amenity',
    venueId: 'lucas-oil',
    level: 'Concourse level',
    rect: { x: 14, y: 38, width: 17, height: 22 },
    aliases: ['West Concourse'],
    description:
      'The west side of the concourse ring, quieter than the east and closer to the skywalk back to the convention centre.',
    highlights: ['Quieter side', 'Nearest the skywalk', 'Table banks'],
  },
  {
    id: 'lucas-oil-east-club',
    name: 'East Club Lounge',
    shortName: 'East Club',
    category: 'amenity',
    venueId: 'lucas-oil',
    level: 'Club level',
    rect: { x: 63, y: 24, width: 17, height: 11 },
    aliases: ['East Club Lounge', 'East Club', 'Club Lounge'],
    description:
      'The club lounge along the east side of the bowl, used for smaller sessions. Carpeted, seated and considerably calmer than the field below. Signed by whoever sponsors it — currently Faegre Drinker — rather than by the compass point.',
    highlights: ['Calmer than the field', 'Smaller sessions', 'Signed by its sponsor'],
  },
  {
    id: 'lucas-oil-west-club',
    name: 'West Club Lounge',
    shortName: 'West Club',
    category: 'amenity',
    venueId: 'lucas-oil',
    level: 'Club level',
    rect: { x: 20, y: 24, width: 17, height: 11 },
    aliases: ['West Club Lounge', 'West Club'],
    description:
      'The matching lounge on the west side, above the Huntington West Gate and the closest club space to the skywalk back to the convention centre.',
    highlights: ['Nearest the skywalk', 'Smaller sessions', 'Seated & carpeted'],
  },
  {
    id: 'lucas-oil-meeting-rooms',
    name: 'Meeting Rooms 1–12',
    shortName: '1–12',
    category: 'meeting',
    venueId: 'lucas-oil',
    level: 'Meeting level',
    rect: { x: 66, y: 62, width: 16, height: 12 },
    aliases: ['Meeting Room', 'Meeting Rooms'],
    description:
      'A dozen numbered breakout rooms off the concourse, running RPG and workshop slots away from the noise of the field.',
    highlights: ['Scheduled RPGs', 'Away from the noise', 'Seats roughly 20–60'],
  },
  {
    id: 'lucas-oil-lower-suites',
    name: 'Lower Suites',
    shortName: 'Suites',
    category: 'amenity',
    venueId: 'lucas-oil',
    level: 'Suite level',
    rect: { x: 18, y: 62, width: 16, height: 12 },
    aliases: ['Lower Suites', 'Suites'],
    description:
      'Private suites let out as small event spaces. The most sheltered rooms in the building, and the hardest to find without directions.',
    highlights: ['Small private sessions', 'Very quiet', 'Ask staff for directions'],
  },

  // ------------------------------------------------- JW Marriott Indianapolis
  // The 1st floor is laid out from the hotel's own published plan of it: the
  // White River Ballroom's ten lettered sections in three columns, rooms
  // 101–104 down one side, and 105–109 with registration in a row along the
  // far side of the prefunction hall. That drawing carries no building outline
  // and no scale, so what it fixes is the arrangement, not the coordinates.
  {
    id: 'jw-white-river-ghij',
    name: 'White River Ballroom G–J',
    shortName: 'White River G–J',
    category: 'ballroom',
    venueId: 'jw-marriott',
    level: '1st floor',
    rect: { x: 16, y: 42, width: 12, height: 32 },
    aliases: [
      'White River Ballroom G', 'White River Ballroom H', 'White River Ballroom I',
      'White River Ballroom J', 'White River G', 'White River H', 'White River I',
      'White River J',
    ],
    description:
      'The outer column of the White River Ballroom — four sections in a stack, divided from the rest of the room by airwalls. Society play and the larger RPG blocks.',
    highlights: ['Sections G, H, I & J', 'Society play', 'Airwall-divided'],
  },
  {
    id: 'jw-white-river-ef',
    name: 'White River Ballroom E–F',
    shortName: 'White River E–F',
    category: 'ballroom',
    venueId: 'jw-marriott',
    level: '1st floor',
    rect: { x: 28, y: 42, width: 24, height: 32 },
    // The bare name has to land somewhere: the centre of the room is the least
    // wrong place for an event that says only "White River Ballroom".
    aliases: [
      'White River Ballroom', 'White River', 'White River Ballroom E',
      'White River Ballroom F', 'White River E', 'White River F',
    ],
    description:
      'The two centre sections, and the widest single span in the ballroom. Combined with its neighbours this is the largest event space on the floor.',
    highlights: ['Sections E & F', 'Widest span here', 'Combines either way'],
  },
  {
    id: 'jw-white-river-abcd',
    name: 'White River Ballroom A–D',
    shortName: 'White River A–D',
    category: 'ballroom',
    venueId: 'jw-marriott',
    level: '1st floor',
    rect: { x: 52, y: 42, width: 12, height: 32 },
    aliases: [
      'White River Ballroom A', 'White River Ballroom B', 'White River Ballroom C',
      'White River Ballroom D', 'White River A', 'White River B', 'White River C',
      'White River D',
    ],
    description:
      'The inner column of four sections, nearest the numbered breakout rooms. Seminars and the sessions that want a smaller room than the full ballroom.',
    highlights: ['Sections A, B, C & D', 'Seminars', 'Next to rooms 101–104'],
  },
  {
    id: 'jw-rooms-101-104',
    name: 'Rooms 101–104',
    shortName: '101–104',
    category: 'lodging',
    venueId: 'jw-marriott',
    level: '1st floor',
    rect: { x: 68, y: 42, width: 12, height: 32 },
    aliases: ['101', '102', '103', '104'],
    description:
      'Four breakout rooms in a column alongside the ballroom, with the restrooms at the end of the run. Numbered the same way the convention centre numbers its own — check the building before you set off.',
    highlights: ['Small scheduled tables', 'Numbered like the ICC', 'Check the building!'],
  },
  {
    id: 'jw-room-109',
    name: 'Room 109',
    shortName: '109',
    category: 'lodging',
    venueId: 'jw-marriott',
    level: '1st floor',
    rect: { x: 16, y: 78, width: 10, height: 9 },
    aliases: ['109'],
    description:
      'On its own at the far end of the lower corridor, past registration and well away from the other numbered rooms. The easiest room in the building to walk past.',
    highlights: ['Off on its own', 'Past registration', 'Allow extra time to find it'],
  },
  {
    id: 'jw-registration',
    name: 'Registration',
    category: 'amenity',
    venueId: 'jw-marriott',
    level: '1st floor',
    rect: { x: 28, y: 78, width: 9, height: 9 },
    aliases: ['Registration'],
    description:
      'The hotel’s own registration desk, on the corridor below the prefunction hall between room 109 and the 105–108 block.',
    highlights: ['Hotel registration', 'On the lower corridor', 'Not Gen Con badge pickup'],
  },
  {
    id: 'jw-rooms-105-108',
    name: 'Rooms 105–108',
    shortName: '105–108',
    category: 'lodging',
    venueId: 'jw-marriott',
    level: '1st floor',
    rect: { x: 39, y: 78, width: 25, height: 9 },
    aliases: ['105', '106', '107', '108'],
    description:
      'Two pairs of breakout rooms off the corridor below the prefunction hall, with the stairs down between them. Mostly four- to six-player tables.',
    highlights: ['Four to six players', 'Below the prefunction hall', 'Stairs between the pairs'],
  },
  {
    id: 'jw-griffin-hall',
    name: 'Griffin Hall',
    category: 'ballroom',
    venueId: 'jw-marriott',
    level: '2nd floor',
    rect: { x: 16, y: 42, width: 48, height: 32 },
    aliases: ['Griffin Hall', 'Griffin'],
    description:
      'The JW’s largest event space, and the busiest single room outside the convention centre. Long banks of tables running scheduled play all four days.',
    highlights: ['Busiest room offsite', 'Large scheduled blocks', 'Skywalk connected'],
  },
  {
    id: 'jw-rooms-200',
    name: 'Rooms 201–209',
    shortName: '201–209',
    category: 'lodging',
    venueId: 'jw-marriott',
    level: '2nd floor',
    rect: { x: 68, y: 42, width: 12, height: 32 },
    aliases: ['201', '202', '203', '204', '205', '206', '207', '208', '209'],
    description:
      'Second-floor breakout rooms, stacked over the 100s and reached from the main escalators. Mostly four- to six-player tables.',
    highlights: ['Four to six players', 'Off the escalators', 'Directly over the 100s'],
  },
  {
    id: 'jw-grand-ballroom',
    name: 'Grand Ballroom 1–10',
    shortName: 'Grand Ballroom',
    category: 'ballroom',
    venueId: 'jw-marriott',
    level: '3rd floor',
    rect: { x: 16, y: 42, width: 48, height: 32 },
    aliases: ['Grand Ballroom'],
    description:
      'Numbered ballroom sections on the JW’s main meeting floor, used for the events that outgrow the White River rooms.',
    highlights: ['Numbered 1–10', 'Large sessions', 'Main meeting floor'],
  },
  {
    id: 'jw-rooms-300',
    name: 'Rooms 300–314',
    shortName: '300–314',
    category: 'lodging',
    venueId: 'jw-marriott',
    level: '3rd floor',
    rect: { x: 68, y: 42, width: 12, height: 32 },
    aliases: ['300', '301', '302', '303', '304', '305', '306', '307', '308', '309', '310', '311', '312', '313', '314'],
    description:
      'Third-floor breakout rooms — the quietest scheduled space in the building, and the longest lift queue.',
    highlights: ['Quietest floor', 'Small tables', 'Allow time for lifts'],
  },

  // -------------------------------------- Indianapolis Marriott Downtown
  // Two floors, read off Gen Con's own plans of them: the Indiana Ballroom and
  // the state rooms on the 1st, the Marriott Ballroom's ten sections and the
  // city rooms on the 2nd. Gen Con draws its plans with south at the top, so
  // everything below is turned through half a turn to face the map's north.
  {
    id: 'marriott-indiana-ballroom',
    name: 'Indiana Ballroom A–G',
    shortName: 'Indiana Ballroom',
    category: 'ballroom',
    venueId: 'marriott-downtown',
    level: '1st floor',
    rect: { x: 20, y: 7, width: 40, height: 27 },
    aliases: ['Indiana Ballroom', 'Indiana'],
    description:
      'The Marriott’s 1st-floor ballroom, lettered A to G along its length: A, B and C across one end, then D and E, with F and G at the other. Takes the bulk of the hotel’s scheduled play.',
    highlights: ['Divisible A–G', 'Bulk of the schedule', 'Skywalk connected'],
  },
  {
    id: 'marriott-kentucky-tennessee',
    name: 'Kentucky & Tennessee',
    shortName: 'Kentucky & Tennessee',
    category: 'lodging',
    venueId: 'marriott-downtown',
    level: '1st floor',
    rect: { x: 20, y: 42, width: 34, height: 8 },
    aliases: ['Kentucky', 'Tennessee'],
    description:
      'The pair of rooms straight off the lobby, behind the registration desk. The easiest scheduled rooms in the building to find.',
    highlights: ['Straight off the lobby', 'Single-table sessions', 'Easy to find'],
  },
  {
    id: 'marriott-rooms-east',
    name: 'Utah, Texas, Michigan, Illinois & Florida',
    shortName: 'Utah–Florida',
    category: 'lodging',
    venueId: 'marriott-downtown',
    level: '1st floor',
    rect: { x: 3, y: 8, width: 11, height: 38 },
    aliases: ['Utah', 'Texas', 'Michigan', 'Illinois', 'Florida'],
    description:
      'A run of five small rooms down one side of the 1st floor, alongside the Indiana Ballroom and past the lifts. One table each, and all named for states.',
    highlights: ['Five rooms in a row', 'One table each', 'Past the lifts'],
  },
  {
    id: 'marriott-california-arizona',
    name: 'California & Arizona',
    shortName: 'California & Arizona',
    category: 'lodging',
    venueId: 'marriott-downtown',
    level: '1st floor',
    rect: { x: 63, y: 34, width: 18, height: 12 },
    aliases: ['California', 'Arizona'],
    description:
      'Two rooms tucked against the guest-room tower, on the corridor between the lobby and the ballroom.',
    highlights: ['Small sessions', 'Between lobby & ballroom', 'Against the tower'],
  },
  {
    id: 'marriott-colorado',
    name: 'Colorado',
    category: 'lodging',
    venueId: 'marriott-downtown',
    level: '1st floor',
    rect: { x: 63, y: 8, width: 12, height: 7 },
    aliases: ['Colorado'],
    description:
      'A single room at the far corner of the 1st floor, beyond the ballroom’s A–C end.',
    highlights: ['One table', 'Far corner', 'Beyond the ballroom'],
  },
  {
    id: 'marriott-lobby',
    name: 'Lobby & Registration',
    shortName: 'Lobby',
    category: 'amenity',
    venueId: 'marriott-downtown',
    level: '1st floor',
    rect: { x: 14, y: 56, width: 59, height: 15 },
    aliases: ['Lobby'],
    description:
      'The hotel lobby, with its registration desk, the escalators up to the ballroom floor and the lifts down to parking. The skywalk from the convention centre lands here.',
    highlights: ['Skywalk lands here', 'Escalators to 2nd floor', 'Lifts to parking'],
  },
  {
    id: 'marriott-ballroom',
    name: 'Marriott Ballroom 1–10',
    shortName: 'Marriott Ballroom',
    category: 'ballroom',
    venueId: 'marriott-downtown',
    level: '2nd floor',
    rect: { x: 20, y: 9, width: 47, height: 51 },
    aliases: ['Marriott Ballroom'],
    description:
      'The whole 2nd floor is this one room, divided into ten numbered sections: 1–4 in a row along the foyer, 5 and 6 as broad spans across the middle, and 7–10 at the far end. Tournaments, the auction, and the events that need a hall to themselves.',
    highlights: ['Numbered 1–10', 'Auction & tournaments', 'Foyer along one side'],
  },
  {
    id: 'marriott-city-rooms',
    name: 'Albany, Atlanta, Austin, Boston & Columbus',
    shortName: 'City Rooms',
    category: 'lodging',
    venueId: 'marriott-downtown',
    level: '2nd floor',
    rect: { x: 21, y: 2, width: 54, height: 5 },
    aliases: ['Albany', 'Atlanta', 'Austin', 'Boston', 'Columbus'],
    description:
      'Five small rooms in a row along the far side of the ballroom foyer, named after American cities. Single-table sessions, and easy to walk straight past.',
    highlights: ['Single-table sessions', 'Named for cities', 'Along the foyer'],
  },
  {
    id: 'marriott-north-rooms',
    name: 'Santa Fe, Phoenix & Lincoln',
    shortName: 'Santa Fe & Lincoln',
    category: 'lodging',
    venueId: 'marriott-downtown',
    level: '2nd floor',
    rect: { x: 78, y: 78, width: 16, height: 18 },
    aliases: ['Santa Fe', 'Phoenix', 'Lincoln'],
    description:
      'Three rooms in a stack at the corner of the 2nd floor where the skywalk arrives, well away from the ballroom.',
    highlights: ['By the skywalk', 'Small sessions', 'Away from the ballroom'],
  },
  {
    id: 'marriott-denver',
    name: 'Denver',
    category: 'lodging',
    venueId: 'marriott-downtown',
    level: '2nd floor',
    rect: { x: 3, y: 74, width: 11, height: 7 },
    aliases: ['Denver'],
    description:
      'A single room by the escalators down to the lobby, on the opposite corner of the floor from Santa Fe.',
    highlights: ['One table', 'By the escalators', 'Opposite Santa Fe'],
  },

  // ----------------------------- Crowne Plaza at Historic Union Station
  // One venue, two halves of one complex, as Gen Con's plans of it draw them:
  // the head house with the Grand Hall at the north-east end, and the hotel
  // running west from it through the old train shed. Illinois Street cuts
  // between the two at street level; the Illinois Street Ballroom bridges them
  // on the mezzanine above.
  {
    id: 'union-grand-hall',
    name: 'Grand Hall',
    category: 'ballroom',
    venueId: 'crowne-plaza',
    level: '1st floor',
    rect: { x: 59, y: 4, width: 10, height: 18 },
    aliases: ['Grand Hall', 'Grand Hall Southeast', 'Grand Hall Northeast', 'Gen Con Dance'],
    description:
      'The head house’s great room, under the barrel vault and the rose window, with its own south-east and north-east corners lettered off it. The busiest room in the complex, and where the Gen Con dance runs.',
    highlights: ['Busiest room here', 'Gen Con dance', 'Under the barrel vault'],
  },
  {
    id: 'union-grand-bar',
    name: 'Grand Bar',
    category: 'amenity',
    venueId: 'crowne-plaza',
    level: '1st floor',
    rect: { x: 59, y: 23, width: 8, height: 5 },
    aliases: ['Grand Hall Bar', 'Iron Horse'],
    description:
      'The bar in the corner of the Grand Hall, by the entrance to the Iron Horse. The obvious place to arrange to meet somebody in this building.',
    highlights: ['In the Grand Hall', 'Entrance to Iron Horse', 'Easy meeting point'],
  },
  {
    id: 'union-railroad-east',
    name: 'Illinois Central, Wabash, Erie, Southern & L & N',
    shortName: 'Railroad Rooms E',
    category: 'lodging',
    venueId: 'crowne-plaza',
    level: '1st floor',
    rect: { x: 71, y: 40, width: 7, height: 36 },
    aliases: ['Illinois Central', 'Wabash', 'Erie', 'Southern', 'L & N'],
    description:
      'One side of the long concourse behind the head house: five small rooms in a row, each named for a railroad that once ran through here. Single-table sessions.',
    highlights: ['Named for railroads', 'Single-table sessions', 'Along the concourse'],
  },
  {
    id: 'union-railroad-west',
    name: 'Nickel Plate, B & O, Milwaukee, C & O, New York Central & Monon',
    shortName: 'Railroad Rooms W',
    category: 'lodging',
    venueId: 'crowne-plaza',
    level: '1st floor',
    rect: { x: 57, y: 34, width: 7, height: 40 },
    aliases: [
      'Nickel Plate', 'B & O', 'Milwaukee', 'Milwaukee Alcove', 'C & O',
      'New York Central', 'Monon', 'Edison North', 'Edison South',
    ],
    description:
      'The other side of the concourse, six rooms deep, with the lift and stairway up to the Crowne Plaza at its far end. Charming, and genuinely confusing to navigate — bring the room name written down.',
    highlights: ['Named for railroads', 'Lift up to the Crowne', 'Bring the room name'],
  },
  {
    id: 'crowne-conrail',
    name: 'Conrail Station',
    shortName: 'Conrail',
    category: 'lodging',
    venueId: 'crowne-plaza',
    level: '1st floor',
    rect: { x: 40, y: 78, width: 8, height: 5 },
    aliases: ['Conrail Station', 'Conrail'],
    description:
      'A single room at the end of the hotel’s meeting corridor, furthest from everything else in the building.',
    highlights: ['One table', 'End of the corridor', 'Allow time to find it'],
  },
  {
    id: 'crowne-haymarket',
    name: 'Haymarket Station A–B & Executive Boardroom',
    shortName: 'Haymarket',
    category: 'lodging',
    venueId: 'crowne-plaza',
    level: '1st floor',
    rect: { x: 38, y: 60, width: 10, height: 17 },
    aliases: ['Haymarket Station', 'Haymarket', 'Executive Boardroom'],
    description:
      'Two lettered rooms and the boardroom next to them, at the Illinois Street end of the hotel’s meeting rooms.',
    highlights: ['Lettered A–B', 'Boardroom style', 'Nearest Illinois Street'],
  },
  {
    id: 'crowne-grand-central',
    name: 'Grand Central A–D',
    shortName: 'Grand Central',
    category: 'ballroom',
    venueId: 'crowne-plaza',
    level: '1st floor',
    rect: { x: 19, y: 60, width: 6, height: 20 },
    aliases: ['Grand Central'],
    description:
      'The Crowne Plaza’s largest space and the busiest room on the hotel side, running back from the concourse under the roof of the old train shed. Lettered A to D along its length.',
    highlights: ['Busiest room here', 'Divisible A–D', 'Under the train shed'],
  },
  {
    id: 'crowne-victoria-station',
    name: 'Victoria Station A–D',
    shortName: 'Victoria Station',
    category: 'ballroom',
    venueId: 'crowne-plaza',
    level: '1st floor',
    rect: { x: 11, y: 60, width: 6, height: 20 },
    aliases: ['Victoria Station', 'Victoria'],
    description:
      'The matching room alongside Grand Central, the same shape and lettered the same way. The two together take most of the hotel’s schedule.',
    highlights: ['Divisible A–D', 'Alongside Grand Central', 'Mid-size blocks'],
  },
  {
    id: 'crowne-pennsylvania',
    name: 'Pennsylvania Station A–C',
    shortName: 'Penn Station',
    category: 'lodging',
    venueId: 'crowne-plaza',
    level: '1st floor',
    rect: { x: 3, y: 62, width: 6, height: 16 },
    aliases: ['Pennsylvania Station', 'Penn Station', 'Pennsylvania'],
    description:
      'Three lettered rooms at the far west end of the hotel, past Victoria Station and the restrooms. The longest walk from the Grand Hall.',
    highlights: ['Lettered A–C', 'Far west end', 'Longest walk here'],
  },
  {
    id: 'crowne-illinois-ballroom',
    name: 'Illinois Street Ballroom East & West',
    shortName: 'Illinois St Ballroom',
    category: 'ballroom',
    venueId: 'crowne-plaza',
    level: 'Mezzanine',
    rect: { x: 50, y: 60, width: 10, height: 8 },
    aliases: ['Illinois Street Ballroom', 'Illinois Street'],
    description:
      'Two halves, East and West, on the mezzanine above Illinois Street — the level that ties the hotel to the head house without going outside. Stairs at its east end drop into Union Station.',
    highlights: ['East & West halves', 'Above Illinois Street', 'Stairs down to Union Station'],
  },
  {
    id: 'union-lincoln',
    name: 'Lincoln',
    category: 'lodging',
    venueId: 'crowne-plaza',
    level: 'Mezzanine',
    rect: { x: 59, y: 24, width: 8, height: 10 },
    aliases: ['Lincoln'],
    description:
      'A single room on the head house mezzanine, up above the Grand Hall and reached by its own lift. Quiet, and nobody finds it first time.',
    highlights: ['Over the Grand Hall', 'Its own lift', 'Very quiet'],
  },

  // ------------------------------------------- Hyatt Regency Indianapolis
  {
    id: 'hyatt-cosmopolitan',
    name: 'Cosmopolitan Ballroom A–D',
    shortName: 'Cosmopolitan',
    category: 'ballroom',
    venueId: 'hyatt',
    level: 'Meeting floors',
    rect: { x: 10, y: 40, width: 38, height: 16 },
    aliases: ['Cosmopolitan Ballroom', 'Cosmopolitan'],
    description:
      'The Hyatt’s busiest event space, lettered into sections for the larger scheduled blocks.',
    highlights: ['Busiest room here', 'Divisible A–D', 'Skywalk connected'],
  },
  {
    id: 'hyatt-regency-ballroom',
    name: 'Regency Ballroom A–E',
    shortName: 'Regency',
    category: 'ballroom',
    venueId: 'hyatt',
    level: 'Meeting floors',
    rect: { x: 54, y: 40, width: 38, height: 16 },
    aliases: ['Regency Ballroom', 'Regency'],
    description:
      'Second ballroom, taking the seminars and the events that need a room for a whole day.',
    highlights: ['Divisible A–E', 'All-day bookings', 'Seminars'],
  },
  {
    id: 'hyatt-studios',
    name: 'Studios 1–6',
    shortName: 'Studios',
    category: 'lodging',
    venueId: 'hyatt',
    level: 'Meeting floors',
    rect: { x: 10, y: 58, width: 38, height: 12 },
    aliases: ['Studio'],
    description:
      'Numbered studio rooms for small tables. Compact, and quick to walk between if you have back-to-back sessions.',
    highlights: ['Small tables', 'Numbered 1–6', 'Close together'],
  },
  {
    id: 'hyatt-concept-rooms',
    name: 'Concept, Directors & Named Rooms',
    shortName: 'Concept Rooms',
    category: 'lodging',
    venueId: 'hyatt',
    level: 'Meeting floors',
    rect: { x: 54, y: 58, width: 38, height: 12 },
    aliases: ['Concept', 'Directors One', 'Directors Two', 'Directors', 'Network', 'Vision', 'Discovery', 'Theory'],
    description:
      'Lettered Concept rooms and the boardroom-style Network, Vision, Discovery and Theory. The smallest scheduled spaces in the building.',
    highlights: ['Boardroom style', 'Smallest sessions here', 'Concept A–D'],
  },

  // ------------------------------------------------ Westin Indianapolis
  // Both floors from Gen Con's plans of them. The two ballrooms genuinely
  // stack — the Grand Ballroom sits directly over the Capitol — so selecting a
  // room here drops the other floor out of the way.
  {
    id: 'westin-capitol-ballroom',
    name: 'Capitol Ballroom I–III',
    shortName: 'Capitol Ballroom',
    category: 'ballroom',
    venueId: 'westin',
    level: '1st floor',
    rect: { x: 2, y: 68, width: 50, height: 14 },
    aliases: ['Capitol Ballroom', 'Capitol'],
    description:
      'Numbered in roman numerals, and where the film festival screens most of its programme. Three sections in a row along the 1st-floor concourse.',
    highlights: ['Film festival screenings', 'Divisible I–III', 'Roman numerals!'],
  },
  {
    id: 'westin-committee-rooms',
    name: 'Cabinet, Caucus, Chambers & Council',
    shortName: 'Committee Rooms',
    category: 'lodging',
    venueId: 'westin',
    level: '1st floor',
    rect: { x: 21, y: 86, width: 42, height: 8 },
    aliases: ['Cabinet', 'Caucus', 'Chambers', 'Council'],
    description:
      'Four small rooms in a row along the outside wall of the 1st floor, named after the workings of a statehouse. Single-table sessions.',
    highlights: ['Single-table sessions', 'Statehouse names', 'Four in a row'],
  },
  {
    id: 'westin-congress-chancellor',
    name: 'Congress & Chancellor',
    shortName: 'Congress',
    category: 'lodging',
    venueId: 'westin',
    level: '1st floor',
    rect: { x: 63, y: 68, width: 12, height: 16 },
    aliases: ['Congress', 'Chancellor'],
    description:
      'Two rooms stacked beside the escalators up to the ballroom floor, on the far side of the 1st floor from the Capitol rooms.',
    highlights: ['By the escalators', 'Small sessions', 'Away from the ballroom'],
  },
  {
    id: 'westin-cameral',
    name: 'Cameral',
    category: 'lodging',
    venueId: 'westin',
    level: '1st floor',
    rect: { x: 63, y: 86, width: 12, height: 7 },
    aliases: ['Cameral'],
    description:
      'The room in the hotel’s rounded corner, at the end of the 1st-floor run past Congress. One table, and a curved wall.',
    highlights: ['One table', 'In the rounded corner', 'Past Congress'],
  },
  {
    id: 'westin-lobby',
    name: 'Lobby',
    category: 'amenity',
    venueId: 'westin',
    level: '1st floor',
    rect: { x: 80, y: 46, width: 18, height: 10 },
    aliases: ['Lobby'],
    description:
      'The hotel lobby, with the lifts and the way down to parking. The shortest walk to the convention centre of any of the hotels.',
    highlights: ['Shortest walk to the ICC', 'Lifts here', 'Down to parking'],
  },
  {
    id: 'westin-grand-ballroom',
    name: 'Grand Ballroom I–V',
    shortName: 'Grand Ballroom',
    category: 'ballroom',
    venueId: 'westin',
    level: '2nd floor',
    rect: { x: 2, y: 60, width: 60, height: 30 },
    aliases: ['Grand Ballroom'],
    description:
      'The Westin’s largest space, and the busiest room in the building: I, II and III stacked at one end, then IV and V as full-depth spans. Section V takes Gen Con’s second stage. Roman numerals, which the schedule mixes with ampersands.',
    highlights: ['Busiest room here', 'Divisible I–V', 'Second stage in V'],
  },
  {
    id: 'westin-house-senate',
    name: 'House & Senate I–III',
    shortName: 'House & Senate',
    category: 'lodging',
    venueId: 'westin',
    level: '2nd floor',
    rect: { x: 64, y: 62, width: 12, height: 30 },
    aliases: ['House', 'Senate'],
    description:
      'House, and the three numbered Senate rooms below it, in a stack along the outside wall of the ballroom floor by the escalators down.',
    highlights: ['Senate I–III', 'By the escalators', 'Single-table sessions'],
  },
  {
    id: 'westin-executive-club',
    name: 'Executive Club Lounge',
    shortName: 'Club Lounge',
    category: 'amenity',
    venueId: 'westin',
    level: '2nd floor',
    rect: { x: 64, y: 20, width: 12, height: 16 },
    aliases: ['Executive Club Lounge', 'Club Lounge'],
    description:
      'The hotel’s club lounge, on the wing that runs off the far end of the ballroom floor.',
    highlights: ['Club lounge', 'Off the ballroom floor', 'Quiet corner'],
  },
  {
    id: 'westin-capitol-overlook',
    name: 'Capitol Overlook East & North',
    shortName: 'Capitol Overlook',
    category: 'lodging',
    venueId: 'westin',
    level: '2nd floor',
    rect: { x: 66, y: 3, width: 11, height: 13 },
    aliases: ['Capitol Overlook', 'Capitol Overlook East', 'Capitol Overlook North'],
    description:
      'Two long rooms at the end of the club wing, looking out over the statehouse. The furthest scheduled rooms from the ballroom, and worth the walk for the view.',
    highlights: ['East & North', 'Statehouse view', 'Furthest from the ballroom'],
  },

  // --------------------------------- Hilton Indianapolis Hotel & Suites
  {
    id: 'hilton-victory-ballroom',
    name: 'Victory Ballroom',
    shortName: 'Victory',
    category: 'ballroom',
    venueId: 'hilton',
    level: 'Meeting floors',
    rect: { x: 6, y: 38, width: 34, height: 18 },
    aliases: ['Victory Ballroom', 'Victory'],
    description:
      'The Hilton’s main event room and the busiest here. Worth remembering the Hilton is a walk rather than a skywalk hop.',
    highlights: ['Busiest room here', 'Walk, not skywalk', 'Allow ten minutes'],
  },
  {
    id: 'hilton-monument-hall',
    name: 'Monument Hall',
    shortName: 'Monument Hall',
    category: 'ballroom',
    venueId: 'hilton',
    level: 'Meeting floors',
    rect: { x: 46, y: 38, width: 32, height: 18 },
    aliases: ['Monument Hall', 'Monument'],
    description:
      'Second event space, named for the monument it sits near. Mid-size scheduled blocks.',
    highlights: ['Mid-size blocks', 'Near the monument', 'North of the ICC'],
  },
  {
    id: 'hilton-meeting-rooms',
    name: 'Vincennes, Corydon & Indianapolis',
    shortName: 'Small Rooms',
    category: 'lodging',
    venueId: 'hilton',
    level: 'Meeting floors',
    rect: { x: 6, y: 62, width: 72, height: 16 },
    aliases: ['Vincennes Room', 'Corydon Room', 'Vincennes', 'Corydon', 'Indianapolis Ballroom'],
    description:
      'Small rooms named after Indiana’s former and current capitals. A handful of sessions each day.',
    highlights: ['Named for state capitals', 'Small sessions', 'Few events daily'],
  },

  // -------------------------------------------------- Omni Severin Hotel
  // Two floors from Gen Con's plans of them: the Severin Ballroom and the tree
  // and flower rooms off the 1st-floor lobby, and everything else — Gates,
  // McClellan, Fisher, and the university rooms — up on the 2nd.
  {
    id: 'omni-severin-ballroom',
    name: 'Severin Ballroom',
    shortName: 'Severin',
    category: 'ballroom',
    venueId: 'omni',
    level: '1st floor',
    rect: { x: 62, y: 4, width: 32, height: 22 },
    aliases: ['Severin Ballroom', 'Severin'],
    description:
      'The 1st floor’s own ballroom, off the lower lobby and the stairs up to the meeting floor. The only large room you reach without going upstairs.',
    highlights: ['Off the lower lobby', 'No stairs needed', 'Mid-size blocks'],
  },
  {
    id: 'omni-cardinal-peony-poplar',
    name: 'Cardinal, Peony & Poplar',
    shortName: 'Cardinal & Peony',
    category: 'lodging',
    venueId: 'omni',
    level: '1st floor',
    rect: { x: 3, y: 4, width: 13, height: 40 },
    aliases: ['Cardinal', 'Peony', 'Poplar', 'Ralston', 'Salon', 'Parlor', 'Boardroom'],
    description:
      'A column of small rooms down one side of the 1st floor, named for a bird, a flower and a tree. One table each, and easy to walk straight past.',
    highlights: ['One table each', 'Birds, flowers & trees', 'Easy to miss'],
  },
  {
    id: 'omni-sycamore',
    name: 'Sycamore',
    category: 'lodging',
    venueId: 'omni',
    level: '1st floor',
    rect: { x: 17, y: 4, width: 13, height: 8 },
    aliases: ['Sycamore'],
    description:
      'A single room at the corner of the 1st floor, past the restrooms and the way down to the basement.',
    highlights: ['One table', 'Corner of the floor', 'Past the restrooms'],
  },
  {
    id: 'omni-gates-hall',
    name: 'Gates Hall',
    shortName: 'Gates Hall',
    category: 'ballroom',
    venueId: 'omni',
    level: '2nd floor',
    rect: { x: 3, y: 70, width: 28, height: 18 },
    aliases: ['Gates Hall', 'Gates'],
    description:
      'The Omni’s busiest event room, on the 2nd floor overlooking Union Station, with Illinois alongside it.',
    highlights: ['Busiest room here', 'Across from Union Station', 'Illinois alongside'],
  },
  {
    id: 'omni-mcclellan-hall',
    name: 'McClellan Hall',
    shortName: 'McClellan Hall',
    category: 'ballroom',
    venueId: 'omni',
    level: '2nd floor',
    rect: { x: 3, y: 54, width: 28, height: 15 },
    aliases: ['McClellan Hall', 'McClellan'],
    description:
      'Second hall, directly below Gates on the same corridor and running scheduled play alongside it.',
    highlights: ['Scheduled play', 'Mid-size blocks', 'Next to Gates'],
  },
  {
    id: 'omni-fisher-ballroom',
    name: 'Fisher Ballroom',
    shortName: 'Fisher',
    category: 'ballroom',
    venueId: 'omni',
    level: '2nd floor',
    rect: { x: 66, y: 52, width: 17, height: 34 },
    aliases: ['Fisher Ballroom', 'Fisher'],
    description:
      'The largest room on the meeting floor, facing Gates and McClellan across the atrium, with Meridian at its far end.',
    highlights: ['Largest room here', 'Across the atrium', 'Meridian alongside'],
  },
  {
    id: 'omni-meridian',
    name: 'Meridian',
    category: 'lodging',
    venueId: 'omni',
    level: '2nd floor',
    rect: { x: 60, y: 85, width: 22, height: 5 },
    aliases: ['Meridian Ballroom', 'Meridian'],
    description:
      'A long room across the end of the Fisher Ballroom, on the Meridian Street side of the building.',
    highlights: ['Off the Fisher', 'Meridian Street side', 'Small sessions'],
  },
  {
    id: 'omni-illinois',
    name: 'Illinois',
    category: 'lodging',
    venueId: 'omni',
    level: '2nd floor',
    rect: { x: 26, y: 89, width: 22, height: 7 },
    aliases: ['Illinois Ballroom', 'Illinois'],
    description:
      'The matching room at the end of Gates Hall, on the Illinois Street side and looking across at Union Station.',
    highlights: ['Off Gates Hall', 'Illinois Street side', 'Small sessions'],
  },
  {
    id: 'omni-university-rooms',
    name: 'Butler, Indiana, Notre Dame & Purdue',
    shortName: 'University Rooms',
    category: 'lodging',
    venueId: 'omni',
    level: '2nd floor',
    rect: { x: 3, y: 4, width: 11, height: 46 },
    aliases: ['Butler', 'Indiana', 'Indiana (Salon B)', 'Notre Dame', 'Purdue'],
    description:
      'Four small rooms in a column running off the end of the meeting-floor corridor, each named for an Indiana university. One table each.',
    highlights: ['One table each', 'Named for universities', 'End of the corridor'],
  },

  // ------------------------------ Embassy Suites Indianapolis Downtown
  {
    id: 'embassy-ambassador',
    name: 'Ambassador I–III',
    shortName: 'Ambassador',
    category: 'ballroom',
    venueId: 'embassy-suites',
    level: 'Meeting floors',
    rect: { x: 8, y: 32, width: 74, height: 18 },
    aliases: ['Ambassador'],
    description:
      'The Embassy Suites’ main event rooms, numbered in roman numerals and taking most of its small schedule.',
    highlights: ['Most of the schedule', 'Divisible I–III', 'On Georgia Street'],
  },
  {
    id: 'embassy-chancellor',
    name: 'Chancellor, Coronation, Consulate & Envoy',
    shortName: 'Chancellor',
    category: 'lodging',
    venueId: 'embassy-suites',
    level: 'Meeting floors',
    rect: { x: 8, y: 58, width: 74, height: 24 },
    aliases: ['Chancellor', 'Coronation', 'Consulate', 'Envoy'],
    description:
      'Diplomatically named side rooms — Chancellor, Coronation, Consulate, Envoy. A few sessions each day.',
    highlights: ['Few events daily', 'Small tables', 'Short walk to the ICC'],
  },

  // ------------------------------------------------------- Offsite venues
  {
    id: 'indiana-rep-stage',
    name: 'Indiana Repertory Theatre',
    shortName: 'Indiana Rep',
    category: 'venue',
    venueId: 'indiana-rep',
    level: 'Auditorium',
    rect: WHOLE_VENUE,
    fillsVenue: true,
    aliases: ['140 W Washington St'],
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
    aliases: ['Circle Centre', 'Circle Center'],
    description:
      'Skywalk-connected mall with a food court and restaurants. No events are scheduled here — it is the reliable option when convention center concession lines are 30 deep.',
    highlights: ['Food court', 'Restaurants', 'Skywalk connected'],
  },
];

export const ROOMS_BY_ID: Record<string, Room> = Object.fromEntries(
  ROOMS.map((room) => [room.id, room]),
);

/**
 * The outlines a room takes from its venue's floor plan.
 *
 * Empty for a room in a building whose plans we don't have, or one the plan
 * doesn't letter — those fall back to their schematic rectangle. Several
 * labels can name one shape, as a block of meeting rooms divided by airwalls
 * does, so the rings are deduplicated.
 */
const ROOM_SHAPES = new Map<string, readonly PlanRing[]>(
  ROOMS.map((room) => {
    const rings = new Set<PlanRing>();
    for (const label of room.plan ?? []) {
      const ring = PLAN_SHAPES[`${room.venueId}/${room.level}/${label.trim().toUpperCase()}`];
      if (ring) rings.add(ring);
    }
    return [room.id, [...rings]];
  }),
);

export function roomShapes(room: Room): readonly PlanRing[] {
  return ROOM_SHAPES.get(room.id) ?? [];
}

/** Shapes a room already draws needn't be drawn again as background detail. */
const CLAIMED = new Set<PlanRing>([...ROOM_SHAPES.values()].flat());

/**
 * The rest of a floor: its prefunction space, service cores, restrooms, airwall
 * lines, and any lettered space no room claims.
 */
export function planDetail(venueId: string, level: string): readonly PlanDetail[] {
  return (PLAN_DETAIL[`${venueId}/${level}`] ?? []).filter((shape) => !CLAIMED.has(shape.ring));
}

function ringBounds(rings: readonly PlanRing[]): [LatLng, LatLng] {
  const points = rings.flat();
  const lats = points.map(([lat]) => lat);
  const lngs = points.map(([, lng]) => lng);
  return [
    { lat: Math.max(...lats), lng: Math.min(...lngs) },
    { lat: Math.min(...lats), lng: Math.max(...lngs) },
  ];
}

/** A room's footprint on the real map: its plan outline, or its schematic rect. */
export function roomBounds(room: Room): [LatLng, LatLng] {
  const shapes = roomShapes(room);
  if (shapes.length > 0) return ringBounds(shapes);
  const venue = VENUES_BY_ID[room.venueId];
  return localRectToBounds(room.rect, venue.grid, venue.anchor);
}

/**
 * The line drawn around a venue.
 *
 * A building whose interior comes from a floor plan is outlined from the same
 * drawing, so the two agree. Anything else is outlined by its OpenStreetMap
 * footprint, which is still the surveyed shape of the building and still what
 * `footprints.ts` holds for every venue including this one.
 */
export function venueOutline(venue: Venue): FootprintRing | PlanRing {
  return PLAN_OUTLINE[venue.id] ?? venue.footprint;
}

/** A venue's own footprint on the real map: the bounds of its OSM outline. */
export function venueBounds(venue: Venue): [LatLng, LatLng] {
  return localRectToBounds(venue.grid, venue.grid, venue.anchor);
}

