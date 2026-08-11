/**
 * The food trucks: what they sell, and what nobody publishes about them.
 *
 * TWO THINGS ARE BEING GUARDED. The first is that the classification is
 * *complete against the live catalogue* — a tag Gen Con uses that nobody has
 * filed answers no question, and the whole point of splitting cuisine from dish
 * from dietary is that somebody looking for lunch is asking exactly one of them.
 *
 * The second is the hours, and it is the more important. They are not published
 * anywhere a program can reach: not in the API, not on the 2026 page, not
 * derivable from the schedule. What is in the repository is last year's, in Gen
 * Con's own words, carrying the year it belongs to — and the thing that must
 * never happen is that year being lost on the way to the screen, because then
 * the app is quietly telling people when to turn up for a food truck using
 * numbers from a different convention.
 */

import { describe, expect, it } from 'vitest';
import {
  BEER_GARDEN_HOURS,
  FOOD_TAGS,
  FOOD_TRUCK_HOURS,
  foodChoices,
  foodCounts,
  foodFacets,
  formatOpening,
  isFood,
  matchesFood,
  openAt,
  openingFor,
  openThrough,
} from './food';
import { EXHIBITORS, tagsOf, type Exhibitor } from './exhibitors';

const food = EXHIBITORS.filter(isFood);
const named = (name: string) => EXHIBITORS.find((one) => one.name === name)!;

