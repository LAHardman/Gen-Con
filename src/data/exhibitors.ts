/**
 * Who is at which booth.
 *
 * The data lives in `exhibitors.json` beside this file — a pack table,
 * refreshed by `scripts/fetch-exhibitors.mjs` and published for running
 * copies to fetch — and this module is the stable half: the types, and the
 * lookups over them. It is written by hand and stays put across refreshes;
 * only the JSON moves.
 *
 * One row per location rather than per exhibitor: a publisher with four
 * booths, a demo hall and a meeting room is six places somebody might be
 * looking for.
 *
 * `area` and `spot` are Gen Con's own words, split on the colons it writes
 * them with. What is NOT here is a position, and nothing in the source says
 * which of Exhibit Halls A–K a booth number is in — `booths.ts` decides that
 * from the number. The source *does* carry a coordinate per location, which
 * the importer deliberately drops: the printed map is the better source (it
 * gives every stand's footprint and the ones nobody has taken), and the
 * importer's header records the correlation figures for the day that map
 * stops being published.
 *
 * Source: Gen Con LLC.
 */

import raw from './exhibitors.json';
import { packTable } from './pack-runtime';

export interface Exhibitor {
  name: string;
  /** Gen Con's own grouping: Exhibitors, Artists, Authors, Food & Drink. */
  kind: string;
  /** Where, as written: 'Exhibit Hall', 'ICC : Hall B', 'Block Party'. */
  area: string;
  /** The spot within it: 'Booth 1637', 'Rm 140', 'Table Q'. */
  spot: string;
  /** Its number, where the spot is numbered. */
  booth?: string;
  /** The campus level Gen Con's map puts it on. */
  level?: number;
  /** Gen Con's own id, which its description is fetched by. */
  id?: number;
  /** Indices into `EXHIBITOR_TAGS` — see `tagsOf`. */
  tags?: number[];
  /** Their own site, where one is known. Only pulled for food and drink. */
  website?: string;
}

interface ExhibitorsTable {
  tags: string[];
  exhibitors: Exhibitor[];
}

/**
 * Whether downloaded bytes are actually this table. The pack's last gate:
 * schema and hash have already passed by the time a stored table gets here,
 * and this is the check that knows what the words mean. Refusal falls back
 * to the compiled snapshot, which is always present and always sound.
 */
export function isExhibitorsTable(candidate: unknown): candidate is ExhibitorsTable {
  const table = candidate as Partial<ExhibitorsTable> | null;
  if (!table || !Array.isArray(table.tags) || !Array.isArray(table.exhibitors)) return false;
  if (!table.tags.every((tag) => typeof tag === 'string')) return false;
  return table.exhibitors.every(
    (row) =>
      !!row &&
      typeof row.name === 'string' &&
      typeof row.kind === 'string' &&
      typeof row.area === 'string' &&
      typeof row.spot === 'string',
  );
}

/** A newer table from the stored pack when one is held and reads; else the snapshot. */
const data = packTable('exhibitors', isExhibitorsTable) ?? (raw as ExhibitorsTable);

/**
 * Every word Gen Con files exhibitors under, once.
 *
 * These are its own vocabulary rather than anything worked out here:
 * cuisines and dishes for the food trucks, genres and trades for the halls.
 * `food.ts` is what decides which of them mean what. Rows carry indices into
 * this list because the words repeat across 845 rows, and 47.8 KB of them
 * becomes 12.3 KB.
 */
export const EXHIBITOR_TAGS: readonly string[] = data.tags;

export const EXHIBITORS: Exhibitor[] = data.exhibitors;

/** An exhibitor's tags as words. */
export function tagsOf(exhibitor: Exhibitor): string[] {
  return (exhibitor.tags ?? []).map((at) => EXHIBITOR_TAGS[at]).filter(Boolean);
}

/**
 * Who is at a stand, by the number printed on it.
 *
 * A list rather than one, because ten of the 561 numbered stands are shared by
 * two exhibitors — a booth is a patch of floor and two small publishers can
 * split one. `area` narrows it because the numbers are only unique within an
 * area: the Block Party has a Food Truck 3 and the trade floor has a Booth 3,
 * and they are two miles of aisle apart.
 */
const BY_BOOTH = new Map<string, Exhibitor[]>();

export function standing(area: string, booth: string): Exhibitor[] {
  if (BY_BOOTH.size === 0) {
    for (const one of EXHIBITORS) {
      if (!one.booth) continue;
      const key = `${one.area}/${one.booth}`;
      const held = BY_BOOTH.get(key);
      if (held) held.push(one);
      else BY_BOOTH.set(key, [one]);
    }
  }
  return BY_BOOTH.get(`${area}/${booth}`) ?? [];
}
