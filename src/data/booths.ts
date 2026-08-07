/**
 * Which exhibit hall a booth number is in.
 *
 * The convention centre's exhibit floor is one continuous grid of aisles — the
 * 100s at one end, the 3000s at the other — laid across eleven halls with air
 * walls between them. Every source this repository has gives a booth its
 * number and none of them gives it a hall:
 *
 *   the schedule       `Exhibit Hall Booth #1229`, and there are eleven halls
 *   the stand list     `Exhibit Hall : Booth 1637` (`exhibitors.ts`)
 *   the map API        `lg`/`lt` on a star field, not a plan (see the fetcher)
 *   the printed map    a true plan of the grid that letters no hall at all
 *
 * So this is the missing piece, and it is not derived from anything: it is
 * where the air walls are, which somebody who has walked the hall knows and no
 * published file states. Four divides, and they place five halls.
 *
 * TWO INDEPENDENT CHECKS, because a table like this is exactly the kind that
 * can be silently back to front. The schedule itself names a hall twice, in
 * among 27,467 events that otherwise never do:
 *
 *   `Exhibit Hall J : Booth #174`         → J, and 174 is in the first stretch
 *   `Exhibit Hall G` / `Booth #2667`      → G, and 2667 is in the fourth
 *
 * Both agree. Read the other way round — I below the 500s rather than above —
 * booth 174 lands in I and the schedule says J, so there is only one reading
 * of these divides that the data supports.
 *
 * WHAT IS NOT KNOWN, and is left as such rather than guessed:
 *
 *   Where J ends and K begins. The first stretch is "J and K" together, and
 *   127 of the 573 stands are in it. They resolve to no hall rather than to a
 *   coin toss — the whole point of naming a hall is to walk to the right one.
 *
 *   Whether anything past the F divide is a hall other than F. The grid stops
 *   at 3062 and nothing says there is another wall in it, so the last stretch
 *   runs to the end.
 */

import { ROOMS_BY_ID } from './venues';

/**
 * The air walls, as booth numbers either side of them.
 *
 * Written as the divides rather than as ranges because that is the form the
 * knowledge arrives in and the form it can be checked in — "2200/2300 is G to
 * H" is a sentence somebody can agree or disagree with, where "hall-h is
 * 1400–2299" is a derived fact with a fencepost in it.
 */
export const HALL_DIVIDES: ReadonlyArray<{
  /** The last booth number on the low side of the wall. */
  readonly under: number;
  /** The hall below it, or null where the sources do not say. */
  readonly hall: string | null;
}> = [
  // 100–599. "500/600 divides I from J and K" — the low side is J and K, and
  // which of the two is not stated.
  { under: 599, hall: null },
  // 600–1399. "1300/1400 is the divide between H and I."
  { under: 1399, hall: 'hall-i' },
  // 1400–2299. "2200/2300 is the divide between hall G and H."
  { under: 2299, hall: 'hall-h' },
  // 2300–2723. "Between 2727 and 2723 is the divide between hall G and hall F"
  // — the only divide that falls inside an aisle rather than between two.
  { under: 2723, hall: 'hall-g' },
  // 2727 and up.
  { under: Infinity, hall: 'hall-f' },
];

/**
 * The hall a booth number is in, as a room id, or null where nothing says.
 *
 * Null for the 127 stands in the J/K stretch, for a number outside the grid,
 * and for anything that is not a number — all of which are better than a hall
 * somebody would walk to and not find their stand in.
 */
export function hallForBooth(booth: string | number | null | undefined): string | null {
  if (booth === null || booth === undefined) return null;
  const number = typeof booth === 'number' ? booth : Number(booth.trim());
  if (!Number.isInteger(number) || number < 100) return null;
  for (const { under, hall } of HALL_DIVIDES) {
    if (number <= under) return hall && ROOMS_BY_ID[hall] ? hall : null;
  }
  return null;
}

/** The booth number in a piece of text, where it holds exactly one. */
export function boothIn(text: string | undefined): string | null {
  if (!text) return null;
  // `Booth #1229`, `Booth 1229`, `booth#1229`. Anchored on the word so a room
  // called "1229" — and the convention centre has rooms numbered like that —
  // is not read as a stand.
  const found = /\bbooths?\s*#?\s*([0-9]{3,4})\b/i.exec(text);
  return found ? found[1] : null;
}
