/**
 * Finding a room, or an event, from what somebody types.
 *
 * Two things are searchable and they behave differently. A room is a place,
 * and its useful names are the ones printed on it and the ones the schedule
 * calls it — "Hall B", "White River", "104" — so its aliases are searched
 * alongside its name. An event is a thing happening in a place, so a hit on
 * one is really a hit on the room it is in, and the same title runs many times
 * in the same room: those collapse to one result with a session count rather
 * than filling the list with repeats of "Learn to Play".
 *
 * Scoring is deliberately explainable rather than clever. Everything is ranked
 * by how a match was made, best first, and ties break on the shorter name —
 * typing "hall b" should put Exhibit Hall B above Exhibit Hall B's events, and
 * "104" should offer both buildings that have a room 104 rather than guessing.
 */

import { ROOMS, VENUES_BY_ID, type Room } from './venues';
import { roomIdForEvent, type ConEvent, type EventIndex } from './events';
import { EXHIBITORS, type Exhibitor } from './exhibitors';
import { hallForBooth } from './booths';
import { PLANNED_BOOTHS } from './booth-plan';
import { ADDRESSES } from './addresses';
import { addressPin, NAMED_PINS, plainStreet, plainWords, type Pin } from './offsite';
import { pinPlace, roomPlace, type NavPlace } from './navigation';

export interface SearchHit {
  /** Stable across renders, for list keys and keyboard selection. */
  key: string;
  kind: 'room' | 'event' | 'address';
  /** The room this is, or the room an event is in. A pin has none. */
  room?: Room;
  /**
   * Where an address is, for the places the map draws no room for.
   *
   * A room and a pin are mutually exclusive and exactly one is always set:
   * a hit is somewhere, and the two are the two kinds of somewhere there are.
   */
  pin?: Pin;
  /**
   * The stand this hit was found by, where a stand is what was matched.
   *
   * A publisher in the exhibit hall is 573 stands in six halls, and the thing
   * somebody is looking for is the *booth* — "Booth 1229" is printed on the
   * stand, printed in the programme and the only thing that narrows a hall
   * the size of a street down to a place to stand. The hall is the room the
   * route goes to; the booth is the answer.
   */
  exhibitor?: Exhibitor;
  /** The soonest session, when this hit came from an event. */
  event?: ConEvent;
  /** How many sessions share this title in this room. */
  sessions?: number;
  score: number;
}

/**
 * How big the stand is, in ten-foot booths, where the printed map says.
 *
 * The map is drawn on a strict 12 pt module, so a stand's size comes straight
 * off it. Worth saying because it is the difference between a table and a
 * pavilion — a 2×9 is ninety feet of frontage and you will not walk past it.
 */
function standSize(booth: string | undefined): string {
  if (!booth) return '';
  const stand = BOOTH_SIZE.get(booth);
  if (!stand) return '';
  // To the nearest booth. The sizes are measured off the drawing rather than
  // declared by it, so they arrive as 2.04 booths and 0.98 booths — true to a
  // couple of percent, and no way to say a stand is twenty feet across.
  const [a, b] = [Math.round(stand.across), Math.round(stand.along)].sort((x, y) => x - y);
  if (a <= 1 && b <= 1) return '';
  return ` · ${a * 10}×${b * 10} ft`;
}

const BOOTH_SIZE = new Map(PLANNED_BOOTHS.map((stand) => [stand.booth, stand]));

/** Where a hit takes you — the one thing every consumer actually wants. */
export function hitPlace(hit: SearchHit): NavPlace {
  return hit.pin ? pinPlace(hit.pin) : roomPlace(hit.room!);
}

