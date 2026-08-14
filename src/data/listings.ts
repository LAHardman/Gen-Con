/**
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
 * Empty until the first price run gathers them.
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
  city?: string;
}

/** When these were gathered. */
export const FOUND = '';

/** Nearest first. */
export const LISTINGS: ReadonlyArray<Listing> = [];
