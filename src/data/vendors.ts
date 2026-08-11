/**
 * Narrowing 845 stands down to the one somebody is looking for.
 *
 * WHY THIS IS NOT THE EVENT FILTER. A stand has no day, no start time, no cost
 * and no age limit, and until now choosing "Vendors" and then touching any
 * filter silenced the list completely — every dimension on offer could only
 * ever be false of a booth. The three questions that *are* askable of a stand
 * are what sort of thing it is, whereabouts it stands, and what it sells, and
 * Gen Con publishes all three.
 *
 * WHAT GEN CON PUBLISHES, and therefore what is here:
 *
 *   kind   eight of them, its own word — Exhibitors (622), Artists (90),
 *          Food & Drink (43), Authors (39), Makers (22), Community Groups (19),
 *          Entertainers (8), Sponsors (2)
 *   area   sixteen, also its own words — `Exhibit Hall`, `Art Show`,
 *          `ICC : Hall B`, `Block Party`, `Stadium : West Club Lounge`
 *   tags   a vocabulary of 116 across the catalogue, from `Publisher` (347) and
 *          `Board Games` (301) down to the one-offs
 *
 * THE TAGS ARE A LIST RATHER THAN CHIPS. 116 of them is not a row of buttons on
 * a phone; it is a `<select>`, exactly as the game system is a text box because
 * 1,845 values is not a list. One at a time for the same reason — and unlike the
 * food facets, which are twelve, twenty-six and five and fit.
 *
 * NOTHING HERE INVENTS A VALUE. Every choice is read off the live catalogue, so
 * a kind or an area Gen Con stops using stops being offered, and one it adds
 * appears without anybody editing a list.
 */

import { EXHIBITORS, tagsOf, type Exhibitor } from './exhibitors';
import { isFood } from './food';

export interface VendorFilter {
  /** Gen Con's own word for the sort of stand. Empty means any. */
  standKinds?: readonly string[];
  /** Gen Con's own word for whereabouts it is. Empty means anywhere. */
  areas?: readonly string[];
  /** Its tags. Empty means any; more than one widens, as everywhere else. */
  tags?: readonly string[];
}

export interface VendorChoices {
  kinds: string[];
  areas: string[];
  tags: string[];
}

/**
 * Every stand a search of this kind could return.
 *
 * Food keeps its own panel — cuisine, dish and dietary — so the Vendors list is
 * everything else. Split here rather than at three call sites, and it is the
 * same split `search` makes.
 */
export const vendorsOf = (kind: 'food' | 'vendor'): Exhibitor[] =>
  EXHIBITORS.filter((one) => (kind === 'food' ? isFood(one) : !isFood(one)));

/** What the pickers may offer, from what those stands actually carry. */
export function vendorChoices(vendors: readonly Exhibitor[]): VendorChoices {
  const kinds = new Set<string>();
  const areas = new Set<string>();
  const tags = new Set<string>();
  for (const one of vendors) {
    kinds.add(one.kind);
    areas.add(one.area);
    for (const tag of tagsOf(one)) tags.add(tag);
  }
  return {
    kinds: [...kinds].sort(),
    areas: [...areas].sort(),
    tags: [...tags].sort(),
  };
}

/** Does this stand survive the vendor filters? */
export function matchesVendor(exhibitor: Exhibitor, filter: VendorFilter): boolean {
  if (filter.standKinds?.length && !filter.standKinds.includes(exhibitor.kind)) return false;
  if (filter.areas?.length && !filter.areas.includes(exhibitor.area)) return false;
  if (filter.tags?.length) {
    const held = tagsOf(exhibitor);
    if (!filter.tags.some((tag) => held.includes(tag))) return false;
  }
  return true;
}

export interface VendorCounts {
  total: number;
  kinds: Map<string, number>;
  areas: Map<string, number>;
  tags: Map<string, number>;
}

/**
 * How many stands each option would leave, by the same rule as everywhere else.
 *
 * A count is *what pressing it produces*, not how many carry that value — so
 * adding a second area widens and the number on an unchosen one goes up. Taken
 * by re-filtering rather than by adding, because a stand carries several tags
 * at once and adding would count it twice.
 *
 * 845 stands against 140 options is 118,300 comparisons, which is a millisecond
 * or two — nothing like the 27,457 events `facetCounts` has to be clever about.
 */
export function vendorCounts(
  vendors: readonly Exhibitor[],
  filter: VendorFilter,
  choices: VendorChoices,
): VendorCounts {
  const count = (next: VendorFilter) => vendors.filter((one) => matchesVendor(one, next)).length;

  const forFacet = (facet: 'standKinds' | 'areas' | 'tags', values: string[]) => {
    const chosen = filter[facet] ?? [];
    const out = new Map<string, number>();
    for (const value of values) {
      const after = chosen.includes(value)
        ? chosen.filter((one) => one !== value)
        : [...chosen, value];
      out.set(value, count({ ...filter, [facet]: after }));
    }
    return out;
  };

  return {
    total: count(filter),
    kinds: forFacet('standKinds', choices.kinds),
    areas: forFacet('areas', choices.areas),
    tags: forFacet('tags', choices.tags),
  };
}