/** What a hit is called, and the line under it. */
export function hitLabel(hit: SearchHit): { title: string; detail: string } {
  if (hit.kind === 'event') {
    const venue = hit.room ? VENUES_BY_ID[hit.room.venueId] : undefined;
    return {
      title: hit.event?.title ?? '',
      detail: hit.room
        ? `${hit.room.shortName ?? hit.room.name} · ${venue?.shortName ?? venue?.name ?? ''}`
        : (hit.pin?.name ?? ''),
    };
  }
  if (hit.pin) return { title: hit.pin.name, detail: hit.pin.address };
  const venue = VENUES_BY_ID[hit.room!.venueId];
  // A stand answers with itself and says which hall afterwards, because the
  // booth number is what is printed on it and the hall letter is not printed
  // anywhere. "Kenzer and Company · Booth 1229 · Exhibit Hall I" is the order
  // somebody reads it in; the hall alone was the old answer and it left them
  // standing in a hall the size of a street.
  if (hit.exhibitor) {
    const where = hit.room!.shortName ?? hit.room!.name;
    // A demo space is filed under the publisher's own name rather than a booth
    // number — `ICC : Hall E` / `Asmodee` — so repeating it would read
    // "Asmodee · Asmodee · Hall E".
    const spot = hit.exhibitor.spot === hit.exhibitor.name ? '' : `${hit.exhibitor.spot} · `;
    return { title: hit.exhibitor.name, detail: `${spot}${where}${standSize(hit.exhibitor.booth)}` };
  }
  return {
    title: hit.room!.name,
    detail: `${venue?.shortName ?? venue?.name ?? ''} · ${hit.room!.level}`,
  };
}

/** Lower is better. Ordered by how directly the text was matched. */
const SCORE = {
  roomNameStart: 0,
  /**
   * Typed the whole of what the room is called, so as good as it gets — and it
   * has to be at least as good as `aliasStart` below, which is where this was
   * wrong. Ranked *under* a prefix, "140" offered the Indiana Repertory Theatre
   * above the convention centre's Meeting Room 140, because the theatre's only
   * alias is its street address and that address is 140 W Washington St. The
   * one room on the campus actually called 140 came second to a coincidence of
   * house numbering.
   */
  aliasExact: 0,
  /**
   * Typed the start of one of its other names. Weaker than an exact match and
   * than the room's own name, because a prefix of an alias is the loosest thing
   * here that still counts as naming the place.
   */
  aliasStart: 1,
  roomNameWord: 2,
  roomNameAnywhere: 3,
  // A room found because somebody is standing in it. Below the room's own
  // names — "hall b" must still find Exhibit Hall B rather than a stand in it —
  // and above the building's, since a publisher is the more specific thing.
  exhibitorName: 3.5,
  /**
   * A booth number, typed exactly.
   *
   * Below a room's own name and its exact aliases, above everything else — and
   * the ordering is load-bearing rather than a taste. The convention centre
   * numbers meeting rooms in the same range the exhibit hall numbers aisles,
   * so "140" is Meeting Room 140 *and* Booth 140, and both are real answers to
   * it. Ranked above the room this offered a stand to everybody typing a room
   * number, which is the same bug the Indiana Repertory Theatre caused from
   * the other direction. Ranked here it offers both, room first, which is what
   * this search does everywhere else something is genuinely ambiguous.
   */
  boothNumber: 0.5,
  /**
   * A stand matched by the name on it, ranked just under the room that a name
   * finds directly — "hall b" is Exhibit Hall B before it is anybody standing
   * in Exhibit Hall B — and above the building, since a publisher is the more
   * specific thing.
   */
  standName: 3.4,
  venueStart: 4,
  /**
   * A street address, and every one of these is below every room on purpose.
   * The gazetteer is 839 addresses against 149 rooms; letting a house number
   * outrank a room would answer "500" with a street and hide the 500 Ballroom.
   */
  addressExact: 5,
  addressName: 5.5,
  eventTitleStart: 5,
  eventTitleAnywhere: 6,
};

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** True when `needle` starts a word in `haystack`, not just any position. */
function startsWord(haystack: string, needle: string) {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    if (at === 0 || !/[a-z0-9]/.test(haystack[at - 1])) return true;
    from = at + 1;
  }
}

