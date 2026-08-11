/**
 * What Gen Con's block probably costs now, and what it is worth comparing to.
 *
 * TWO SEPARATE JOBS, and they fail in different ways, so they are separated.
 *
 * THE ESTIMATE takes a real 2019 block rate and carries it forward by a
 * published hotel-price index. It is arithmetic on somebody else's number and
 * the arithmetic is not the risky part — the risk is that a seven-year-old
 * negotiated rate is being presented at all, so every estimate carries its base
 * year and its multiplier and the page prints both.
 *
 * THE PAIRING answers "what would I pay instead, a similar walk away". Each
 * block hotel is matched to the nearest hotel that is *not* in the block, and no
 * non-block hotel is ever used twice — because a comparison table where the same
 * Hampton Inn is the alternative to six different hotels tells you one thing six
 * times. When two block hotels want the same neighbour the nearer one keeps it
 * and the other takes its next choice, which is a stable marriage in miniature
 * and is implemented as one.
 *
 * WHY NOT JUST TAKE THE NEAREST FOR EACH. Because that is the version that
 * looks right and is not: on this campus four block hotels sit within two
 * hundred metres of one another, and greedy nearest-neighbour hands all four the
 * same alternative. Gale–Shapley costs twenty lines and cannot do that.
 */

import { LODGING, type Lodging } from './lodging';
import {
  BLOCK_GROWTH,
  BLOCK_YEAR,
  CAVEAT,
  PARTNERS,
  SOURCE,
  SUSPECTED_IN_BLOCK,
  partnerFor,
  type Partner,
} from './partners';
import { rateFor, type Rate } from './rates';

export { BLOCK_YEAR, BLOCK_GROWTH, CAVEAT, SOURCE };

/**
 * Carried forward at the block's own observed rate.
 *
 * `BLOCK_GROWTH` is the median annual change between Gen Con's published 2025
 * rates and the 2019 rates in an attendee's forum table — about 2.8% a year,
 * measured from Gen Con's own numbers rather than from a national hotel index
 * that knows nothing about Indianapolis in the first week of August.
 *
 * The fallback exists so a missing history cannot silently produce a flat
 * projection, which would look like a confident forecast of no change.
 */
const FALLBACK_GROWTH = 0.028;

export interface BlockRate {
  partner: Partner;
  /** Starting nightly rate for `year`, USD, before tax. */
  low: number;
  /** Top of the published range, carried forward too, or null. */
  high: number | null;
  /**
   * False only for the year Gen Con actually published.
   *
   * This is the distinction the page is built around: for the published year
   * these are facts and are drawn as facts, and every other year is arithmetic
   * on top of them.
   */
  projected: boolean;
  /** How many years past the published block this is, zero for the block year. */
  yearsOn: number;
  /** What it was carried forward from. */
  from: { year: number; low: number };
}

/** What the block costs at this hotel in a given year, or null if it is not in it. */
export function blockRate(placeId: string, year: number): BlockRate | null {
  const partner = partnerFor(placeId);
  if (!partner) return null;
  const yearsOn = year - BLOCK_YEAR;
  const rate = BLOCK_GROWTH ?? FALLBACK_GROWTH;
  const factor = (1 + rate) ** Math.max(0, yearsOn);
  return {
    partner,
    // To the nearest dollar: cents on a projection claim a precision nothing
    // here supports, and Gen Con quotes whole dollars anyway.
    low: Math.round(partner.low * factor),
    high: partner.high === null ? null : Math.round(partner.high * factor),
    projected: yearsOn > 0,
    yearsOn: Math.max(0, yearsOn),
    from: { year: BLOCK_YEAR, low: partner.low },
  };
}

/* ------------------------------------------------------ the facts on a row */

/**
 * The walking pace this app uses everywhere else.
 *
 * A hotel walk is pavement rather than corridor, so it does not go through the
 * campus graph — but it uses the same pace, because a reader comparing "9 min
 * to the Westin" with the schedule's "9 min between rooms" is entitled to
 * assume the two mean the same thing.
 */
export const WALK_METRES_PER_MIN = 78;

/**
 * Past this, nobody is walking with a suitcase in August.
 *
 * Twenty-five minutes on foot. Beyond it the useful number is a drive time,
 * and printing "48 min walk" for a hotel by the airport is technically true and
 * practically noise.
 */
