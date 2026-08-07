/**
 * The places Gen Con schedules that the map has no floor plan for.
 *
 * Forty events of 27,467 happen somewhere the map draws nothing: a loft on
 * McCrea Street, a brewpub, a steakhouse, a ballpark, a museum lawn. Until now
 * they resolved to no room and so did not exist — you could not search them,
 * could not see when they were, and could not be told which way to walk.
 *
 * The answer is deliberately *not* a room. A room here means an outline
 * somebody traced, on a floor with circulation drawn, inside a building with a
 * surveyed footprint — and none of that is true of a steakhouse two blocks
 * away. What is true is that it has a street address, and a street address is
 * a point. So these are pins: a coordinate, the address it came from, and the
 * events happening there. They route exactly as a tapped point routes, which
 * is what somebody wants from them.
 *
 * WHERE THE COORDINATE COMES FROM, in order, because a pin that is confidently
 * in the wrong block is worse than no pin:
 *
 *   1. `addresses.ts`, the OpenStreetMap gazetteer, matched on the number and
 *      the street. This is most of them and it needs no hand entry — a venue
 *      Gen Con adds next year works if OSM has it.
 *   2. the same gazetteer, matched on the *name* the schedule writes, since
 *      "St. Elmo Steak House" is in OSM under that name.
 *   3. `RESOLVED` below, for the four OpenStreetMap has no address for. Each
 *      one is written down with what answered it, so it can be checked.
 *
 * ABBREVIATION IS THE WHOLE OF STEP 1. Gen Con writes `127 S Illinois St` and
 * OpenStreetMap writes `South Illinois Street`; it writes `310 South S
 * Delaware St`, with the directional in twice, and `30 S Meridian St.` with a
 * full stop. Neither side is wrong and neither is going to change, so both
 * ends are normalised to the same shape here rather than either being rewritten
 * at its source.
 */

import { ADDRESSES, type StreetAddress } from './addresses';
import type { ConEvent } from './events';

/** A place with an address and no inside. */
export interface Pin {
  /** Stable, and derived from the address so two events at one place share it. */
  id: string;
  /** What the schedule calls it — "St. Elmo Steak House". */
  name: string;
  /** One line, as it would be written on an envelope. */
  address: string;
  lat: number;
  lng: number;
}

/** Which way along the street. These are abbreviated wherever they appear. */
const DIRECTIONS: Record<string, string> = {
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  ne: 'northeast',
  nw: 'northwest',
  se: 'southeast',
  sw: 'southwest',
};

/**
 * What sort of street it is, and these are expanded only as the *last* word.
 *
 * Which is not fussiness. `st` is both Street and Saint, and downtown
 * Indianapolis has a St. Elmo Steak House on South Illinois Street — expand it
 * wherever it appears and the restaurant becomes "Street Elmo", findable by
 * nobody. A street type comes last in an American address and a saint comes
 * first, so the position is the whole of the distinction and it is reliable.
 *
 * Only the ones downtown actually uses. A longer list is not more correct — it
 * is more chances to turn a street into a different street.
 */
const STREET_TYPES: Record<string, string> = {
  st: 'street',
  ave: 'avenue',
  av: 'avenue',
  blvd: 'boulevard',
  dr: 'drive',
  rd: 'road',
  ln: 'lane',
  ct: 'court',
  pl: 'place',
  sq: 'square',
  cir: 'circle',
  pkwy: 'parkway',
  ter: 'terrace',
  hwy: 'highway',
};

/** Lower case, no punctuation, single spaces. What both sides get compared as. */
export function plainWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * A street reduced to the words that identify it.
 *
 * `plainWords`, then the abbreviations spelled out, then a repeated word
 * dropped — which is what `310 South S Delaware St` needs, since spelling out
 * its `S` gives "south south delaware street" and the gazetteer has one south.
 */
export function plainStreet(text: string): string {
  const words = plainWords(text).split(' ').filter(Boolean);
  const spelled = words.map((word, at) =>
    at === words.length - 1 ? (STREET_TYPES[word] ?? DIRECTIONS[word] ?? word) : (DIRECTIONS[word] ?? word),
  );
  return spelled.filter((word, at) => word !== spelled[at - 1]).join(' ');
}

/** The house number a line of address starts with, and the street after it. */
function splitAddress(text: string): { number: string; street: string } | null {
  // Everything up to the first comma is the street line; a comma starts the
  // city, which is always Indianapolis here and never distinguishes anything.
  const line = text.split(',')[0].trim();
  const found = /^([0-9]+[A-Za-z]?)\s+(.*)$/.exec(line);
  if (!found || !found[2].trim()) return null;
  return { number: found[1], street: plainStreet(found[2]) };
}