/**
 * The room an exhibitor's own words name, where they name one.
 *
 * Gen Con writes an exhibitor's place the same way it writes an event's — a
 * building, a space inside it, a spot inside that — so the same matcher reads
 * both, and reading them the same way is what keeps "Hall B" meaning the same
 * thing in a schedule and in a stand list.
 *
 * The exhibit hall needs the extra step. Its labels are `Exhibit Hall : Booth
 * 1637` and there are eleven exhibit halls, so nothing in the words says which
 * — but the number does, once you know where the air walls are (`booths.ts`).
 * That places all 573 of them.
 *
 * And a handful of areas name neither a building nor a hall: see `AREA_ROOMS`.
 */
export function roomIdForExhibitor(exhibitor: Exhibitor): string | null {
  const [building, ...within] = exhibitor.area.split(' : ');
  const named = roomIdForEvent({
    locationText: building,
    roomText: within.join(' '),
    tableText: exhibitor.spot,
  } as unknown as ConEvent);
  if (named) return named;
  if (exhibitor.area === 'Exhibit Hall') return hallForBooth(exhibitor.booth);
  return AREA_ROOMS[exhibitor.area] ?? null;
}

/**
 * Areas that name a place rather than a building, and where that place is.
 *
 * The matcher above works down from a building — `ICC : Community Row` finds
 * the convention centre and then looks inside it — so an area with no building
 * in front of it has nothing to look inside. These three are like that, and
 * each one is somewhere a person knows rather than somewhere a file says:
 *
 *   Makers Market   in the connector between the convention centre and the
 *                   stadium, which is why the stand list files it outside the
 *                   exhibit hall and numbers it 7001–7108 rather than in the
 *                   grid. Its own room, drawn on that connector.
 *   Block Party     South Street, closed to traffic Wednesday to Sunday. Its
 *                   own "venue", because a closed street is not in any
 *                   building.
 *   Field           the stadium field, boarded over. Four publishers with a
 *                   demo space each, filed under an area of one word.
 *
 * And three that are all inside Exhibit Hall I, which the printed plan draws
 * as one block of tables between the 600s and the 1100s. That plan letters no
 * hall — but the schedule does, once: 18 rows read `Exhibit Hall I` in the
 * room and `Authors Avenue` in the table, which places the middle of the block
 * and so places the block. Being here rather than resolved through Hall I's
 * aliases is the point: the matcher works down from a building and none of
 * these three names one.
 *
 * Everything else that resolves does so through a room's own aliases, which is
 * where a new one should go if it can — `Community Row` and `Educator Row` are
 * both aliases of the hallway they share, not entries here.
 */
const AREA_ROOMS: Record<string, string> = {
  'Makers Market': 'makers-market',
  'Block Party': 'block-party-street',
  Field: 'lucas-oil-field',
  'Art Show': 'hall-i',
  'Authors Ave': 'hall-i',
  'Entertainers Spotlight': 'hall-i',
};

interface RoomKeys {
  room: Room;
  name: string;
  aliases: string[];
  venue: string;
  /** Who is standing in it, for the days a room is somebody's booth. */
  exhibitors: string[];
}

/** Every exhibitor name, against the room their own label names. */
const EXHIBITORS_BY_ROOM = EXHIBITORS.reduce((map, exhibitor) => {
  const roomId = roomIdForExhibitor(exhibitor);
  if (roomId) map.set(roomId, [...(map.get(roomId) ?? []), normalise(exhibitor.name)]);
  return map;
}, new Map<string, string[]>());

/**
 * Every stand, with the room it stands in and the words that find it.
 *
 * Kept as stands rather than as a list of names per room, which is what this
 * used to be, because the room was then the only thing a match could produce —
 * and for the exhibit hall the room is six halls of 400 m and the answer
 * somebody wanted was four digits. Matching the stand keeps the booth.
 */
const STANDS: ReadonlyArray<{ exhibitor: Exhibitor; room: Room; name: string; booth: string }> =
  EXHIBITORS.flatMap((exhibitor) => {
    const roomId = roomIdForExhibitor(exhibitor);
    const room = roomId ? ROOMS.find((candidate) => candidate.id === roomId) : undefined;
    return room
      ? [{ exhibitor, room, name: normalise(exhibitor.name), booth: exhibitor.booth ?? '' }]
      : [];
  });

