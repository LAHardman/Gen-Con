/**
 * The Block Party's food trucks, and what they sell.
 *
 * WHERE THIS COMES FROM. Gen Con files every exhibitor under tags of its own —
 * `Tacos`, `Venezuelan`, `Gluten Free options` — and 43 of 43 Block Party
 * vendors carry them. The importer keeps them; this decides what they mean.
 *
 * WHY A HAND-WRITTEN TABLE. The 49 tags the food vendors use are three
 * different questions wearing one coat: what kitchen it is (Korean, Venezuelan),
 * what comes out of it (Tacos, Crepes, Burger), and what you can eat (Vegan,
 * Gluten Free). Somebody looking for lunch is asking one of those three and not
 * the other two, and no rule reads them apart — "Southern" is a cuisine,
 * "Soulfood" is arguably both, "Quick Eats" is neither. So every tag Gen Con
 * currently uses is placed here by hand, with the ones that are neither left
 * out on purpose.
 *
 * A TAG NOT IN THIS TABLE STILL SHOWS on the vendor; it simply gets no filter
 * chip of its own. That is the right failure for a list somebody else edits:
 * next year's new cuisine appears on the trucks that have it and waits for
 * somebody to file it, rather than vanishing.
 *
 * THERE ARE NO MENUS, and no amount of work here would produce one. Gen Con's
 * API carries no dishes and no prices; the per-exhibitor record has a
 * description, which for 19 of the 43 is the words "Visit us at Gen Con Indy
 * 2026 at Block Party on South Street" and for most of the rest is a sentence
 * of marketing. What each vendor does have is its own website, and that is what
 * the app links to instead — for 15 of them that is a Facebook page, which is
 * where a food truck actually posts its menu.
 */

import { EXHIBITORS, tagsOf, type Exhibitor } from './exhibitors';

/** Which of the three questions a tag answers. */
export type FoodFacet = 'cuisine' | 'dish' | 'dietary';

/**
 * Every tag Gen Con's food vendors currently use, placed by hand.
 *
 * Read off the live catalogue rather than imagined: these are the 49 in use,
 * and the ones deliberately absent are `Food Truck` (28 of them — that is what
 * kind of stall it is, not what it sells), `Quick Eats`, `Specialty Food Item`,
 * `Pin Bazaar`, `Retailer` and `LGBTQIA Plus Owned`. The last is a real and
 * useful thing to know and is shown on the vendor; it is not a kind of food.
 */
export const FOOD_TAGS: Readonly<Record<string, FoodFacet>> = {
  // What kitchen it is.
  Venezuelan: 'cuisine',
  Mexican: 'cuisine',
  Italian: 'cuisine',
  Korean: 'cuisine',
  Filipino: 'cuisine',
  Southern: 'cuisine',
  Soulfood: 'cuisine',
  BBQ: 'cuisine',
  Seafood: 'cuisine',
  Breakfast: 'cuisine',
  Desserts: 'cuisine',
  'Coffee/Tea': 'cuisine',

  // What actually comes out of it.
  Tacos: 'dish',
  Sandwiches: 'dish',
  Burger: 'dish',
  Pizza: 'dish',
  'Fried Chicken': 'dish',
  'Fried Catfish': 'dish',
  'Hot Dogs': 'dish',
  Nachos: 'dish',
  Arepa: 'dish',
  'Egg Rolls': 'dish',
  Crepes: 'dish',
  Breadsticks: 'dish',
  Donuts: 'dish',
  Cupcakes: 'dish',
  'Ice Cream': 'dish',
  'Shaved Ice': 'dish',
  Soda: 'dish',
  Lemonade: 'dish',
  Slushies: 'dish',
  Smoothie: 'dish',
  'Juice Bar': 'dish',
  'Cold Brew Coffee': 'dish',
  Beer: 'dish',
  Wine: 'dish',
  Seltzer: 'dish',
  Mocktails: 'dish',

  // What you can actually eat.
  'Gluten Free options': 'dietary',
  'Vegetarian Options': 'dietary',
  'Vegan Options': 'dietary',
  'Non-Alcoholic': 'dietary',
  Healthy: 'dietary',
};

/** Gen Con's own name for the group these belong to. */
export const FOOD_KIND = 'Food & Drink';

export const isFood = (exhibitor: Exhibitor) => exhibitor.kind === FOOD_KIND;

const BY_ID = new Map(
  EXHIBITORS.filter((one) => one.id !== undefined).map((one) => [one.id!, one] as const),
);

/**
 * A vendor by the id Gen Con files it under.
 *
 * Which is what a stop on somebody's schedule holds — `vendor:14179@…` — so a
 * food truck already on a Saturday can still be shown what it sells and linked
 * to its own page. Looked up rather than copied into the entry: the catalogue
 * is bundled, not fetched, so this works with no network, and a vendor whose
 * website changed between releases reads the new one.
 */
