/**
 * Parking, which Gen Con does not sell and does not price.
 *
 * WHAT WAS LOOKED FOR AND WHAT WAS FOUND. `gencon.com/attend/parking` and
 * `/attend/getting_around` were both fetched on 2026-08-26 and neither names a
 * garage or a rate — Gen Con runs no car park and publishes no rate card. The
 * Indiana Convention Center's own list at `icclos.com/attendees/parking/` is
 * the nearest thing to an authority and could not be reached from the build.
 * What is left is what attendees report on Gen Con's own forums, year on year,
 * and that is what these numbers are.
 *
 * SO THEY ARE A RANGE, AND THEY SAY SO. A garage two streets out is $22–26 a
 * day in an ordinary week and asks $36–38 during the convention; drive-up on
 * the Saturday is dearer again. Printing a single figure would be inventing a
 * precision nobody has. The budget seeds a line from the middle of the range
 * and every one of them is editable, because the number that matters is the one
 * on the ticket somebody actually bought.
 *
 * Positions and addresses are the app's own, from `addresses.ts` — those are
 * surveyed and exact. It is only the money that is reported.
 */

export interface Garage {
  id: string;
  name: string;
  /** As it would be typed into a satnav. */
  address: string;
  lat: number;
  lng: number;
  /**
   * Straight-line metres from the convention centre, computed once here rather
   * than on a phone — the same trade, and the same anchor, as `lodging.ts`.
   */
  metres: number;
  /** Reported daily rate during the convention, in whole cents. */
  lowCents: number;
  highCents: number;
  /** Whether you can reach the hall without crossing a road. */
  skywalk: boolean;
  /** What makes this one worth knowing about, in a phrase. */
  note: string;
}

/** When the reports these came from were read. */
export const CHECKED = '2026-08-26';

/** Where they were read. Gen Con's own forums, which is the honest citation. */
export const SOURCE = 'https://www.gencon.com/forums';

/**
 * The garages people actually use, nearest first.
 *
 * Not every car park downtown — a list of forty is a list nobody reads. These
 * are the ones named repeatedly in the forum threads, which is a better filter
 * than distance alone: the Pan Am garage is closer than most and has been shut
 * for construction, and no distance calculation would know that.
 */
export const GARAGES: readonly Garage[] = [
  {
    id: 'circle-centre',
    name: 'Circle Centre Mall',
    address: '49 West Maryland Street, Indianapolis',
    lat: 39.765_45,
    lng: -86.158_23,
    metres: 738,
    lowCents: 3_600,
    highCents: 3_800,
    skywalk: true,
    note: 'Skywalk the whole way in. The dearest of these, and the one people keep going back to.',
  },
  {
    id: 'world-of-wonders',
    name: 'World of Wonders garage',
    address: '140 South Illinois Street, Indianapolis',
    lat: 39.764_992,
    lng: -86.160_503,
    metres: 548,
    lowCents: 3_000,
    highCents: 3_600,
    skywalk: true,
    note: 'A skywalk landing in its own right — the app routes through it.',
  },
  {
    id: 'government-center',
    name: 'Indiana Government Center',
    address: '401 West Washington Street, Indianapolis',
    lat: 39.766_363,
    lng: -86.166_212,
    metres: 93,
    lowCents: 2_200,
    highCents: 2_600,
    skywalk: true,
    note: 'Two bridges from the hall, via the JW. Cheaper because it is a state car park.',
  },
  {
    id: 'senate-avenue',
    name: 'Senate Avenue Parking Facility',
    address: '220 North Senate Avenue, Indianapolis',
    lat: 39.770_759,
    lng: -86.164_163,
    metres: 610,
    lowCents: 2_200,
    highCents: 2_600,
    skywalk: false,
    note: 'North of the hall, and an outdoor walk in an Indianapolis August.',
  },
  {
    id: 'union-station',
    name: 'Union Station garage',
    address: '301 South Meridian Street, Indianapolis',
    lat: 39.762_628,
    lng: -86.157_562,
    metres: 864,
    lowCents: 2_200,
    highCents: 2_600,
    skywalk: false,
    note: 'South of the tracks, by Lucas Oil. Handy if your events are down there.',
  },
  {
    id: 'virginia-avenue',
    name: 'Virginia Avenue garage',
    address: '155 South Delaware Street, Indianapolis',
    lat: 39.764_809,
    lng: -86.153_501,
    metres: 1146,
    lowCents: 2_000,
    highCents: 2_400,
    skywalk: false,
    note: 'East, past the Hyatt. Usually has room when the near ones are full.',
  },
];

/** The middle of the reported range — what a line is seeded with. */
export const typicalCents = (garage: Garage) => Math.round((garage.lowCents + garage.highCents) / 2);

export const GARAGES_BY_ID: Record<string, Garage> = Object.fromEntries(
  GARAGES.map((garage) => [garage.id, garage]),
);
