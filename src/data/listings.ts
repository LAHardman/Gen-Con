

import { fromPack } from './pack-runtime';/**
 * Somewhere to sleep that nobody surveyed. GENERATED — do not edit.
 *
 * Run 'node scripts/fetch-rates.mjs' to rebuild this.
 *
 * A search for hotels near the hall answers with more than hotels: flats,
 * condos and lofts let by the night, which for a convention where four people
 * share a room is often the cheapest way to sleep within walking distance. It
 * also answers with hotels the OpenStreetMap pull missed. Both are here.
 *
 * **This is not 'lodging.ts' and must not be merged into it.** That file is a
 * survey under ODbL: somebody stood there. Every row here is a booking product
 * — one listing, which may be one flat in a block of forty, may be gone next
 * week, and may be the same address as the row beside it under another name.
 * The rules in 'scripts/lib/rates/strangers.mjs' refuse the duplicates they
 * can prove and keep the rest; they cannot prove all of them.
 *
 * Prices are for Gen Con 2026, 2026-10-14 to 2026-10-18.
 */

export interface Listing {
  /** Prefixed 'serp:' so it can never be read as an OpenStreetMap id. */
  id: string;
  name: string;
  /** hotel, motel, hostel, or rental — somebody's flat rather than a front desk. */
  kind: string;
  /** Straight-line metres from the convention centre. */
  metres: number;
  ring: 'walk' | 'drive';
  lat: number;
  lng: number;
  /** Per night, for the convention stay above. */
  nightly: number;
  /** Where the search said this can be booked, when it said. */
  link?: string | null;
  city?: string;
}

/** When these were gathered. */
const COMPILED_FOUND = '2026-08-14';

/** Nearest first. */
const COMPILED_LISTINGS: ReadonlyArray<Listing> = [
  { id: 'serp:intercontinental-indianapolis-by-ihg', name: "InterContinental Indianapolis by IHG", kind: 'hotel', metres: 711, ring: 'walk', lat: 39.768394, lng: -86.159313, nightly: 479, city: "Indianapolis" },
  { id: 'serp:mcouat-place-6b-designer-loft', name: "McOuat Place 6B Designer Loft", kind: 'rental', metres: 817, ring: 'walk', lat: 39.76722, lng: -86.157494, nightly: 228, city: "Indianapolis" },
  { id: 'serp:cozysuites-spacious-1br', name: "CozySuites Spacious 1BR", kind: 'rental', metres: 1601, ring: 'drive', lat: 39.76746, lng: -86.148262, nightly: 124, city: "Indianapolis" },
];

/**
 * The pack's copy of this table where one is held, else what was built.
 *
 * Laid over per constant, so a refresh can carry one of these and
 * leave the rest alone, and a key that arrives the wrong shape leaves
 * the compiled value standing. See `fromPack`.
 */
const PACKED = fromPack('listings', {
  LISTINGS: COMPILED_LISTINGS,
  FOUND: COMPILED_FOUND,
});

export const LISTINGS = PACKED.LISTINGS;
export const FOUND = PACKED.FOUND;
