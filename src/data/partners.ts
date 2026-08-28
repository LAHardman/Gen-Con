/**
 * Gen Con's own hotel block.
 *
 * The data lives in `partners.json` beside this file — a pack table,
 * refreshed by `scripts/fetch-block-rates.mjs` and published for running
 * copies to fetch — and this module is the stable half: the types, and the
 * lookups over them. It is written by hand and stays put across refreshes;
 * only the JSON moves.
 *
 * These are **real published rates**, from Gen Con's own hotel map page,
 * for the year the JSON names. Two things about them, both in Gen Con's own
 * words:
 *
 *   - they are **starting prices**. "Actual nightly rates vary by room type
 *     and occupancy, subject to availability and pricing published at the
 *     time of booking." Where a range is quoted, both ends are kept.
 *   - they are **before tax**. "Non-inclusive of local sales and occupancy
 *     taxes", which in Marion County is not a rounding error.
 *
 * `skywalk` is Gen Con's asterisk: connected to the convention centre by
 * elevated walkway, which they say typically means one to two blocks.
 *
 * `BLOCK_GROWTH` is how fast this block's own prices have actually moved —
 * the median annual change between the published rates here and the 2019
 * rates in an attendee's forum table. It is used to project a year the
 * block has not published yet, and it is measured from Gen Con's own
 * numbers rather than from a national index that knows nothing about
 * Indianapolis in August.
 */

import raw from './partners.json';
import { packTable } from './pack-runtime';

export type Region = 'downtown' | 'airport' | 'east' | 'north' | 'south';

export interface Partner {
  /** Gen Con's name for it. */
  blockName: string;
  /** The id in `lodging.ts`, or null where no unambiguous match was found. */
  placeId: string | null;
  /** Starting nightly rate, USD, before tax. */
  low: number;
  /** The top of the quoted range, or null where a single rate was published. */
  high: number | null;
  region: Region;
  /** Connected to the convention centre by elevated skywalk. */
  skywalk: boolean;
  /** Gen Con's own words: "Skywalk", "3 Blocks", "8.6 Miles". */
  distance: string;
}

interface PartnersTable {
  year: number;
  growth: number | null;
  partners: Partner[];
  suspected: string[];
}

/**
 * Whether downloaded bytes are actually this table. The pack's last gate:
 * schema and hash have already passed by the time a stored table gets here,
 * and this is the check that knows what the words mean. Refusal falls back
 * to the compiled snapshot, which is always present and always sound.
 */
export function isPartnersTable(candidate: unknown): candidate is PartnersTable {
  const table = candidate as Partial<PartnersTable> | null;
  if (!table || typeof table.year !== 'number') return false;
  if (table.growth !== null && typeof table.growth !== 'number') return false;
  if (!Array.isArray(table.suspected) || !table.suspected.every((id) => typeof id === 'string')) return false;
  if (!Array.isArray(table.partners) || table.partners.length === 0) return false;
  return table.partners.every(
    (row) =>
      !!row &&
      typeof row.blockName === 'string' &&
      typeof row.low === 'number' &&
      typeof row.skywalk === 'boolean' &&
      typeof row.distance === 'string' &&
      (row.placeId === null || typeof row.placeId === 'string') &&
      (row.high === null || typeof row.high === 'number'),
  );
}

/** A newer table from the stored pack when one is held and reads; else the snapshot. */
const data = packTable('partners', isPartnersTable) ?? (raw as PartnersTable);

/** The convention year these rates were published for. */
export const BLOCK_YEAR: number = data.year;

/** Median annual change in this block's own rates, 2019 to `BLOCK_YEAR`. */
export const BLOCK_GROWTH: number | null = data.growth;

export const SOURCE = 'https://www.gencon.com/gen-con-indy/hotelmap';
export const HISTORY_SOURCE =
  'https://www.gencon.com/forums/43-travel-housing-and-dining-2019/topics/15787-hotel-costs';

/** Gen Con's own footnote, printed wherever these rates are. */
export const CAVEAT =
  'Starting rates that vary by room type and occupancy, and before local sales and occupancy taxes.';

export const PARTNERS: ReadonlyArray<Partner> = data.partners;

const BY_PLACE = new Map(
  PARTNERS.filter((one) => one.placeId).map((one) => [one.placeId as string, one]),
);

/** Whether a place is in Gen Con's block. */
export const isPartner = (placeId: string): boolean => BY_PLACE.has(placeId);

export const partnerFor = (placeId: string): Partner | null => BY_PLACE.get(placeId) ?? null;

/**
 * Walkable hotels that look like block entries and nobody has checked yet.
 *
 * They get no block rate — the match was not good enough — but they must never
 * be offered as an alternative *outside* the block either, because they are
 * probably in it. Being cautious here costs a row of a comparison table; being
 * wrong compares the block with itself.
 *
 * An entry here is a to-do, not an answer: it means the generator saw a
 * resemblance and `scripts/lib/block-aliases.mjs` has nothing to say about the
 * hotel. Add a line there and it leaves this set, in one direction or the other.
 */
export const SUSPECTED_IN_BLOCK: ReadonlySet<string> = new Set(data.suspected);

/** The block's own cheapest, wherever it is — usually out by the airport. */
export const CHEAPEST = PARTNERS.reduce((low, one) => (one.low < low.low ? one : low));