const BY_ADDRESS = new Map<string, StreetAddress>();
const BY_NAME = new Map<string, StreetAddress>();
for (const entry of ADDRESSES) {
  BY_ADDRESS.set(`${entry.number.toLowerCase()} ${plainStreet(entry.street)}`, entry);
  if (entry.name) BY_NAME.set(plainWords(entry.name), entry);
}

/**
 * The four OpenStreetMap has no address for, and what answered each.
 *
 * Resolved through Nominatim against the same OpenStreetMap data the gazetteer
 * comes from, then read back to check the answer is the place the schedule
 * meant rather than a house of the same number on a different street. The
 * `found` line is what it returned, kept so somebody can disagree with it.
 */
const RESOLVED: ReadonlyArray<{
  /** As the schedule writes the location. Matched case-insensitively. */
  location: string;
  address: string;
  lat: number;
  lng: number;
  found: string;
}> = [
  {
    location: 'Janus Lofts',
    address: '255 McCrea St, Indianapolis, IN 46225',
    lat: 39.763229,
    lng: -86.159096,
    found: '255, McCrea Street, Indianapolis, Marion County, Indiana, 46225',
  },
  {
    location: '416 Wabash',
    address: '416 E Wabash St, Indianapolis, IN',
    lat: 39.769151,
    lng: -86.150052,
    found: '416, East Wabash Street, Indianapolis, Marion, Indiana, 46204',
  },
  {
    location: 'The Oceanaire Seafood Room',
    address: '30 S Meridian St, Indianapolis, IN',
    lat: 39.766104,
    lng: -86.158516,
    found: '30 South Meridian, 30, South Meridian Street, Indianapolis, Marion, Indiana',
  },
  {
    // The schedule gives the park, which is 350 m across and mostly lawn; the
    // room field gives the lawn of the museum inside it, which is where the
    // 5k starts. The museum is the pin, because the park's own centre is a
    // quarter of a mile from anything anybody is walking to.
    location: 'White River State Park',
    address: 'Indiana State Museum, 650 W Washington St, Indianapolis',
    lat: 39.76883,
    lng: -86.169336,
    found: 'Indiana State Museum, 650, West Washington Street, Indianapolis, Marion County',
  },
];

const pinOf = (name: string, address: string, lat: number, lng: number): Pin => ({
  // The coordinate is the identity: two events at one address are one pin, and
  // the same place written two ways is still one place.
  id: `pin:${lat.toFixed(6)},${lng.toFixed(6)}`,
  name,
  address,
  lat,
  lng,
});

/**
 * The pin an event stands on, where the map draws no room for it.
 *
 * Answers only for events the room matcher could not place — call it after
 * `roomIdForEvent`, not instead of it. An event in Exhibit Hall B has a room
 * and does not want a pin.
 */
export function pinForEvent(event: ConEvent): Pin | null {
  const location = (event.locationText ?? '').trim();
  const line = (event.roomText ?? '').trim();
  if (!location && !line) return null;

  const written = RESOLVED.find((row) => row.location.toLowerCase() === location.toLowerCase());
  if (written) return pinOf(location, written.address, written.lat, written.lng);

  const parts = splitAddress(line);
  const byAddress = parts && BY_ADDRESS.get(`${parts.number.toLowerCase()} ${parts.street}`);
  if (byAddress) return pinOf(location || byAddress.name || line, line, byAddress.lat, byAddress.lng);

  const byName = BY_NAME.get(plainWords(location));
  if (byName) {
    return pinOf(location, line || `${byName.number} ${byName.street}`, byName.lat, byName.lng);
  }
  return null;
}

/** Every pin the schedule reaches, with the events standing on each. */
export function pinsForEvents(events: readonly ConEvent[]): Map<string, { pin: Pin; events: ConEvent[] }> {
  const found = new Map<string, { pin: Pin; events: ConEvent[] }>();
  for (const event of events) {
    const pin = pinForEvent(event);
    if (!pin) continue;
    const at = found.get(pin.id);
    if (at) at.events.push(event);
    else found.set(pin.id, { pin, events: [event] });
  }
  for (const { events: list } of found.values()) {
    list.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  }
  return found;
}

/** Anywhere on the campus somebody might type, as a pin they can walk to. */
export function addressPin(entry: StreetAddress): Pin {
  return pinOf(entry.name ?? `${entry.number} ${entry.street}`, `${entry.number} ${entry.street}`, entry.lat, entry.lng);
}

/**
 * The four written down above, as pins, so they can be searched for by name.
 *
 * They are the ones OpenStreetMap has no address for, which means the
 * gazetteer cannot offer them — and "Janus Lofts" is exactly the sort of thing
 * somebody types, since it is what the schedule calls it and what is on the
 * building.
 */
export const NAMED_PINS: ReadonlyArray<Pin> = RESOLVED.map((row) =>
  pinOf(row.location, row.address, row.lat, row.lng),
);