export const WALKABLE_MINUTES = 25;

export interface Journey {
  mode: 'skywalk' | 'walk' | 'drive';
  minutes: number;
  metres: number;
  /** True where the mode is arithmetic rather than a route — see below. */
  rough: boolean;
}

/**
 * How you would actually get to the hall from here.
 *
 * Three modes because they are three different experiences, not three ranges of
 * one number: a skywalk is indoors and air-conditioned and does not care that it
 * is thirty-four degrees outside, which in August is the whole difference
 * between two hotels the same distance apart.
 *
 * The drive time is openly a division rather than a route — distance over a
 * typical city speed, rounded to five minutes so it cannot be mistaken for a
 * routed answer. `rough` says so wherever it is printed.
 */
export function journeyTo(place: Lodging, skywalk: boolean): Journey {
  const minutes = Math.max(1, Math.round(place.metres / WALK_METRES_PER_MIN));
  if (skywalk) return { mode: 'skywalk', minutes, metres: place.metres, rough: false };
  if (minutes <= WALKABLE_MINUTES) {
    return { mode: 'walk', minutes, metres: place.metres, rough: false };
  }
  return {
    mode: 'drive',
    minutes: Math.max(5, Math.round(place.metres / 1000 / 0.7 / 5) * 5),
    metres: place.metres,
    rough: true,
  };
}

/**
 * A room price, split between the people in the room.
 *
 * Not a discount and not a per-person rate anybody is quoted: hotels charge for
 * the room. This is the room divided, which is what four people sharing
 * actually each pay, and the page says which it is — because "$74" beside a
 * hotel is a very different claim from "$296 between four".
 *
 * Occupancy is the reader's to choose. There is no sensible default that is
 * right for both a couple and a group of six, so the control is on the page and
 * the number moves when it is changed.
 */
export const perPerson = (nightly: number, people: number): number =>
  Math.round(nightly / Math.max(1, people));

/**
 * Whether a hotel has a skywalk, for any hotel rather than only block ones.
 *
 * Gen Con marks the skywalk hotels on its own page and nobody else records it,
 * so a hotel outside the block has no answer rather than a negative one. Null
 * is that: "not known to have one", which is not the same as "does not".
 */
export function hasSkywalk(placeId: string): boolean | null {
  const partner = partnerFor(placeId);
  return partner ? partner.skywalk : null;
}

/* ------------------------------------------------------- pairing the two lists */

/** Straight-line metres between two places. */
export function between(a: Lodging, b: Lodging): number {
  const R = 6_371_000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}

/**
 * A rough quality tier, 0 to 4, from whatever can be known for free.
 *
 * OSM's `stars` where somebody recorded it, and the brand otherwise. Openly
 * crude — it exists only to break ties between two hotels the same distance
 * away, where "which of these is the same sort of place" is a better question
 * than "which is two metres nearer".
 */
export function tier(place: Lodging): number {
  const stars = Number(place.stars);
  if (Number.isFinite(stars) && stars >= 1 && stars <= 5) return stars - 1;
  const name = `${place.brand ?? ''} ${place.name}`.toLowerCase();
  if (/conrad|ritz|four seasons|st\.? regis|waldorf|autograph|jw /.test(name)) return 4;
  if (/westin|omni|sheraton|marriott|hyatt regency|le m[eé]ridien|embassy|conrad/.test(name)) return 3;
  if (/courtyard|springhill|residence|hilton garden|doubletree|aloft|staybridge/.test(name)) return 2;
  if (/hampton|holiday inn|fairfield|home2|tru |candlewood|comfort|quality/.test(name)) return 1;
  if (/motel|super 8|econo|days inn|red roof/.test(name)) return 0;
  return 2;
}

/**
 * How much a block hotel wants a given alternative. Lower is keener.
 *
 * Distance dominates, because "a similar walk away" is the question. Quality and
 * price are corrections worth tens of metres, not hundreds — they decide between
 * two neighbours on the same street rather than pulling the comparison across
 * town.
 */
export function preference(
  partner: Lodging,
  candidate: Lodging,
  blockNightly: number | null,
  candidateRate: Rate | null,
): number {
  let cost = between(partner, candidate);
  // Same sort of place: worth about a hundred metres per tier of difference.
  cost += Math.abs(tier(partner) - tier(candidate)) * 100;
  if (blockNightly !== null && candidateRate) {
    // An alternative that costs more than the block is not much of an
    // alternative, so it is pushed back — but not excluded, because "the
    // nearest thing is dearer" is itself worth knowing.
    if (candidateRate.nightly > blockNightly) cost += 250;
    else cost -= 60;
  }
  return cost;
}

