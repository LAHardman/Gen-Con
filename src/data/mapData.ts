/**
 * Schematic map data for the Gen Con footprint in downtown Indianapolis.
 *
 * Coordinates live in an abstract "world" space (see WORLD_WIDTH/WORLD_HEIGHT);
 * the map view maps that space onto the screen. The layout is a readable
 * approximation of how the venues relate to each other — it is deliberately
 * schematic rather than a surveyed floor plan, so treat room positions as a
 * wayfinding aid and not as official dimensions.
 *
 * Everything the map draws comes from this file, so swapping in more accurate
 * geometry (or a different convention entirely) is a data change, not a code
 * change.
 */

export const WORLD_WIDTH = 2400;
export const WORLD_HEIGHT = 1690;

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
  exhibit: { label: 'Exhibit hall', fill: '#2f4858', stroke: '#5f9ea0' },
  ballroom: { label: 'Ballroom', fill: '#4a3357', stroke: '#a17ec0' },
  meeting: { label: 'Meeting rooms', fill: '#2e4636', stroke: '#68a97d' },
  gaming: { label: 'Open gaming', fill: '#553a24', stroke: '#c9903f' },
  amenity: { label: 'Services', fill: '#3b3d4a', stroke: '#8a90a8' },
  lodging: { label: 'Hotel', fill: '#4a2b32', stroke: '#c47a86' },
  venue: { label: 'Offsite venue', fill: '#243c4d', stroke: '#4f89b0' },
};

export interface Building {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius, in world units. */
  radius?: number;
}

export interface Room {
  id: string;
  name: string;
  /** Compact label drawn inside the room shape. Falls back to `name`. */
  shortName?: string;
  category: RoomCategory;
  building: string;
  level: string;
  x: number;
  y: number;
  width: number;
  height: number;
  description: string;
  /** What you'd typically go here for. */
  highlights: string[];
}

/** Decorative connectors (skywalks, concourse links) drawn under the rooms. */
export interface Connector {
  id: string;
  label: string;
  points: Array<[number, number]>;
}

export const BUILDINGS: Building[] = [
  {
    id: 'icc',
    name: 'Indiana Convention Center',
    x: 180,
    y: 180,
    width: 1760,
    height: 940,
    radius: 24,
  },
  {
    id: 'lucas-oil',
    name: 'Lucas Oil Stadium',
    x: 240,
    y: 1270,
    width: 740,
    height: 320,
    radius: 90,
  },
  {
    id: 'hotel-row',
    name: 'Connected hotels',
    x: 1040,
    y: 1270,
    width: 900,
    height: 320,
    radius: 24,
  },
  {
    id: 'circle-centre',
    name: 'Circle Centre Mall',
    x: 2010,
    y: 380,
    width: 330,
    height: 420,
    radius: 24,
  },
];

/**
 * The area to open on when the full campus would render too small to read.
 *
 * Horizontally it covers the convention center (the part you actually navigate)
 * rather than the full world, which is stretched wide by the mall off to the
 * east. Vertically it spans everything down to the hotels so a narrow screen —
 * where the fit is width-constrained anyway — gets a balanced frame instead of
 * dead space above and clipped venues below.
 */
export const PRIMARY_AREA = { x: 140, y: 140, width: 1840, height: 1490 };

export const CONNECTORS: Connector[] = [
  {
    id: 'skywalk-stadium',
    label: 'Skywalk to Lucas Oil Stadium',
    points: [
      [610, 1120],
      [610, 1270],
    ],
  },
  {
    id: 'skywalk-hotels',
    label: 'Skywalk to hotel row',
    points: [
      [1360, 1120],
      [1360, 1270],
    ],
  },
  {
    id: 'skywalk-mall',
    label: 'Skywalk to Circle Centre',
    points: [
      [1940, 590],
      [2010, 590],
    ],
  },
];