describe('the vendors themselves', () => {
  it('finds the Block Party in the catalogue', () => {
    expect(food.length).toBeGreaterThan(30);
    expect(food.every((one) => one.area.startsWith('Block Party'))).toBe(true);
  });

  it('carries a tag on every single one', () => {
    // This is what the whole feature stands on. A vendor with no tags is a
    // vendor no food filter can ever find.
    const bare = food.filter((one) => tagsOf(one).length === 0);
    expect(bare.map((one) => one.name)).toEqual([]);
  });

  it('keeps their own website, which is the nearest thing to a menu', () => {
    // Gen Con publishes no dishes and no prices. What it does publish is a
    // link, and for a food truck that is where the menu actually lives.
    const linked = food.filter((one) => one.website);
    expect(linked.length).toBe(food.length);
    expect(linked.every((one) => /^https?:\/\//.test(one.website!))).toBe(true);
  });

  it('keeps the id its description is fetched by', () => {
    expect(food.every((one) => typeof one.id === 'number')).toBe(true);
  });
});

describe('splitting the tags three ways', () => {
  it('files every tag the food vendors actually use, or leaves it out on purpose', () => {
    // The guard against a new cuisine appearing next year and answering nothing.
    // Anything unfiled shows on the vendor but gets no chip, so this lists what
    // is deliberately unfiled rather than asserting the table is exhaustive.
    const notFood = new Set([
      'Food Truck',
      'Quick Eats',
      'Specialty Food Item',
      'Pin Bazaar',
      'Retailer',
      'LGBTQIA Plus Owned',
    ]);
    const used = new Set(food.flatMap(tagsOf));
    const unfiled = [...used].filter((tag) => !FOOD_TAGS[tag] && !notFood.has(tag));
    expect(unfiled).toEqual([]);
  });

  it('answers one question per tag', () => {
    const arepas = foodFacets(named('Arepas'));
    expect(arepas.cuisine).toContain('Venezuelan');
    expect(arepas.dish).toContain('Arepa');
    expect(arepas.dietary).toEqual(expect.arrayContaining(['Vegan Options', 'Gluten Free options']));
    // What kind of stall it is, which is not what it sells.
    expect(arepas.other).toContain('Food Truck');
  });

  it('offers only what somebody actually carries', () => {
    const choices = foodChoices();
    expect(choices.cuisine).toContain('Venezuelan');
    expect(choices.dish).toContain('Tacos');
    expect(choices.dietary).toContain('Vegan Options');
    expect(choices.cuisine).not.toContain('Food Truck');
    for (const facet of ['cuisine', 'dish', 'dietary'] as const) {
      for (const tag of choices[facet]) expect(FOOD_TAGS[tag]).toBe(facet);
    }
  });
});

describe('filtering by what they sell', () => {
  it('narrows within a facet and widens across values of it', () => {
    const vegan = food.filter((one) => matchesFood(one, { dietary: ['Vegan Options'] }));
    const both = food.filter((one) =>
      matchesFood(one, { dietary: ['Vegan Options', 'Gluten Free options'] }),
    );
    expect(vegan.length).toBeGreaterThan(0);
    expect(both.length).toBeGreaterThanOrEqual(vegan.length);
  });

  it('takes all three facets together', () => {
    const only = food.filter((one) =>
      matchesFood(one, { cuisine: ['Venezuelan'], dietary: ['Vegan Options'] }),
    );
    expect(only.length).toBeGreaterThan(0);
    for (const one of only) {
      expect(tagsOf(one)).toContain('Venezuelan');
      expect(tagsOf(one)).toContain('Vegan Options');
    }
  });

  it('counts what pressing each chip would leave', () => {
    // The same rule the event filters follow, and the reason it is worth
    // stating: a vendor can hold two cuisines at once, so these are counted by
    // re-filtering rather than by adding.
    const choices = foodChoices();
    const counts = foodCounts(food, { cuisine: ['Mexican'] }, choices);
    const actually = (next: Parameters<typeof matchesFood>[1]) =>
      food.filter((one) => matchesFood(one, next)).length;

    expect(counts.total).toBe(actually({ cuisine: ['Mexican'] }));
    expect(counts.cuisine.get('Korean')).toBe(actually({ cuisine: ['Mexican', 'Korean'] }));
    expect(counts.cuisine.get('Mexican')).toBe(actually({}));
    expect(counts.dietary.get('Vegan Options')).toBe(
      actually({ cuisine: ['Mexican'], dietary: ['Vegan Options'] }),
    );
  });

  it('gives a number for a chip that would empty the list, not nothing', () => {
    const choices = foodChoices();
    const counts = foodCounts(food, { cuisine: ['Korean'] }, choices);
    for (const tag of choices.dish) expect(typeof counts.dish.get(tag)).toBe('number');
  });
});

describe('the hours, and the year they belong to', () => {
  const truck = named('Arepas');

  it('gives the Block Party hours and nowhere else any', () => {
    // Gen Con publishes hours for the Block Party alone. The exhibit hall gets
    // none rather than a guess.
    expect(openingFor(truck)).toBe(FOOD_TRUCK_HOURS);
    const inTheHall = EXHIBITORS.find((one) => one.area === 'Exhibit Hall')!;
    expect(openingFor(inTheHall)).toBeNull();
  });

  it('gives the beer garden its own, which are different', () => {
    const sunKing = EXHIBITORS.find((one) => /sun king/i.test(one.name) && one.area.startsWith('Block Party'))!;
    expect(openingFor(sunKing)).toBe(BEER_GARDEN_HOURS);
    expect(formatOpening(BEER_GARDEN_HOURS)).not.toBe(formatOpening(FOOD_TRUCK_HOURS));
  });

  it('carries the year, because they are last year’s', () => {
    // The one that matters. These are 2025's hours, taken from a block Gen Con
    // has commented out of the 2026 page — showing them as this year's would be
    // telling somebody when to turn up using a different convention's times.
    expect(FOOD_TRUCK_HOURS.year).toBe(2025);
    expect(BEER_GARDEN_HOURS.year).toBe(2025);
  });

  it('reads them the way a sign would', () => {
    expect(formatOpening(FOOD_TRUCK_HOURS)).toBe('Thu–Sat 9am–9pm · Sun 9am–4pm');
    expect(formatOpening(BEER_GARDEN_HOURS)).toBe('Wed 5pm–10pm · Thu–Sat 12pm–10pm');
  });

  it('answers whether they are open, in the convention’s own time', () => {
    const east = -240;
    // Saturday lunchtime in Indianapolis.
    expect(openAt(FOOD_TRUCK_HOURS, Date.parse('2026-08-01T12:00:00-04:00'), east)).toBe(true);
    // Ten at night on the same Saturday: shut.
    expect(openAt(FOOD_TRUCK_HOURS, Date.parse('2026-08-01T22:00:00-04:00'), east)).toBe(false);
    // Sunday at five: the trucks close at four.
    expect(openAt(FOOD_TRUCK_HOURS, Date.parse('2026-08-02T17:00:00-04:00'), east)).toBe(false);
    // The beer garden does not open on the Sunday at all.
    expect(openAt(BEER_GARDEN_HOURS, Date.parse('2026-08-02T13:00:00-04:00'), east)).toBe(false);
  });

  it('checks the whole of a stop, not the minute it starts', () => {
    // The mistake worth catching. A locked door at nine in the morning is
    // obvious; half past eight until half past nine at a truck that shuts at
    // nine is not, and a check on the start time alone calls it fine.
    expect(openThrough(FOOD_TRUCK_HOURS, '2026-08-01', 12 * 60, 12 * 60 + 30)).toBe('open');
    expect(openThrough(FOOD_TRUCK_HOURS, '2026-08-01', 20 * 60 + 30, 21 * 60 + 30)).toBe('partly');
    expect(openThrough(FOOD_TRUCK_HOURS, '2026-08-01', 2 * 60, 2 * 60 + 30)).toBe('shut');
  });

  it('reads the day off the date rather than being told it', () => {
    // Sunday: the trucks shut at four, and the beer garden does not open at all.
    expect(openThrough(FOOD_TRUCK_HOURS, '2026-08-02', 15 * 60, 15 * 60 + 30)).toBe('open');
    expect(openThrough(FOOD_TRUCK_HOURS, '2026-08-02', 17 * 60, 17 * 60 + 30)).toBe('shut');
    expect(openThrough(BEER_GARDEN_HOURS, '2026-08-02', 13 * 60, 14 * 60)).toBe('shut');
  });

  it('compares a stop past midnight against the next day’s hours', () => {
    // Eleven at night until half past midnight on the Saturday is measured
    // against Sunday morning, not against Saturday morning wrapped round.
    // The beer garden shuts at ten on the Saturday and opens at noon; both
    // halves of that span are outside, which is 'shut' rather than 'partly'.
    expect(openThrough(BEER_GARDEN_HOURS, '2026-08-01', 23 * 60, 24 * 60 + 30)).toBe('shut');
    // Nine in the evening until half past midnight: open for the first hour.
    expect(openThrough(BEER_GARDEN_HOURS, '2026-08-01', 21 * 60, 24 * 60 + 30)).toBe('partly');
  });

  it('does not read the viewer’s clock', () => {
    // Nine in the evening in Indianapolis is one in the morning in UTC. Read in
    // the wrong zone, the trucks would look shut all afternoon and open at dawn.
    const east = -240;
    const closingTime = Date.parse('2026-08-01T20:59:00-04:00');
    expect(openAt(FOOD_TRUCK_HOURS, closingTime, east)).toBe(true);
    expect(openAt(FOOD_TRUCK_HOURS, closingTime, 0)).toBe(false);
  });
});

/** A stand-in vendor, for the cases the real catalogue does not contain. */
const madeUp = (over: Partial<Exhibitor> = {}): Exhibitor => ({
  name: 'Somewhere',
  kind: 'Food & Drink',
  area: 'Block Party',
  spot: 'Food Truck 99',
  ...over,
});

describe('a vendor the catalogue has not seen', () => {
  it('is not food unless Gen Con says it is', () => {
    expect(isFood(madeUp({ kind: 'Exhibitors' }))).toBe(false);
    expect(isFood(madeUp())).toBe(true);
  });

  it('survives having no tags at all', () => {
    const bare = madeUp();
    expect(foodFacets(bare)).toEqual({ cuisine: [], dish: [], dietary: [], other: [] });
    expect(matchesFood(bare, {})).toBe(true);
    expect(matchesFood(bare, { cuisine: ['Korean'] })).toBe(false);
  });
});
