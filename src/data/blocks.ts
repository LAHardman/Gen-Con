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
import { BASE_YEAR, PARTNERS, SOURCE, partnerFor, type Partner } from './partners';
import { rateFor, type Rate } from './rates';

export { BASE_YEAR, SOURCE };

/**
 * How much dearer a hotel room is than in the base year.
 *
 * 2026 is measured, not guessed: the U.S. Travel Association's Travel Price
 * Index put hotel prices **13.0% above 2019** in June 2026. That single number
 * absorbs the whole strange run in between — down 10% in 2020, up 10% in 2021
 * and again in 2022 — which no smooth growth rate fitted to 2014–2019 could
 * have reproduced.
 *
 * Later years are the same figure continued at `ASSUMED_ANNUAL`, and are
 * therefore an estimate built on an estimate. `confidence` says which is which
 * so the page can too.
 */
const MEASURED: Record<number, number> = { 2026: 1.13 };

/**
 * Carried forward at this rate past the last measured year.
 *
 * Deliberately close to general inflation rather than to the 2021–22 spike:
 * projecting a spike forward is how a plausible number becomes a wrong one.
 */
export const ASSUMED_ANNUAL = 0.03;

/** The index for a year, and whether anybody measured it. */
export function priceIndex(year: number): { factor: number; measured: boolean } {
  if (MEASURED[year]) return { factor: MEASURED[year], measured: true };
  const years = Object.keys(MEASURED).map(Number);
  const last = Math.max(...years);
  if (year <= last) {
    // Before the measured year and not measured itself: interpolating backwards
    // would invent a history, so it says so by refusing to claim measurement.
    return { factor: MEASURED[last] / (1 + ASSUMED_ANNUAL) ** (last - year), measured: false };
  }
  return { factor: MEASURED[last] * (1 + ASSUMED_ANNUAL) ** (year - last), measured: false };
}

export interface BlockEstimate {
  partner: Partner;
  /** Estimated block rate per night for `year`, USD. */
  nightly: number;
  /** The real rate this was carried forward from. */
  from: { year: number; nightly: number };
  factor: number;
  /** True only where the index for that year was actually measured. */
  measured: boolean;
}

/** What the block probably costs at this hotel, or null if it was never in it. */
export function blockEstimate(placeId: string, year: number): BlockEstimate | null {
  const partner = partnerFor(placeId);
  if (!partner) return null;
  const { factor, measured } = priceIndex(year);
  return {
    partner,
    // To the nearest dollar. Cents on a seven-year projection would be a claim
    // about precision that nothing here supports.
    nightly: Math.round(partner.y2019 * factor),
    from: { year: BASE_YEAR, nightly: partner.y2019 },
    factor,
    measured,
  };
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
  estimate: BlockEstimate;
  /** The nearest hotel not in the block, or null if every one was taken. */
  alternative: Lodging | null;
  alternativeRate: Rate | null;
  /** Metres between the two, so the comparison can be judged. */
  apart: number | null;
  /** Estimated block rate minus the alternative's, where both are known. */
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
  const partnerIds = new Set(PARTNERS.map((one) => one.placeId));
  // Only the walk ring: an alternative you would have to drive to is not an
  // alternative to a hotel across the road from the hall.
  const walk = places.filter((one) => one.ring === 'walk');
  const blockHotels = walk.filter((one) => partnerIds.has(one.id));
  const others = walk.filter((one) => !partnerIds.has(one.id));

  /** Each block hotel's candidates, keenest first. */
  const wishes = new Map<string, Lodging[]>();
  for (const partner of blockHotels) {
    const estimate = blockEstimate(partner.id, year);
    const ranked = [...others].sort(
      (a, b) =>
        preference(partner, a, estimate?.nightly ?? null, rateFor(a.id)) -
        preference(partner, b, estimate?.nightly ?? null, rateFor(b.id)),
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
      const estimate = blockEstimate(partner.id, year)!;
      const alternative = pairedWith.get(partner.id) ?? null;
      const alternativeRate = alternative ? rateFor(alternative.id) : null;
      return {
        partner,
        estimate,
        alternative,
        alternativeRate,
        apart: alternative ? between(partner, alternative) : null,
        saving: alternativeRate ? estimate.nightly - alternativeRate.nightly : null,
      };
    })
    .sort((a, b) => a.partner.metres - b.partner.metres);
}