export const vendorById = (id: number): Exhibitor | undefined => BY_ID.get(id);

/** A vendor's tags, split into the three questions and the rest. */
export function foodFacets(exhibitor: Exhibitor): Record<FoodFacet, string[]> & { other: string[] } {
  const out = { cuisine: [] as string[], dish: [] as string[], dietary: [] as string[], other: [] as string[] };
  for (const tag of tagsOf(exhibitor)) {
    const facet = FOOD_TAGS[tag];
    if (facet) out[facet].push(tag);
    else out.other.push(tag);
  }
  return out;
}

/**
 * What each facet can be filtered by, from what the vendors actually carry.
 *
 * Built from the catalogue rather than from the table above, so a tag that is
 * classified but that nobody uses this year is not offered — the same rule the
 * event filters follow.
 */
export function foodChoices(): Record<FoodFacet, string[]> {
  const found: Record<FoodFacet, Set<string>> = {
    cuisine: new Set(),
    dish: new Set(),
    dietary: new Set(),
  };
  for (const exhibitor of EXHIBITORS) {
    if (!isFood(exhibitor)) continue;
    for (const tag of tagsOf(exhibitor)) {
      const facet = FOOD_TAGS[tag];
      if (facet) found[facet].add(tag);
    }
  }
  return {
    cuisine: [...found.cuisine].sort(),
    dish: [...found.dish].sort(),
    dietary: [...found.dietary].sort(),
  };
}

/* ------------------------------------------------------------------ hours */

/**
 * When the Block Party is open — and why this is written down rather than read.
 *
 * IT IS NOT PUBLISHED ANYWHERE A PROGRAM CAN REACH. Checked, in this order:
 *
 *   - the exhibitor API, both the listing and the per-exhibitor record: no
 *     hours field on either;
 *   - `/api/v1/hours`, `/venues`, `/areas`, `/exhibit_hall_hours`: all 404, and
 *     `/api/v1/convention` carries registration dates and nothing about a day;
 *   - `gencon.com/gen-con-indy/block-party`, which *does* contain hours — inside
 *     an HTML comment. They are last year's, commented out while the 2026 page
 *     is written, and scraping the page without checking would have shipped
 *     2025's times as this year's;
 *   - the event feed: `block-party-street` has **zero** events in it, so there
 *     is nothing to derive a span from either.
 *
 * So these are Gen Con's own words, from that commented block, kept here with
 * the year they belong to attached — and the app says which year it is showing.
 * When Gen Con publishes 2026's, this is the one place to change.
 */
export interface OpenHours {
  /** Weekday numbers as `Date.getUTCDay` writes them: Sunday 0, Thursday 4. */
  days: number[];
  /** Minutes past midnight. */
  from: number;
  to: number;
}

export interface Opening {
  /** The year these hours were published for. */
  year: number;
  hours: OpenHours[];
}

const at = (hour: number, minute = 0) => hour * 60 + minute;

/** The food trucks. Gen Con: "Thursday - Saturday, 9am - 9pm / Sunday, 9am - 4pm". */
export const FOOD_TRUCK_HOURS: Opening = {
  year: 2025,
  hours: [
    { days: [4, 5, 6], from: at(9), to: at(21) },
    { days: [0], from: at(9), to: at(16) },
  ],
};

/** Where the beer is. Gen Con: "Wed tapping 5-10pm / Thu-Sat, noon - 10pm". */
export const BEER_GARDEN_HOURS: Opening = {
  year: 2025,
  hours: [
    { days: [3], from: at(17), to: at(22) },
    { days: [4, 5, 6], from: at(12), to: at(22) },
  ],
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Thu–Sat 9am–9pm · Sun 9am–4pm", as somebody would read it off a sign. */
export function formatOpening(opening: Opening): string {
  return opening.hours.map((span) => `${spanDays(span.days)} ${clock(span.from)}–${clock(span.to)}`).join(' · ');
}

function spanDays(days: number[]): string {
  const names = days.map((day) => DAY_NAMES[day].slice(0, 3));
  if (names.length === 1) return names[0];
  // Runs of consecutive weekdays read as a range; anything else is a list.
  const consecutive = days.every((day, at) => at === 0 || day === days[at - 1] + 1);
  return consecutive ? `${names[0]}–${names[names.length - 1]}` : names.join(', ');
}

function clock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const suffix = hour < 12 ? 'am' : 'pm';
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return rest ? `${shown}:${String(rest).padStart(2, '0')}${suffix}` : `${shown}${suffix}`;
}