/** Built once: every string that should find a given room. */
const ROOM_KEYS: RoomKeys[] = ROOMS.map((room) => ({
  room,
  name: normalise(room.name),
  aliases: [room.shortName, ...(room.aliases ?? [])].filter(Boolean).map((a) => normalise(a!)),
  venue: normalise(VENUES_BY_ID[room.venueId]?.name ?? ''),
  exhibitors: EXHIBITORS_BY_ROOM.get(room.id) ?? [],
}));

function scoreRoom(keys: RoomKeys, query: string): number | null {
  if (keys.name.startsWith(query)) return SCORE.roomNameStart;
  if (keys.aliases.some((alias) => alias === query)) return SCORE.aliasExact;
  if (keys.aliases.some((alias) => alias.startsWith(query))) return SCORE.aliasStart;
  if (startsWord(keys.name, query)) return SCORE.roomNameWord;
  if (keys.aliases.some((alias) => startsWord(alias, query))) return SCORE.roomNameWord;
  if (keys.name.includes(query)) return SCORE.roomNameAnywhere;
  if (keys.exhibitors.some((who) => who.startsWith(query) || startsWord(who, query))) {
    return SCORE.exhibitorName;
  }
  if (keys.venue.startsWith(query) || startsWord(keys.venue, query)) return SCORE.venueStart;
  return null;
}

/**
 * The events worth searching, prepared once per feed rather than per keystroke.
 *
 * Only events that resolved to a room are here: an event the map can't place
 * has nowhere to take you, so offering it would be a dead end.
 */
export interface EventSearchIndex {
  /** Exactly one of `room` and `pin` is set: an event happens somewhere. */
  entries: Array<{ room?: Room; pin?: Pin; event: ConEvent; title: string }>;
}

export function buildEventSearchIndex(index: EventIndex | null): EventSearchIndex {
  const entries: EventSearchIndex['entries'] = [];
  if (!index) return { entries };
  for (const [roomId, events] of index.byRoom) {
    const room = ROOMS.find((candidate) => candidate.id === roomId);
    if (!room) continue;
    for (const event of events) entries.push({ room, event, title: normalise(event.title) });
  }
  // The forty at an address rather than in a room. Searched the same way and
  // shown the same way: what somebody types is the name of the event, and
  // where it is happening is the answer either way.
  for (const { pin, events } of index.byPin.values()) {
    for (const event of events) entries.push({ pin, event, title: normalise(event.title) });
  }
  return { entries };
}

/**
 * The stands, answered as stands.
 *
 * Two ways in, and the first is the one this was missing. Typing a booth
 * number used to find nothing at all: `1229` is not a room name, not an alias
 * and not an event, so the search shrugged at the number printed on the stand,
 * in the programme and on every sign in the hall. It now answers with the
 * stand, and the hall it is in comes second — which is the way round somebody
 * reads it, since the hall letter is on no sign and the booth number is on all
 * of them.
 *
 * A name still finds the room it is in as well, ranked below this, so "hall b"
 * keeps meaning Exhibit Hall B rather than the thirteen publishers in it.
 */
function standHits(query: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const stand of STANDS) {
    const score =
      stand.booth && stand.booth === query
        ? SCORE.boothNumber
        : stand.name.startsWith(query)
          ? SCORE.standName
          : startsWord(stand.name, query)
            ? SCORE.standName + 0.5
            : null;
    if (score === null) continue;
    hits.push({
      key: `stand:${stand.exhibitor.name}:${stand.exhibitor.spot}`,
      kind: 'room',
      room: stand.room,
      exhibitor: stand.exhibitor,
      score,
    });
  }
  return hits;
}

/**
 * Addresses downtown, so that somewhere the map draws nothing is still a place.
 *
 * Ranked below every room, and that is the point rather than an accident. The
 * gazetteer holds 839 addresses and the campus holds 149 rooms, so on any
 * query they both match — "500" is the 500 Ballroom and it is also a dozen
 * house numbers — and a search that let the street win would bury the
 * convention centre under its own neighbourhood. An address is the answer when
 * nothing on the campus is.
 *
 * Two ways in, because there are two ways somebody knows a place:
 *
 *   the number and the street   `127 s illinois`, matched after both ends are
 *                               spelled out, so the abbreviation somebody types
 *                               reaches the way OpenStreetMap files it
 *   what is there               `st elmo`, matched on the name, which is what
 *                               anybody would actually type
 */