export const ROOMS: Room[] = [
  // ---------------------------------------------------------------- Level 1 —
  // Ballrooms and headline programming space along the north side.
  {
    id: 'sagamore-ballroom',
    name: 'Sagamore Ballroom',
    category: 'ballroom',
    building: 'Indiana Convention Center',
    level: 'Level 1',
    x: 220,
    y: 220,
    width: 480,
    height: 210,
    description:
      'The largest ballroom in the convention center, usually divided into lettered sections for seminars, industry panels and the biggest ticketed events.',
    highlights: ['Keynotes & industry panels', 'True Dungeon staging', 'Divisible into 8 sections'],
  },
  {
    id: 'wabash-ballroom',
    name: 'Wabash Ballroom',
    category: 'ballroom',
    building: 'Indiana Convention Center',
    level: 'Level 1',
    x: 715,
    y: 220,
    width: 360,
    height: 210,
    description:
      'Mid-size ballroom on the north concourse. Typically hosts the larger RPG blocks, costume contests and evening entertainment.',
    highlights: ['Costume contest', 'Large RPG blocks', 'Evening entertainment'],
  },
  {
    id: 'ballroom-500',
    name: '500 Ballroom',
    category: 'ballroom',
    building: 'Indiana Convention Center',
    level: 'Level 5',
    x: 1090,
    y: 220,
    width: 300,
    height: 210,
    description:
      'Upper-level ballroom reached from the north escalators. Quieter than the main floor and a common home for workshops and author events.',
    highlights: ['Workshops', 'Author events', 'Quieter than Level 1'],
  },
  {
    id: 'rooms-101-107',
    name: 'Meeting Rooms 101–107',
    shortName: '101–107',
    category: 'meeting',
    building: 'Indiana Convention Center',
    level: 'Level 1',
    x: 1405,
    y: 220,
    width: 240,
    height: 210,
    description:
      'Small breakout rooms off the Level 1 concourse. Expect scheduled RPG tables, seminars and GM briefings.',
    highlights: ['Scheduled RPGs', 'Seminars', 'Seats roughly 40–80 each'],
  },
  {
    id: 'rooms-108-114',
    name: 'Meeting Rooms 108–114',
    shortName: '108–114',
    category: 'meeting',
    building: 'Indiana Convention Center',
    level: 'Level 1',
    x: 1660,
    y: 220,
    width: 240,
    height: 210,
    description:
      'Continuation of the Level 1 breakout block toward the east end of the building. Closest rooms to the Georgia Street entrance.',
    highlights: ['Scheduled RPGs', 'Board game demos', 'Near the east entrance'],
  },

  // -------------------------------------------------- Concourse services strip
  {
    id: 'registration',
    name: 'Registration & Will Call',
    shortName: 'Registration',
    category: 'amenity',
    building: 'Indiana Convention Center',
    level: 'Level 1',
    x: 220,
    y: 450,
    width: 360,
    height: 150,
    description:
      'Badge pickup, will call and on-site registration. Lines are longest Wednesday evening and Thursday morning — pick up your badge early if you can.',
    highlights: ['Badge pickup', 'On-site registration', 'Busiest Thu AM'],
  },
  {
    id: 'gen-con-central',
    name: 'Gen Con Central',
    category: 'amenity',
    building: 'Indiana Convention Center',
    level: 'Level 1',
    x: 595,
    y: 450,
    width: 300,
    height: 150,
    description:
      'The information and customer service hub: event ticket exchanges, generic ticket sales, lost and found, and answers to "where is…?"',
    highlights: ['Ticket exchange', 'Generic tickets', 'Lost & found'],
  },
  {
    id: 'food-court',
    name: 'Concourse Food Court',
    shortName: 'Food Court',
    category: 'amenity',
    building: 'Indiana Convention Center',
    level: 'Level 1',
    x: 910,
    y: 450,
    width: 280,
    height: 150,
    description:
      'Concession stands along the main concourse. Fast, expensive, and reliably packed between noon and 2pm — Georgia Street food trucks are the usual escape valve.',
    highlights: ['Concessions & seating', 'Peak 12–2pm', 'Nearest restrooms'],
  },
  {
    id: 'rooms-201-212',
    name: 'Meeting Rooms 201–212',
    shortName: '201–212',
    category: 'meeting',
    building: 'Indiana Convention Center',
    level: 'Level 2',
    x: 1205,
    y: 450,
    width: 340,
    height: 150,
    description:
      'Level 2 breakout rooms above the main concourse. A large share of the scheduled RPG and workshop slots land here.',
    highlights: ['Scheduled RPGs', 'Workshops', 'Reached by escalator'],
  },
  {
    id: 'rooms-231-243',
    name: 'Meeting Rooms 231–243',
    shortName: '231–243',
    category: 'meeting',
    building: 'Indiana Convention Center',
    level: 'Level 2',
    x: 1560,
    y: 450,
    width: 340,
    height: 150,
    description:
      'East end of the Level 2 block. Often used for tournaments and multi-session campaign play that needs a room for the whole day.',
    highlights: ['Tournaments', 'All-day campaigns', 'Near east escalators'],
  },

  // -------------------------------------------------------------- Exhibit hall
  {
    id: 'hall-a',
    name: 'Exhibit Hall A',
    shortName: 'Hall A',
    category: 'exhibit',
    building: 'Indiana Convention Center',
    level: 'Exhibit level',
    x: 220,
    y: 630,
    width: 268,
    height: 230,
    description:
      'West end of the exhibit hall. Traditionally the entrance-adjacent aisles — the first wall of booths you hit when the hall opens.',
    highlights: ['Main hall entrance', 'Large publisher booths', 'Very busy 10am–2pm'],
  },
  {
    id: 'hall-b',
    name: 'Exhibit Hall B',
    shortName: 'Hall B',
    category: 'exhibit',
    building: 'Indiana Convention Center',
    level: 'Exhibit level',
    x: 500,
    y: 630,
    width: 268,
    height: 230,
    description:
      'Core exhibit space, generally the largest booths and the demo tables that go with them.',
    highlights: ['Flagship publisher booths', 'Demo tables', 'Release-day queues'],
  },
  {
    id: 'hall-c',
    name: 'Exhibit Hall C',
    shortName: 'Hall C',
    category: 'exhibit',
    building: 'Indiana Convention Center',
    level: 'Exhibit level',
    x: 780,
    y: 630,
    width: 268,
    height: 230,
    description: 'Mid-hall aisles: mid-size publishers, accessory makers and dice vendors.',
    highlights: ['Dice & accessories', 'Mid-size publishers', 'Art prints'],
  },
  {
    id: 'hall-d',
    name: 'Exhibit Hall D',
    shortName: 'Hall D',
    category: 'exhibit',
    building: 'Indiana Convention Center',
    level: 'Exhibit level',
    x: 1060,
    y: 630,
    width: 268,
    height: 230,
    description:
      'Continues the mid-hall aisles toward the east. Common home for miniatures, terrain and painting supplies.',
    highlights: ['Miniatures & terrain', 'Paint & hobby supplies', 'Painting demos'],
  },
  {
    id: 'hall-e',
    name: 'Exhibit Hall E',
    shortName: 'Hall E',
    category: 'exhibit',
    building: 'Indiana Convention Center',
    level: 'Exhibit level',
    x: 1340,
    y: 630,
    width: 268,
    height: 230,
    description:
      'East exhibit aisles. Usually a mix of smaller publishers, crowdfunding pickups and first-time exhibitors.',
    highlights: ['First-time exhibitors', 'Crowdfunding pickups', 'Small press'],
  },
  {
    id: 'hall-f',
    name: 'Exhibit Hall F',
    shortName: 'Hall F',
    category: 'exhibit',
    building: 'Indiana Convention Center',
    level: 'Exhibit level',
    x: 1620,
    y: 630,
    width: 268,
    height: 230,
    description:
      'Far east end of the exhibit hall, adjacent to the east entrance. Quietest aisles in the morning.',
    highlights: ['East entrance', 'Quieter mornings', 'Artists & crafters'],
  },
  {
    id: 'hall-g',
    name: 'Exhibit Hall G',
    shortName: 'Hall G',
    category: 'exhibit',
    building: 'Indiana Convention Center',
    level: 'Exhibit level',
    x: 220,
    y: 875,
    width: 322,
    height: 205,
    description:
      'South exhibit block. Frequently used for the used-game auction area and larger retail booths.',
    highlights: ['Auction & retail', 'Bring a bag', 'Wide aisles'],
  },
  {
    id: 'hall-h',
    name: 'Exhibit Hall H',
    shortName: 'Hall H',
    category: 'exhibit',
    building: 'Indiana Convention Center',
    level: 'Exhibit level',
    x: 557,
    y: 875,
    width: 322,
    height: 205,
    description: 'South exhibit block continued — costume, prop and accessory vendors cluster here.',
    highlights: ['Costume & props', 'Leatherwork', 'Photo backdrops'],
  },
  {
    id: 'hall-i',
    name: 'Exhibit Hall I',
    shortName: 'Hall I',
    category: 'exhibit',
    building: 'Indiana Convention Center',
    level: 'Exhibit level',
    x: 894,
    y: 875,
    width: 322,
    height: 205,
    description:
      'Often converted into event space rather than booths: large scheduled play areas and tournament banks.',
    highlights: ['Tournament banks', 'Scheduled play', 'Table seating'],
  },
  {
    id: 'hall-j',
    name: 'Exhibit Hall J — Open Gaming',
    shortName: 'Hall J',
    category: 'gaming',
    building: 'Indiana Convention Center',
    level: 'Exhibit level',
    x: 1231,
    y: 875,
    width: 322,
    height: 205,
    description:
      'Open gaming: rows of free tables, first come first served. Grab one, put a game out, and strangers will sit down.',
    highlights: ['Free open tables', 'Library check-out', 'Runs late into the night'],
  },
  {
    id: 'hall-k',
    name: 'Exhibit Hall K — Family Fun',
    shortName: 'Hall K',
    category: 'gaming',
    building: 'Indiana Convention Center',
    level: 'Exhibit level',
    x: 1568,
    y: 875,
    width: 322,
    height: 205,
    description:
      'Family and kids programming, plus overflow open gaming. Lower noise and shorter sessions than the main hall.',
    highlights: ['Kids & family events', 'Short sessions', 'Overflow open gaming'],
  },

  // ----------------------------------------------------------- Offsite venues
  {
    id: 'lucas-oil-floor',
    name: 'Lucas Oil Stadium — Field Level',
    shortName: 'Lucas Oil Stadium',
    category: 'venue',
    building: 'Lucas Oil Stadium',
    level: 'Field & club level',
    x: 300,
    y: 1330,
    width: 620,
    height: 200,
    description:
      'The stadium absorbs the events that outgrow the convention center: massive miniatures battles, large-scale open gaming and the biggest scheduled blocks. Allow a solid ten minutes to walk over via the skywalk.',
    highlights: ['Large-scale miniatures', 'Overflow gaming', '~10 min walk from ICC'],
  },
  {
    id: 'jw-marriott',
    name: 'JW Marriott Indianapolis',
    shortName: 'JW Marriott',
    category: 'lodging',
    building: 'Connected hotels',
    level: 'Ground + meeting floors',
    x: 1080,
    y: 1310,
    width: 250,
    height: 240,
    description:
      'The tall blue hotel on the west side of the campus. Its meeting floors host a large share of the RPG and seminar overflow, and it connects to the convention center by skywalk.',
    highlights: ['RPG & seminar overflow', 'Skywalk connected', 'Late-night bar scene'],
  },
  {
    id: 'marriott-downtown',
    name: 'Indianapolis Marriott Downtown',
    shortName: 'Marriott',
    category: 'lodging',
    building: 'Connected hotels',
    level: 'Ground + meeting floors',
    x: 1350,
    y: 1310,
    width: 230,
    height: 240,
    description:
      'Adjacent to the JW and part of the same connected block. Meeting rooms here run scheduled events all four days.',
    highlights: ['Scheduled events', 'Skywalk connected', 'Quieter than the ICC'],
  },
  {
    id: 'westin',
    name: 'Westin Indianapolis',
    shortName: 'Westin',
    category: 'lodging',
    building: 'Connected hotels',
    level: 'Ground + meeting floors',
    x: 1600,
    y: 1310,
    width: 200,
    height: 240,
    description:
      'North of the convention center and connected by skywalk. Hosts smaller event tracks and is a short indoor walk to registration.',
    highlights: ['Small event tracks', 'Shortest indoor walk', 'Skywalk connected'],
  },
  {
    id: 'circle-centre-food',
    name: 'Circle Centre Mall',
    shortName: 'Circle Centre',
    category: 'amenity',
    building: 'Circle Centre Mall',
    level: 'Levels 1–4',
    x: 2050,
    y: 430,
    width: 250,
    height: 320,
    description:
      'Skywalk-connected mall with a food court and restaurants. The reliable option when convention center concession lines are 30 deep.',
    highlights: ['Food court', 'Restaurants', 'Skywalk connected'],
  },
];

export const ROOMS_BY_ID: Record<string, Room> = Object.fromEntries(
  ROOMS.map((room) => [room.id, room]),
);