/**
 * The hours that apply to a vendor, where any are known.
 *
 * Only the Block Party has published hours at all, and within it the beer
 * garden keeps its own. Everywhere else — the exhibit hall included — returns
 * nothing, because nothing has said.
 */
export function openingFor(exhibitor: Exhibitor): Opening | null {
  if (!exhibitor.area.startsWith('Block Party')) return null;
  return /sun king/i.test(exhibitor.name) ? BEER_GARDEN_HOURS : FOOD_TRUCK_HOURS;
}

/** Whether a moment falls inside them, at the convention's own offset. */
export function openAt(opening: Opening, atMs: number, offsetMinutes: number): boolean {
  const local = new Date(atMs + offsetMinutes * 60_000);
  const day = local.getUTCDay();
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  return opening.hours.some(
    (span) => span.days.includes(day) && minute >= span.from && minute < span.to,
  );
}

/** How much of a span they are open for. */
export type Coverage = 'open' | 'partly' | 'shut';

/**
 * Whether they are open for the *whole* of a planned stop, part of it, or none.
 *
 * The whole of it, because the failure this is for is not turning up to a locked
 * door — that one is obvious — but planning to eat from half past eight to half
 * past nine at a truck that shuts at nine. A check on the start time alone calls
 * that fine.
 *
 * Measured in minutes from the start of the day the stop begins on, so a stop
 * running past midnight compares against the next day's hours rather than
 * wrapping round to that morning's.
 */
export function openThrough(
  opening: Opening,
  day: string,
  fromMinutes: number,
  toMinutes: number,
): Coverage {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const open: Array<[number, number]> = [];
  // Today's hours, and tomorrow's shifted a day along — a stop is at most a day
  // long, so those two are all it can reach.
  for (const shift of [0, 1]) {
    const on = (weekday + shift) % 7;
    for (const span of opening.hours) {
      if (span.days.includes(on)) open.push([span.from + shift * 1440, span.to + shift * 1440]);
    }
  }

  // Merged before they are added up, so a future edit that writes two
  // overlapping spans for one day cannot count the overlap twice and call a
  // stop covered that is not.
  open.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let reached = fromMinutes;
  for (const [from, to] of open) {
    const start = Math.max(from, reached);
    covered += Math.max(0, Math.min(to, toMinutes) - Math.max(start, fromMinutes));
    reached = Math.max(reached, to);
  }
  if (covered <= 0) return 'shut';
  return covered >= toMinutes - fromMinutes ? 'open' : 'partly';
}

/* ------------------------------------------------------------ filtering */

/** Does this vendor survive the food filters? */
export function matchesFood(
  exhibitor: Exhibitor,
  filter: { cuisine?: readonly string[]; dish?: readonly string[]; dietary?: readonly string[] },
): boolean {
  const has = (tags: readonly string[] | undefined, facet: FoodFacet) =>
    !tags?.length || tagsOf(exhibitor).some((tag) => FOOD_TAGS[tag] === facet && tags.includes(tag));
  return has(filter.cuisine, 'cuisine') && has(filter.dish, 'dish') && has(filter.dietary, 'dietary');
}

export interface FoodCounts {
  total: number;
  cuisine: Map<string, number>;
  dish: Map<string, number>;
  dietary: Map<string, number>;
}

/**
 * How many vendors each food chip would leave, by the same rule as the events.
 *
 * Written out rather than run through `facetCounts`, because the corpus here is
 * 43 vendors against 27,457 events and none of that machinery earns its keep —
 * but the *semantics* are the same and have to be: a count is what pressing it
 * produces, so adding a second cuisine widens and the number goes up.
 *
 * One difference the arithmetic has to respect: a vendor can carry two cuisines
 * at once, where an event has exactly one day. So the counts are taken by
 * re-filtering rather than by adding, which is exact and, at 43 rows, free.
 */
export function foodCounts(
  vendors: readonly Exhibitor[],
  filter: { cuisine?: readonly string[]; dish?: readonly string[]; dietary?: readonly string[] },
  choices: Record<FoodFacet, string[]>,
): FoodCounts {
  const count = (next: typeof filter) => vendors.filter((one) => matchesFood(one, next)).length;

  const forFacet = (facet: FoodFacet) => {
    const chosen = filter[facet] ?? [];
    const out = new Map<string, number>();
    for (const tag of choices[facet]) {
      const after = chosen.includes(tag) ? chosen.filter((one) => one !== tag) : [...chosen, tag];
      out.set(tag, count({ ...filter, [facet]: after }));
    }
    return out;
  };

  return {
    total: count(filter),
    cuisine: forFacet('cuisine'),
    dish: forFacet('dish'),
    dietary: forFacet('dietary'),
  };
}
