/**
 * What the trip costs, and whose share of it is whose.
 *
 * A Gen Con trip is priced in seven places that never meet: a badge store, an
 * airline, a hotel, a ticket queue, whatever you eat, whatever you buy in the
 * exhibit hall, and the parking you forgot. This is the one place they meet.
 *
 * TWO SORTS OF LINE, ONE SHAPE. Most are typed — a flight, a badge, a nightly
 * food guess. Two are derived: a hotel somebody marked as booked on the hotels
 * page, and a session with a ticket price that is already on their schedule.
 * Derived lines are not stored. They are read from the booking and the plan
 * every time, so a hotel un-booked or an event dropped from the schedule stops
 * costing money the moment it stops being planned, rather than leaving a stale
 * line behind for somebody to notice a fortnight later.
 *
 * MONEY IS WHOLE CENTS, ALWAYS. `0.1 + 0.2` is `0.30000000000000004` and a
 * budget that shows a total of `$1,247.0000000000002` is a budget nobody
 * believes again. Every number here is an integer number of cents, and the only
 * place a decimal point appears is in `dollars`.
 *
 * NOTHING HERE TOUCHES STORAGE OR REACT. `useBudget` does that; this is the
 * part that can be tested by calling it.
 */

/** Somebody on the trip. The whole of what the app knows about a person. */
export interface Person {
  id: string;
  name: string;
}

/**
 * The seven headings, in the order the page shows them.
 *
 * Roughly the order the money leaves: a badge is bought in May, a flight in
 * June, the hotel is charged on arrival, tickets when the queue opens, and the
 * rest of it while you are there.
 */
export type Category = 'badge' | 'travel' | 'hotel' | 'event' | 'food' | 'merch' | 'misc';

export const CATEGORIES: readonly Category[] = [
  'badge',
  'travel',
  'hotel',
  'event',
  'food',
  'merch',
  'misc',
];

export const CATEGORY_NAMES: Record<Category, string> = {
  badge: 'Badges',
  travel: 'Getting there',
  hotel: 'Hotels',
  event: 'Events and tickets',
  food: 'Food and drink',
  merch: 'Merchandise',
  misc: 'Everything else',
};

/** What each heading is for, said once, on the page rather than in a manual. */
export const CATEGORY_NOTES: Record<Category, string> = {
  badge: 'Entry to the convention itself, and anything sold with it.',
  travel: 'Flights, fuel, parking, the ride from the airport.',
  hotel: 'Rooms. Marking one booked on the Hotels page fills this in.',
  event: 'Tickets. A session on your schedule with a price fills this in.',
  food: 'What you eat, which is four days of it and adds up faster than it reads.',
  merch: 'Games, dice, art, and the second suitcase you buy to carry them.',
  misc: 'Everything that did not fit above.',
};

/**
 * One cost.
 *
 * `cents` is what one of it costs and `times` is how many — four nights, three
 * meals a day, two parking days. They are kept apart rather than multiplied
 * because "$180 × 4 nights" is a number somebody can check and "$720" is one
 * they have to trust.
 *
 * `who` is the people it belongs to. **Empty means the whole party**, which is
 * the common case and should not need saying: a hire car is everybody's.
 */
export interface Line {
  id: string;
  category: Category;
  label: string;
  /** Whole cents, for one of them. */
  cents: number;
  /** How many. Nights, meals, days, tickets. */
  times: number;
  /** Person ids. Empty is everybody — see above. */
  who: string[];
  note?: string;
  /**
   * Where it came from, when nobody typed it.
   *
   * A derived line cannot be edited into something else, because the next read
   * of the booking or the plan would overwrite it. The page shows it with the
   * thing it came from instead, and the way to change it is to change that.
   */
  from?: 'booking' | 'plan';
}

/** What a line costs in total: one of them, times how many there are. */
export function lineTotal(line: Pick<Line, 'cents' | 'times'>): number {
  return line.cents * line.times;
}

