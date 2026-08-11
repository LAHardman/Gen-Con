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
import { EATERIES, type Eatery } from './eateries';
import {
  formatOpening,
  openAt,
  openThrough,
  parseOpeningHours,
  type Coverage,
  type OpenHours,
  type Opening,
} from './hours';

/*
 * Re-exported so that everything about food is asked of one module.
 *
 * The mechanics moved to `hours.ts` when restaurants arrived, because a
 * restaurant's hours come from OpenStreetMap and a truck's are written down
 * here, and both have to answer the same question. Nothing that already asked
 * this file had to change.
 */
export { formatOpening, openAt, openThrough, parseOpeningHours };
export type { Coverage, OpenHours, Opening };

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

/**
 * The hours that apply to a vendor, where any are known.
 *
 * Only the Block Party has published hours at all, and within it the beer
 * garden keeps its own. Everywhere else — the exhibit hall included — returns
 * nothing, because nothing has said. Checked again for the "open now" filter:
 * `gencon.com/attend/exhibit-hall` carries no times either, so there is still
 * no hour of any hall to compare a clock against.
 */
export function openingFor(exhibitor: Exhibitor): Opening | null {
  if (!exhibitor.area.startsWith('Block Party')) return null;
  return /sun king/i.test(exhibitor.name) ? BEER_GARDEN_HOURS : FOOD_TRUCK_HOURS;
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

/* ------------------------------------------------- somewhere else to eat */

/**
 * Everywhere to eat, as one list — Gen Con's trucks and the city's restaurants.
 *
 * WHY THEY ARE ONE QUESTION. "Where can I eat" does not stop at the edge of
 * Gen Con's catalogue. It knows 43 trucks on South Street; the convention is in
 * the middle of a city, and there is an Indian restaurant four hundred metres
 * away that no amount of work on Gen Con's data would ever produce. See
 * `eateries.ts` for where the other 48 come from and what had to be true of one
 * to be kept.
 *
 * WHY THEY STAY TWO SHAPES. A truck is an `Exhibitor` with a booth in a room
 * the map draws; a restaurant is a coordinate with a street address. They are
 * walked to differently, drawn differently and linked differently, and pressing
 * them into one row type would mean a row where half the fields are always
 * empty. So this is a union, and the two halves are told apart by which side is
 * set.
 */
export type Bite =
  | { truck: Exhibitor; eatery?: undefined }
  | { eatery: Eatery; truck?: undefined };

/** Gen Con's own word for where its food is, and one word for everywhere else. */
export const OFF_SITE = 'Off site';

export const BITES: ReadonlyArray<Bite> = [
  ...EXHIBITORS.filter(isFood).map((truck) => ({ truck })),
  ...EATERIES.map((eatery) => ({ eatery })),
];

/** What to call it. */
export const biteName = (bite: Bite) => bite.truck?.name ?? bite.eatery!.name;

/**
 * Whereabouts it is: Gen Con's own area for a stand, `Off site` for the rest.
 *
 * Derived rather than written down, so if Gen Con ever lists food anywhere but
 * the Block Party the filter grows a chip for it without anybody editing a
 * list. Today that is exactly two values, and the second is the whole city.
 */
export const biteWhere = (bite: Bite) => bite.truck?.area ?? OFF_SITE;

/** What sort of place: Gen Con's kind for a stand, OSM's for a restaurant. */
export const biteKind = (bite: Bite) => bite.truck?.kind ?? bite.eatery!.kind;

/**
 * What it sells, in the three facets, from whichever source it came from.
 *
 * Gen Con's tags are already filed by `FOOD_TAGS`; OpenStreetMap's `cuisine`
 * is a cuisine by definition and its `diet:*` flags are dietary by definition,
 * so neither needs a table. A restaurant has no dish list at all, which is
 * honest: OSM records `Pizza` as a cuisine and does not record what is on the
 * menu any more than Gen Con does.
 */
export function biteFacets(bite: Bite): Record<FoodFacet, string[]> {
  if (bite.truck) {
    const facets = foodFacets(bite.truck);
    return { cuisine: facets.cuisine, dish: facets.dish, dietary: facets.dietary };
  }
  return { cuisine: bite.eatery!.cuisine, dish: [], dietary: bite.eatery!.diet };
}

/**
 * Its hours, where anything says.
 *
 * A truck's are Gen Con's, written down and a year old. A restaurant's are
 * whatever OpenStreetMap holds, read where this understands the form and null
 * where it does not — see `parseOpeningHours`, which refuses rather than
 * guesses. Both come back as the same `Opening`.
 */
export function biteOpening(bite: Bite): Opening | null {
  if (bite.truck) return openingFor(bite.truck);
  const hours = bite.eatery!.hours;
  return hours ? parseOpeningHours(hours) : null;
}

/**
 * Is it open at this moment?
 *
 * `null` where nothing says — which is a different answer from `false`, and the
 * difference matters: an "open now" filter that treats "nobody has said" as
 * "shut" hides a restaurant that is very probably open, and one that treats it
 * as "open" promises a walk to a locked door. The filter keeps only the ones
 * that answer `true`, and the panel says which are simply unknown.
 */
export function biteOpenAt(bite: Bite, atMs: number, offsetMinutes: number): boolean | null {
  const opening = biteOpening(bite);
  return opening ? openAt(opening, atMs, offsetMinutes) : null;
}

export interface BiteFilter {
  cuisine?: readonly string[];
  dish?: readonly string[];
  dietary?: readonly string[];
  /** Where it is: an area of Gen Con's, or `Off site`. */
  where?: readonly string[];
}

/** Does it survive the food filters? */
export function matchesBite(bite: Bite, filter: BiteFilter): boolean {
  if (filter.where?.length && !filter.where.includes(biteWhere(bite))) return false;
  const facets = biteFacets(bite);
  const has = (chosen: readonly string[] | undefined, held: string[]) =>
    !chosen?.length || held.some((one) => chosen.includes(one));
  return (
    has(filter.cuisine, facets.cuisine) &&
    has(filter.dish, facets.dish) &&
    has(filter.dietary, facets.dietary)
  );
}

export interface BiteChoices {
  cuisine: string[];
  dish: string[];
  dietary: string[];
  where: string[];
}

/**
 * What the pickers may offer, from what everywhere actually carries.
 *
 * Both sources at once, so `Indian` from a restaurant and `Korean` from a truck
 * stand in the same list — which is the point of putting them in one search.
 */
export function biteChoices(): BiteChoices {
  const found = {
    cuisine: new Set<string>(),
    dish: new Set<string>(),
    dietary: new Set<string>(),
    where: new Set<string>(),
  };
  for (const bite of BITES) {
    const facets = biteFacets(bite);
    for (const one of facets.cuisine) found.cuisine.add(one);
    for (const one of facets.dish) found.dish.add(one);
    for (const one of facets.dietary) found.dietary.add(one);
    found.where.add(biteWhere(bite));
  }
  return {
    cuisine: [...found.cuisine].sort(),
    dish: [...found.dish].sort(),
    dietary: [...found.dietary].sort(),
    where: [...found.where].sort(),
  };
}

export interface BiteCounts {
  total: number;
  cuisine: Map<string, number>;
  dish: Map<string, number>;
  dietary: Map<string, number>;
  where: Map<string, number>;
}

/**
 * How many places each chip would leave — what pressing it produces.
 *
 * 91 rows against seventy-odd options, so re-filtering is exact and free. The
 * same rule as everywhere: adding a second cuisine widens, so the count on an
 * unchosen one goes up.
 */
export function biteCounts(filter: BiteFilter, choices: BiteChoices): BiteCounts {
  const count = (next: BiteFilter) => BITES.filter((one) => matchesBite(one, next)).length;
  const forFacet = (facet: keyof BiteChoices) => {
    const chosen = filter[facet] ?? [];
    const out = new Map<string, number>();
    for (const value of choices[facet]) {
      const after = chosen.includes(value) ? chosen.filter((one) => one !== value) : [...chosen, value];
      out.set(value, count({ ...filter, [facet]: after }));
    }
    return out;
  };
  return {
    total: count(filter),
    cuisine: forFacet('cuisine'),
    dish: forFacet('dish'),
    dietary: forFacet('dietary'),
    where: forFacet('where'),
  };
}