export interface Pairing {
  partner: Lodging;
  rate: BlockRate;
  /** The nearest hotel not in the block, or null if every one was taken. */
  alternative: Lodging | null;
  alternativeRate: Rate | null;
  /** Metres between the two, so the comparison can be judged. */
  apart: number | null;
  /** Block rate minus the alternative's, where both are known. */
  saving: number | null;
}

/**
 * Pair every block hotel with a distinct non-block one.
 *
 * Gale–Shapley: block hotels propose down their preference list; a non-block
 * hotel holds the best proposal it has seen and rejects the rest, who move on to
 * their next choice. It terminates because every hotel proposes to each
 * candidate at most once, and no non-block hotel is ever held by two.
 *
 * The non-block hotel's own preference is simple proximity — of two suitors it
 * keeps the nearer, which is what "if one would be used twice, the other takes
 * the next closest" means when written down carefully.
 */
export function pairings(year: number, places: ReadonlyArray<Lodging> = LODGING): Pairing[] {
  const partnerIds = new Set(PARTNERS.map((one) => one.placeId).filter(Boolean));
  // Only the walk ring: an alternative you would have to drive to is not an
  // alternative to a hotel across the road from the hall.
  const walk = places.filter((one) => one.ring === 'walk');
  const blockHotels = walk.filter((one) => partnerIds.has(one.id));
  /*
   * Everything else — minus the ones that only *look* like block entries.
   *
   * Matching is strict, so some block hotels never get tied to an id. Each of
   * those would otherwise land in this list and be offered as an "alternative
   * outside the block", and the page would compare the block with itself. That
   * happened: SpringHill and Fairfield were both offered as alternatives to
   * hotels they share a block with, because Gen Con writes them "by Marriott"
   * and OpenStreetMap does not.
   */
  const others = walk.filter(
    (one) => !partnerIds.has(one.id) && !SUSPECTED_IN_BLOCK.has(one.id),
  );

  /** Each block hotel's candidates, keenest first. */
  const wishes = new Map<string, Lodging[]>();
  for (const partner of blockHotels) {
    const block = blockRate(partner.id, year);
    const ranked = [...others].sort(
      (a, b) =>
        preference(partner, a, block?.low ?? null, rateFor(a.id)) -
        preference(partner, b, block?.low ?? null, rateFor(b.id)),
    );
    wishes.set(partner.id, ranked);
  }

  /** Who currently holds each alternative, and the next index each will try. */
  const heldBy = new Map<string, Lodging>();
  const nextTry = new Map<string, number>(blockHotels.map((one) => [one.id, 0]));
  const free = [...blockHotels];

  while (free.length > 0) {
    const suitor = free.shift()!;
    const list = wishes.get(suitor.id) ?? [];
    const index = nextTry.get(suitor.id)!;
    if (index >= list.length) continue; // Nothing left to ask; stays unpaired.
    nextTry.set(suitor.id, index + 1);

    const wanted = list[index];
    const holder = heldBy.get(wanted.id);
    if (!holder) {
      heldBy.set(wanted.id, suitor);
      continue;
    }
    // Contested: the nearer one keeps it, the other tries its next choice.
    if (between(suitor, wanted) < between(holder, wanted)) {
      heldBy.set(wanted.id, suitor);
      free.push(holder);
    } else {
      free.push(suitor);
    }
  }

  const pairedWith = new Map<string, Lodging>();
  for (const [otherId, suitor] of heldBy) {
    pairedWith.set(suitor.id, others.find((one) => one.id === otherId)!);
  }

  return blockHotels
    .map((partner) => {
      const rate = blockRate(partner.id, year)!;
      const alternative = pairedWith.get(partner.id) ?? null;
      const alternativeRate = alternative ? rateFor(alternative.id) : null;
      return {
        partner,
        rate,
        alternative,
        alternativeRate,
        apart: alternative ? between(partner, alternative) : null,
        saving: alternativeRate ? rate.low - alternativeRate.nightly : null,
      };
    })
    .sort((a, b) => a.partner.metres - b.partner.metres);
}