/**
 * Divides cents between n people so the parts add up to the whole.
 *
 * $100 between three is not three lots of $33.33 — that is $99.99, and the
 * missing cent is the sort of thing that makes a budget wrong by a dollar after
 * a dozen lines. The remainder goes to the first few, one cent each, which is
 * arbitrary but consistent: the same line splits the same way every render, so
 * nobody's column flickers.
 *
 * Negative amounts split the same way — a refund is a cost with a minus in
 * front of it and has no business behaving differently.
 */
export function shareOut(cents: number, among: number): number[] {
  if (among <= 0) return [];
  const sign = cents < 0 ? -1 : 1;
  const size = Math.abs(cents);
  const each = Math.floor(size / among);
  const over = size - each * among;
  return Array.from({ length: among }, (_, i) => sign * (each + (i < over ? 1 : 0)));
}

/**
 * Who actually carries a line, given who is on the trip.
 *
 * Three rules, and the last two are the ones that stop money disappearing:
 *
 *   - No names on it means everybody. A hire car is not assigned; it is shared.
 *   - Names that are no longer on the trip are dropped. Removing somebody from
 *     the party should not leave their share stranded on a line.
 *   - If dropping them leaves nobody, it falls back to everybody. The cost did
 *     not stop existing because the person it was pinned to went home; somebody
 *     is still paying for it.
 */
export function bearersOf(line: Pick<Line, 'who'>, party: readonly Person[]): Person[] {
  if (line.who.length === 0) return [...party];
  const named = party.filter((person) => line.who.includes(person.id));
  return named.length > 0 ? named : [...party];
}

export interface PersonTotal {
  person: Person;
  total: number;
  byCategory: Record<Category, number>;
}

export interface Budget {
  /** Every line, typed and derived, in category order. */
  lines: Line[];
  /** The whole trip. Always the sum of the lines, whoever is carrying them. */
  total: number;
  byCategory: Record<Category, number>;
  people: PersonTotal[];
  /**
   * Money with nobody to carry it.
   *
   * Only ever non-zero when the party is empty, which is how the page starts.
   * It exists so the columns and the total can disagree *visibly* rather than
   * the total quietly shrinking to nothing the moment somebody deletes the last
   * name — the costs are still real, and the page says who they are waiting on.
   */
  unassigned: number;
}

const zeroed = (): Record<Category, number> =>
  Object.fromEntries(CATEGORIES.map((one) => [one, 0])) as Record<Category, number>;

/** The whole budget: totals overall, by heading, and down each person's column. */
export function budgetFor(lines: readonly Line[], party: readonly Person[]): Budget {
  const byCategory = zeroed();
  const people = new Map<string, PersonTotal>(
    party.map((person) => [person.id, { person, total: 0, byCategory: zeroed() }]),
  );
  let total = 0;
  let unassigned = 0;

  for (const line of lines) {
    const cost = lineTotal(line);
    total += cost;
    byCategory[line.category] += cost;

    const bearers = bearersOf(line, party);
    if (bearers.length === 0) {
      unassigned += cost;
      continue;
    }
    const shares = shareOut(cost, bearers.length);
    bearers.forEach((person, i) => {
      const column = people.get(person.id)!;
      column.total += shares[i];
      column.byCategory[line.category] += shares[i];
    });
  }

  const order = new Map(CATEGORIES.map((one, i) => [one, i]));
  const sorted = [...lines].sort((a, b) => order.get(a.category)! - order.get(b.category)!);

  return { lines: sorted, total, byCategory, people: [...people.values()], unassigned };
}

/**
 * Cents as money, to the cent.
 *
 * Always two decimal places, because a budget is a column of numbers and a
 * column that reads $1,240 / $87.50 / $12 does not line up as a column.
 */
export function dollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * What somebody typed, as cents.
 *
 * Takes "$1,240.50", "1240.5" and "1,240" alike, because a text box that only
 * accepts one of those is a text box people fight. Anything that is not a
 * number at all is null rather than zero — "" and "$0" are different answers,
 * and silently reading a half-typed number as nothing loses what was there.
 */
export function centsFrom(typed: string): number | null {
  const cleaned = typed.replace(/[$,\s]/g, '');
  if (!/^-?\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '-' || cleaned === '.') {
    return null;
  }
  return Math.round(Number(cleaned) * 100);
}
