/**
 * Filtering 802 stands, and the bug this whole file exists to end.
 *
 * Choosing "Vendors" and then touching any filter used to empty the list —
 * every dimension on offer was an *event* dimension, and a booth has no day, no
 * start time, no cost and no age limit, so each one could only ever be false of
 * it. The list looked like a search that found nothing, which is the worst way
 * for a filter to fail: nothing on screen says the question was unanswerable.
 *
 * So what is guarded here is that the three dimensions a stand *can* answer are
 * read off the live catalogue rather than written down, that they narrow what
 * they say they narrow, and that the counts beside them are what pressing them
 * produces rather than how many carry that value.
 */

import { describe, expect, it } from 'vitest';
import { matchesVendor, vendorChoices, vendorCounts, vendorsOf } from './vendors';
import { isFood } from './food';
import { EXHIBITORS, tagsOf } from './exhibitors';

const stands = vendorsOf('vendor');
const choices = vendorChoices(stands);

describe('what a stand can be asked', () => {
  it('splits food off, because food has its own three questions', () => {
    expect(stands.length).toBeGreaterThan(700);
    expect(stands.some(isFood)).toBe(false);
    expect(vendorsOf('food').every(isFood)).toBe(true);
    // Between them they are the whole catalogue and nothing twice.
    expect(stands.length + vendorsOf('food').length).toBe(EXHIBITORS.length);
  });

  it('offers only kinds, areas and tags somebody actually carries', () => {
    expect(choices.kinds).toContain('Artists');
    expect(choices.kinds).not.toContain('Food & Drink');
    expect(choices.areas).toContain('Exhibit Hall');
    expect(choices.tags).toContain('Board Games');
    for (const kind of choices.kinds) expect(stands.some((one) => one.kind === kind)).toBe(true);
    for (const area of choices.areas) expect(stands.some((one) => one.area === area)).toBe(true);
  });

  it('has more tags than fit on a row of buttons, which is why they are a list', () => {
    // The reason the tag picker is a <select> and the food facets are chips.
    expect(choices.tags.length).toBeGreaterThan(50);
    expect(choices.kinds.length).toBeLessThan(12);
  });
});

describe('narrowing', () => {
  it('narrows on the kind of stand', () => {
    const artists = stands.filter((one) => matchesVendor(one, { standKinds: ['Artists'] }));
    expect(artists.length).toBeGreaterThan(0);
    expect(artists.every((one) => one.kind === 'Artists')).toBe(true);
  });

  it('widens across values of one dimension and narrows across two', () => {
    const artists = stands.filter((one) => matchesVendor(one, { standKinds: ['Artists'] }));
    const both = stands.filter((one) => matchesVendor(one, { standKinds: ['Artists', 'Authors'] }));
    expect(both.length).toBeGreaterThan(artists.length);
    const inTheHall = stands.filter((one) =>
      matchesVendor(one, { standKinds: ['Artists'], areas: ['Exhibit Hall'] }),
    );
    expect(inTheHall.length).toBeLessThan(artists.length);
  });

  it('matches a tag against the tags a stand actually holds', () => {
    const found = stands.filter((one) => matchesVendor(one, { tags: ['Board Games'] }));
    expect(found.length).toBeGreaterThan(50);
    for (const one of found) expect(tagsOf(one)).toContain('Board Games');
  });

  it('lets a stand with no tags through an empty filter and not a tag one', () => {
    const bare = stands.find((one) => tagsOf(one).length === 0);
    if (!bare) return;
    expect(matchesVendor(bare, {})).toBe(true);
    expect(matchesVendor(bare, { tags: ['Board Games'] })).toBe(false);
  });
});

describe('what pressing each one would leave', () => {
  it('counts by re-filtering, so the number is what the press produces', () => {
    const counts = vendorCounts(stands, { standKinds: ['Artists'] }, choices);
    const actually = (next: Parameters<typeof matchesVendor>[1]) =>
      stands.filter((one) => matchesVendor(one, next)).length;

    expect(counts.total).toBe(actually({ standKinds: ['Artists'] }));
    // An unchosen value *widens* — the count goes up, not down.
    expect(counts.kinds.get('Authors')).toBe(actually({ standKinds: ['Artists', 'Authors'] }));
    expect(counts.kinds.get('Authors')!).toBeGreaterThan(counts.total);
    // A chosen one is what removing it would leave.
    expect(counts.kinds.get('Artists')).toBe(actually({}));
    // And another dimension narrows within the first.
    expect(counts.areas.get('Art Show')).toBe(
      actually({ standKinds: ['Artists'], areas: ['Art Show'] }),
    );
  });

  it('gives a number for an option that would empty the list, rather than nothing', () => {
    const counts = vendorCounts(stands, { standKinds: ['Authors'] }, choices);
    for (const area of choices.areas) expect(typeof counts.areas.get(area)).toBe('number');
    expect([...counts.areas.values()].some((n) => n === 0)).toBe(true);
  });

  it('counts every tag in the list, which is the expensive one', () => {
    const counts = vendorCounts(stands, {}, choices);
    expect(counts.tags.size).toBe(choices.tags.length);
    expect(counts.tags.get('Board Games')).toBeGreaterThan(0);
  });
});
