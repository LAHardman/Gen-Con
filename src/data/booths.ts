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
 * published file states.
 *
 * THE WALLS COME IN TWO SHAPES, which is the whole reason for the two tables
 * below. Four of them run *between* aisles, so an aisle is wholly in one hall.
 * The fifth runs *across* them: Halls J and K are stacked one behind the other
 * at the same end of the building, so the wall between them cuts every aisle in
 * that stretch in half, and a booth's hall depends on how far along its aisle
 * it stands rather than on which aisle it is.
 *
 * TWO INDEPENDENT CHECKS, because a table like this is exactly the kind that
 * can be silently back to front. The schedule names a hall twice, in among
 * 27,467 events that otherwise never do:
 *
 *   `Exhibit Hall J : Booth #174`         → J, and 174 is over the cross wall
 *   `Exhibit Hall G` / `Booth #2667`      → G, and 2667 is in the fourth stretch
 *
 * Both agree. Read the other way round — I below the 500s rather than above —
 * booth 174 lands in I and the schedule says J, so there is only one reading of
 * these divides that the data supports.
 */

import { ROOMS_BY_ID } from './venues';
import { fromPack } from './pack-runtime';

/**
 * The walls that run between two aisles, as the booth numbers either side.
 *
 * Written as the divides rather than as ranges because that is the form the
 * knowledge arrives in and the form it can be checked in — "2200/2300 is G to
 * H" is a sentence somebody can agree or disagree with, where "hall-h is
 * 1400–2299" is a derived fact with a fencepost in it.
 */
const COMPILED_HALL_DIVIDES: ReadonlyArray<{
  /**
   * The last booth number on the low side of the wall, or null for the top
   * of the grid, where there is no wall above.
   *
   * Null rather than `Infinity`, which is not a thing JSON can carry:
   * serialised it becomes `null` anyway, and read back as a *number* it
   * fails every `<=` against it — so every booth above the last wall would
   * quietly have no hall at all. Since the value has to survive the pack,
   * it is written as the thing that survives, and the comparison below
   * spells out what it means.
   */
  readonly under: number | null;
  /** The hall below it, or null where another wall decides it. */
  readonly hall: string | null;
}> = [
  // 100–599. Two halls, not one: see `ACROSS_THE_AISLES` below.
  { under: 599, hall: null },
  // 600–1399. "1300/1400 is the divide between H and I."
  { under: 1399, hall: 'hall-i' },
  // 1400–2299. "2200/2300 is the divide between hall G and H."
  { under: 2299, hall: 'hall-h' },
  // 2300–2723. "Between 2727 and 2723 is the divide between hall G and hall F"
  // — the only *between-aisle* wall that falls inside an aisle's numbering.
  { under: 2723, hall: 'hall-g' },
  // 2727 and up. No wall above it; see `under`.
  { under: null, hall: 'hall-f' },
];

/**
 * The wall that runs across the aisles, dividing Hall J from Hall K.
 *
 * A booth number is an aisle and then a position along it — 174 is the 74th
 * position of aisle 1 — and this wall is a line of constant *position*, cutting
 * every aisle from the 100s to the 500s. Given as the two places it crosses:
 * between 331 and 339, and between 429 and 439. Both put it between the low
 * thirties and 39, and 32 is the tightest line satisfying both.
 *
 * Hall J is the far side. Booth 174 is at position 74 and the schedule calls it
 * Hall J, which is what fixes the direction — and it is the only thing that
 * does, since nothing else here says which of the two is nearer the door.
 *
 * The wall passes *through* ten stands rather than between them — 132, 133,
 * 135, 136, 137, 234, 237, 533, 535 and 537, which straddle it. They are
 * counted as J for having their number on that side, and it costs nothing to
 * be wrong about them: a stand on the wall is in both halls, and walking to
 * either finds it.
 */
const COMPILED_ACROSS_THE_AISLES = {
  /** Booths under this are in the stretch the cross wall divides. */
  within: 600,
  /** Positions from here up are on the far side. */
  at: 32,
  beyond: 'hall-j',
  before: 'hall-k',
} as const;

/**
 * The hall a booth number is in, as a room id, or null where nothing says.
 *
 * Null for a number outside the grid and for anything that is not a number,
 * both of which are better than a hall somebody would walk to and not find
 * their stand in.
 */
export function hallForBooth(booth: string | number | null | undefined): string | null {
  if (booth === null || booth === undefined) return null;
  const number = typeof booth === 'number' ? booth : Number(booth.trim());
  if (!Number.isInteger(number) || number < 100) return null;

  if (number < ACROSS_THE_AISLES.within) {
    const along = number % 100;
    return named(along >= ACROSS_THE_AISLES.at ? ACROSS_THE_AISLES.beyond : ACROSS_THE_AISLES.before);
  }
  for (const { under, hall } of HALL_DIVIDES) {
    // A null bound is the top of the grid: nothing is above it.
    if (under === null || number <= under) return named(hall);
  }
  return null;
}

/** A hall id no room has places nothing, rather than placing it nowhere. */
const named = (hall: string | null) => (hall && ROOMS_BY_ID[hall] ? hall : null);

/** The booth number in a piece of text, where it holds exactly one. */
export function boothIn(text: string | undefined): string | null {
  if (!text) return null;
  // `Booth #1229`, `Booth 1229`, `booth#1229`. Anchored on the word so a room
  // called "1229" — and the convention centre has rooms numbered like that —
  // is not read as a stand.
  const found = /\bbooths?\s*#?\s*([0-9]{3,4})\b/i.exec(text);
  return found ? found[1] : null;
}

/**
 * The pack's copy of this table where one is held, else what was built.
 *
 * Laid over per constant, so a refresh can carry one of these and
 * leave the rest alone, and a key that arrives the wrong shape leaves
 * the compiled value standing. See `fromPack`.
 */
const PACKED = fromPack('booths', {
  HALL_DIVIDES: COMPILED_HALL_DIVIDES,
  ACROSS_THE_AISLES: COMPILED_ACROSS_THE_AISLES,
});

export const HALL_DIVIDES = PACKED.HALL_DIVIDES;
export const ACROSS_THE_AISLES = PACKED.ACROSS_THE_AISLES;
