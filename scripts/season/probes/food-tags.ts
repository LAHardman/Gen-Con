/**
 * Has Gen Con's food-tag vocabulary outgrown the hand-filed table?
 *
 * `FOOD_TAGS` places every tag the food vendors use into cuisine, dish or
 * dietary — by hand, because no rule reads them apart. A tag it doesn't
 * know still shows on the vendor and simply gets no filter chip, which is
 * the right quiet failure and also one nobody ever notices. This counts
 * the unfiled, and drafts the paste lines with a *guess* at the facet —
 * marked as a guess, because "Southern" being a cuisine and "Quick Eats"
 * being neither is exactly the judgement the table exists to hold.
 */

import type { Probe, ProbeResult } from '../lib';
import { EXHIBITORS, tagsOf } from '../../../src/data/exhibitors';
import { FOOD_TAGS } from '../../../src/data/food';

/** The tags the table leaves out on purpose — not food, or not a kind of it. */
const DELIBERATELY_ABSENT = new Set([
  'Food Truck',
  'Quick Eats',
  'Specialty Food Item',
  'Pin Bazaar',
  'Retailer',
  'LGBTQIA Plus Owned',
]);

export function guessFacet(tag: string): 'cuisine' | 'dish' | 'dietary' | null {
  if (/\b(free|vegan|vegetarian|halal|kosher|organic)\b/i.test(tag)) return 'dietary';
  if (/\b(bbq|barbecue|tacos?|pizzas?|burgers?|sandwich(es)?|crepes?|noodles?|bowls?|coffee|teas?|lemonade|desserts?|donuts?|doughnuts?|pretzels?|dogs?|fries|wings?|cream|drinks?|sodas?|smoothies?)\b/i.test(tag)) return 'dish';
  if (/(an|ese|ish|ican|ern|ine)$/i.test(tag)) return 'cuisine';
  return null;
}

export const probe: Probe = {
  id: 'food-tags',
  title: 'Food tag vocabulary',
  run(): Promise<ProbeResult> {
    const used = new Map<string, number>();
    for (const exhibitor of EXHIBITORS) {
      if (exhibitor.kind !== 'Food & Drink') continue;
      for (const tag of tagsOf(exhibitor)) used.set(tag, (used.get(tag) ?? 0) + 1);
    }
    const unfiled = [...used.entries()]
      .filter(([tag]) => !(tag in FOOD_TAGS) && !DELIBERATELY_ABSENT.has(tag))
      .sort((a, b) => b[1] - a[1]);

    if (!unfiled.length) {
      return Promise.resolve({
        status: 'ok',
        summary: `all ${used.size} tags the food vendors carry are filed or deliberately absent`,
      } satisfies ProbeResult);
    }
    return Promise.resolve({
      status: 'warn',
      summary: `${unfiled.length} food tag${unfiled.length === 1 ? '' : 's'} have no filter chip: ${unfiled.map(([tag]) => tag).join(', ')}`,
      details: unfiled.map(([tag, count]) => `"${tag}" on ${count} vendor${count === 1 ? '' : 's'}`),
      repair: unfiled.map(([tag]) => {
        const guess = guessFacet(tag);
        return guess
          ? `  ${JSON.stringify(tag)}: '${guess}',  // a guess — check it is what kitchen/what dish/what you can eat, not a mislabel`
          : `  ${JSON.stringify(tag)}: '???',  // no guess — decide cuisine | dish | dietary, or add it to the deliberately-absent list`;
      }),
      instructions: [
        'Paste the lines above into `FOOD_TAGS` in `src/data/food.ts`, correcting the guessed facets — the file\'s header explains the three questions a tag can answer.',
        'A tag that is not a kind of food (like "Food Truck") goes instead into the deliberately-absent list in that header comment and in `DELIBERATELY_ABSENT` in `scripts/season/probes/food-tags.ts`.',
        'Nothing is broken meanwhile: an unfiled tag still shows on its vendors, it just cannot be filtered by.',
      ],
    } satisfies ProbeResult);
  },
};