function addressHits(rawQuery: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const asked = plainStreet(rawQuery);
  const words = plainWords(rawQuery);
  const numbered = /^([0-9]+[a-z]?)\s+(.+)$/.exec(asked);

  // The four with no address in OpenStreetMap, which the gazetteer below
  // therefore cannot offer. Matched on the name and on the address, because
  // "Janus Lofts" is on the building and "255 McCrea" is in the schedule, and
  // either is a thing somebody types.
  const spoken = new Set<string>();
  for (const pin of NAMED_PINS) {
    const name = plainWords(pin.name);
    const line = plainStreet(pin.address);
    const score = name.startsWith(words)
      ? SCORE.addressName
      : line.startsWith(asked) || startsWord(name, words) || startsWord(line, asked)
        ? SCORE.addressName + 0.5
        : null;
    if (score === null) continue;
    spoken.add(name);
    hits.push({ key: `pin:${pin.id}`, kind: 'address', pin, score });
  }

  for (const entry of ADDRESSES) {
    const name = entry.name ? plainWords(entry.name) : '';
    const street = plainStreet(entry.street);
    let score: number | null = null;

    if (numbered && entry.number.toLowerCase() === numbered[1]) {
      // The number is exact and the street is what is left. A prefix is enough
      // — "127 s illinois" should find South Illinois Street without the word
      // "street" being typed.
      if (street.startsWith(numbered[2])) score = SCORE.addressExact;
    }
    if (score === null && name) {
      if (name.startsWith(words)) score = SCORE.addressName;
      else if (startsWord(name, words)) score = SCORE.addressName + 0.5;
    }
    if (score === null) continue;
    // A corner building has two addresses and OpenStreetMap files it under
    // one of them: Janus Lofts is 255 McCrea Street to Gen Con and 20 West
    // Louisiana Street to OSM, 35 m apart and the same front door. Where the
    // schedule has already named a place, its own address is the one to show.
    if (name && spoken.has(name)) continue;
    hits.push({ key: `address:${entry.number}:${entry.street}`, kind: 'address', pin: addressPin(entry), score });
  }
  // Enough to show that the street was understood, not enough to fill a list
  // with one block of a numbered avenue.
  return hits.sort((a, b) => a.score - b.score).slice(0, 4);
}

export function search(
  rawQuery: string,
  events: EventSearchIndex,
  limit = 8,
): SearchHit[] {
  const query = normalise(rawQuery);
  if (query.length < 2) return [];

  const hits: SearchHit[] = [];

  for (const keys of ROOM_KEYS) {
    const score = scoreRoom(keys, query);
    if (score !== null) hits.push({ key: `room:${keys.room.id}`, kind: 'room', room: keys.room, score });
  }

  // One hit per title per room, keeping the soonest session and counting the rest.
  const grouped = new Map<string, SearchHit>();
  for (const { room, pin, event, title } of events.entries) {
    const score = title.startsWith(query)
      ? SCORE.eventTitleStart
      : startsWord(title, query)
        ? SCORE.eventTitleStart + 0.5
        : title.includes(query)
          ? SCORE.eventTitleAnywhere
          : null;
    if (score === null) continue;

    const key = `event:${room?.id ?? pin!.id}:${title}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.sessions = (existing.sessions ?? 1) + 1;
      if (Date.parse(event.start) < Date.parse(existing.event!.start)) existing.event = event;
    } else {
      grouped.set(key, { key, kind: 'event', room, pin, event, sessions: 1, score });
    }
  }
  hits.push(...grouped.values());

  hits.push(...standHits(query));
  hits.push(...addressHits(rawQuery));

  hits.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const aText = hitLabel(a).title;
    const bText = hitLabel(b).title;
    return aText.length - bText.length || aText.localeCompare(bText);
  });

  return hits.slice(0, limit);
}
