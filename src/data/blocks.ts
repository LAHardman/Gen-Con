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
 * THE COMPARISON answers "what would I pay instead" for one block hotel at a
 * time, against whatever the reader is currently looking at. It used to be a
 * whole-table matching that ran once over every walkable hotel and printed its
 * own section underneath the list. Two things were wrong with that. It answered
 * a question about hotels the reader had filtered away, and it put the answer
 * a screen and a half from the row it was about — so the row said "$152" and
 * the thing that gives $152 a meaning was somewhere else entirely.
 *
 * So it is a lookup now, run per row over the candidates the filters left
 * standing, and drawn on the row. `beside` is the whole rule.
 */

import type { Lodging } from './lodging';
import {
  BLOCK_GROWTH,
  BLOCK_YEAR,
  CAVEAT,
  SOURCE,
  partnerFor,
  type Partner,
} from './partners';
import type { Rate } from './rates';

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


/** A hotel and what it costs a night, as the comparison needs to see it. */
export interface Candidate {
  place: Lodging;
  /** Per room, per night, or null where nobody has a price for it. */
  nightly: number | null;
}

export interface Beside extends Candidate {
  /** Metres between the two hotels, so the comparison can be judged. */
  apart: number;
  /** Block rate minus this one's, where both are known. */
  saving: number | null;
  /** Which test it passed. A near hotel and a similarly-priced one are
   *  different kinds of answer, and the row says which it is looking at. */
  because: 'near' | 'priced';
}

/**
 * Within this of the block hotel, a hotel is somewhere you would also walk.
 *
 * Eight hundred metres, which is about ten minutes. Six hundred was the first
 * guess and it was too tight for this campus: downtown's four hotels outside
 * the block sit 729 to 1,458 m from the hall, and from the JW — 124 m from the
 * door — the nearest of them is 610 m away. A threshold that answers the most
 * central hotel on the list with nothing is measuring the wrong thing.
 */
export const NEAR_METRES = 800;

/** Within this fraction of the block rate, a hotel is in the same bracket. */
export const NEAR_PRICE = 0.25;

/**
 * The one hotel outside the block worth printing beside this one in it.
 *
 * TWO WAYS TO QUALIFY, because there are two reasons to look at a second hotel.
 * One is "somewhere else I could stay and still walk this far", which is about
 * distance. The other is "somewhere else at about this money", which is about
 * price and does not care where it is. A candidate passes on either.
 *
 * NOT EVERY HOTEL GETS ONE, and that is the honest outcome rather than a gap:
 * with nothing near it and nothing at its price, the nearest hotel outside the
 * block is a mile away and twice the money, and printing it would be inventing
 * a comparison to fill a column.
 *
 * `used` lets the caller discourage the same hotel from answering for the whole
 * list. It is a preference, not a rule — downtown does not have enough hotels
 * outside the block for a rule — so a much better repeat still beats a poor
 * fresh one.
 */
export function beside(
  partner: Lodging,
  blockNightly: number | null,
  candidates: readonly Candidate[],
  used: ReadonlySet<string> = new Set(),
): Beside | null {
  let best: (Beside & { cost: number }) | null = null;

  for (const candidate of candidates) {
    if (candidate.place.id === partner.id) continue;
    const apart = between(partner, candidate.place);
    const near = apart <= NEAR_METRES;
    const priced =
      blockNightly !== null &&
      candidate.nightly !== null &&
      Math.abs(candidate.nightly - blockNightly) <= blockNightly * NEAR_PRICE;
    if (!near && !priced) continue;

    /*
     * Distance decides between two that both qualify, with a tier difference
     * worth about a hundred metres — a Motel 6 beside the Conrad is a true
     * comparison and a useless one. A hotel already answering for another row
     * carries the width of the whole test, so it loses to any real rival and
     * still wins when there is none.
     */
    let cost = apart + Math.abs(tier(partner) - tier(candidate.place)) * 100;
    if (used.has(candidate.place.id)) cost += NEAR_METRES;
    if (best === null || cost < best.cost) {
      best = {
        ...candidate,
        apart,
        saving:
          blockNightly !== null && candidate.nightly !== null
            ? blockNightly - candidate.nightly
            : null,
        // Said as the stronger claim where both hold: "round the corner" is a
        // more useful thing to know than "about the same money".
        because: near ? 'near' : 'priced',
        cost,
      };
    }
  }

  if (!best) return null;
  const { cost: _cost, ...beside } = best;
  return beside;
}
