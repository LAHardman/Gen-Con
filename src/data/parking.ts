import { fromPack } from './pack-runtime';
/**
 * Where to leave a car, and what that costs.
 *
 * THIS FILE USED TO SAY GEN CON RAN NO CAR PARK AND PRICED NOTHING. That was
 * read off `gencon.com/attend/parking` on 2026-08-26, and it was wrong twice
 * over: the URL had been retired — it now redirects to the front page, which
 * is why it named no rates — and since 2025 Gen Con has had an official
 * parking partner. iPark runs the lots around Lucas Oil Stadium and a free
 * shuttle to the convention centre, and prices them per convention. The
 * lesson kept from that mistake is in the probe: a page that answers 200 has
 * not necessarily answered the question, and a redirect to a front page is
 * indistinguishable from a page with nothing on it unless something checks.
 *
 * SO THERE ARE TWO KINDS OF ENTRY HERE, AND THEY SAY WHICH THEY ARE.
 *
 * `published` — Gen Con's own partner, whose price is a rate card and not an
 * estimate. It is a single figure when it is known, and it is `null` between
 * conventions: iPark lists Gen Con among its events when reservations open
 * and takes it down again afterwards, so for much of the year there is no
 * price to have. Null prints as "priced when booking opens" rather than as
 * free, and the entry still carries its link, because knowing the option
 * exists is most of what this list is for.
 *
 * `reported` — the downtown garages, whose money is second-hand: what
 * attendees say on Gen Con's forums, year on year, given as a range because
 * that is the shape of the evidence. A garage two streets out is $22–26 a
 * day in an ordinary week and asks $36–38 during the convention; drive-up on
 * the Saturday is dearer again. Printing one figure would invent a precision
 * nobody has. The budget seeds a line from the middle of the range and every
 * one is editable, because the number that matters is the one on the ticket
 * somebody actually bought.
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
  /**
   * Daily rate during the convention, in whole cents.
   *
   * A range for the reported ones, the same figure twice for a published
   * rate card, and null where the operator prices per convention and has not
   * published this one's yet. Null is not zero and must never be shown as a
   * price: it means nobody has said, which is a different thing from free.
   */
  lowCents: number | null;
  highCents: number | null;
  /** Whether you can reach the hall without crossing a road. */
  skywalk: boolean;
  /** What makes this one worth knowing about, in a phrase. */
  note: string;
  /**
   * Where the money came from: a rate card, or what attendees report.
   * The page prints the difference rather than levelling them.
   */
  rate: 'published' | 'reported';
  /** Gen Con's own parking partner, as opposed to a garage that is simply near. */
  official?: boolean;
  /** Where it is booked, for the ones that are booked ahead rather than driven into. */
  reserveUrl?: string;
  /** A free shuttle to the hall, where the operator runs one. */
  shuttle?: boolean;
}

/** When these were last read off their sources. */
const COMPILED_CHECKED = '2026-08-28';

/**
 * Gen Con's own word on parking, which is a help-centre article rather than
 * a page on the site — and is the reason the old `/attend/parking` URL
 * answered nothing. The article names iPark and links to the booking.
 */
export const OFFICIAL_SOURCE =
  'https://gencon.zendesk.com/hc/en-us/articles/16471786822036-Parking-for-Gen-Con-Indy';

/** Where the reported ranges were read: Gen Con's own forums. */
export const REPORTED_SOURCE = 'https://www.gencon.com/forums';

/** Where iPark lists its events, and prices Gen Con's lots when booking is open. */
export const IPARK_EVENTS = 'https://www.ipco.services/payments/events';

/**
 * The garages people actually use, nearest first.
 *
 * Not every car park downtown — a list of forty is a list nobody reads. These
 * are the ones named repeatedly in the forum threads, which is a better filter
 * than distance alone: the Pan Am garage is closer than most and has been shut
 * for construction, and no distance calculation would know that.
 */
const COMPILED_GARAGES: readonly Garage[] = [
  /*
   * Gen Con's own, and first because it is the only one on this list that
   * Gen Con will stand behind. The lots sit around Lucas Oil Stadium — the
   * position is the stadium itself, since it is several lots rather than
   * one — and the walk the distance implies is not the walk anybody takes:
   * the point of it is the free shuttle to the hall. The price is iPark's
   * to set and is only listed while booking is open, so it is null for most
   * of the year and the season check fills it in when it appears.
   */
  {
    id: 'ipark-lucas-oil',
    name: 'iPark · Lucas Oil lots (official)',
    address: '500 South Capitol Avenue, Indianapolis',
    lat: 39.760_1,
    lng: -86.163_9,
    metres: 672,
    lowCents: null,
    highCents: null,
    skywalk: false,
    rate: 'published',
    official: true,
    shuttle: true,
    reserveUrl: IPARK_EVENTS,
    note: 'Gen Con\'s official partner since 2025. Reserved ahead, with a free shuttle to the convention centre — the distance below is the drive, not the walk.',
  },
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
    rate: 'reported',
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
    rate: 'reported',
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
    rate: 'reported',
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
    rate: 'reported',
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
    rate: 'reported',
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
    rate: 'reported',
    note: 'East, past the Hyatt. Usually has room when the near ones are full.',
  },
];

/**
 * The pack's copy where one is held, else what was compiled in.
 *
 * Parking prices move every convention and are published on somebody else's
 * page, which is exactly the shape of thing the pack exists for: a phone
 * that can no longer be updated through a store can still take this year's
 * rate card from a pack refresh.
 */
const PACKED = fromPack('parking', {
  GARAGES: COMPILED_GARAGES,
  CHECKED: COMPILED_CHECKED,
});

export const GARAGES = PACKED.GARAGES;
export const CHECKED = PACKED.CHECKED;

/**
 * What a line is seeded with: the middle of a reported range, the figure
 * itself where it is a rate card, and null where nobody has published one.
 *
 * Null rather than 0 all the way through, because 0 is a price and this is
 * the absence of one — a budget line seeded at nothing reads as free parking
 * and quietly understates the trip.
 */
export const typicalCents = (garage: Garage): number | null =>
  garage.lowCents === null || garage.highCents === null
    ? null
    : Math.round((garage.lowCents + garage.highCents) / 2);

export const GARAGES_BY_ID: Record<string, Garage> = Object.fromEntries(
  GARAGES.map((garage) => [garage.id, garage]),
);
