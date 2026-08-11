/**
 * The search box: the keyboard, and when the list is allowed to be on screen.
 *
 * `search.test.ts` covers what comes back and in what order. This covers what
 * happens to it — which is where a search box goes wrong in ways nobody writes
 * a bug report for, because the list still appears and the results in it are
 * still right:
 *
 *   Enter picks whatever the arrow keys left highlighted, so a highlight that
 *   does not move, or moves and is not what Enter reads, takes you somewhere
 *   you did not choose.
 *
 *   The list commits on pointer-down rather than on click, because a pointer
 *   down anywhere outside closes it. On click, the list is gone before the
 *   click lands and tapping a result does nothing at all — on a phone, which
 *   is where this is used.
 *
 * Driven through the keyboard and the pointer rather than by calling handlers,
 * since the wiring between them is the part being asserted.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchBar } from './SearchBar';
import { buildEventSearchIndex } from '../data/search';
import { filterChoices } from '../data/filters';

afterEach(cleanup);

/** Saturday lunchtime in Indianapolis, when the trucks are open. */
const NOW = Date.parse('2026-08-01T12:30:00-04:00');

/** Rooms are searchable with no event feed at all, which is what a clone has. */
const EVENTS = buildEventSearchIndex(null);

function setup(from: { roomId?: string | null } | null = null, nowMs = NOW) {
  const onPick = vi.fn();
  render(
    <SearchBar
      events={EVENTS}
      from={from}
      choices={filterChoices([])}
      feedDays={[]}
      nowMs={nowMs}
      offsetMinutes={-240}
      onPick={onPick}
    />,
  );
  // By name: the filter bar's sort control is a <select>, which is also a
  // combobox, so the bare role now matches two things.
  const input = screen.getByRole('combobox', { name: /search rooms and events/i }) as HTMLInputElement;
  return {
    onPick,
    input,
    type: (text: string) => fireEvent.change(input, { target: { value: text } }),
    // What was handed over. `onPick` takes the whole hit now rather than a
    // room, because a hit can be a street address with no room in it — see
    // `hitPlace`. Every assertion below is still about the room, so unwrap it
    // here rather than in nine places.
    picked: (call = 0) => onPick.mock.calls[call][0].room,
  };
}

/*
 * Only the results list's options.
 *
 * The filter bar's sort control is a <select>, and its <option>s carry the
 * option role too — so the bare query matches five things that are not results.
 */
const results = () => document.getElementById('search-results');
const options = () => {
  const list = results();
  return list ? within(list).queryAllByRole('option') : [];
};
const highlighted = () => options().find((option) => option.getAttribute('aria-selected') === 'true');

describe('when the list is on screen', () => {
  it('stays away until there are two characters to go on', () => {
    // One character matches most of the campus. A list assembled from that
    // arrives before anybody has finished typing and hides the map behind it.
    const { type, input } = setup();
    type('h');
    expect(options()).toHaveLength(0);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    type('ha');
    expect(options().length).toBeGreaterThan(0);
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('says so when nothing matches, rather than showing an empty box', () => {
    const { type } = setup();
    type('zzzzzz');
    expect(options()).toHaveLength(0);
    expect(screen.getByText(/nothing matches/i)).toBeTruthy();
  });

  it('goes away when the pointer goes down anywhere else', () => {
    // The map is underneath. A list that stays up over it after you have
    // moved on is a list you have to dismiss before you can use the map.
    const { type } = setup();
    type('hall b');
    expect(options().length).toBeGreaterThan(0);
    fireEvent.pointerDown(document.body);
    expect(options()).toHaveLength(0);
  });

  it('goes away on Escape, and comes back on focus', () => {
    const { type, input } = setup();
    type('hall b');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(options()).toHaveLength(0);
    fireEvent.focus(input);
    expect(options().length).toBeGreaterThan(0);
  });
});

describe('the top-level kind', () => {
  const kindButton = (label: string) =>
    within(screen.getByRole('group', { name: /what to search for/i })).getByRole('button', {
      name: label,
    });

  it('opens the list on a kind alone, with nothing typed', () => {
    // The bug this exists for: `search` answers "Food" with 43 vendors and the
    // box refused to show them, because the box was gating on the filter count
    // and the kind deliberately is not counted. Choosing a kind *is* the
    // question — 43 vendors is a list you browse, not one you type at.
    const { input } = setup();
    fireEvent.focus(input);
    expect(options()).toHaveLength(0);
    fireEvent.click(kindButton('Food'));
    expect(options().length).toBeGreaterThan(0);
    expect(results()!.textContent).toContain('Arepas');
  });

  it('gives each kind the filters that can be true of it', () => {
    // The bug: Vendors and Places were shown the *event* panel, so a booth was
    // offered a day and a ticket price — dimensions that could only ever be
    // false of it, which emptied the list rather than narrowing it.
    const { input } = setup();
    fireEvent.focus(input);
    const panel = () => document.querySelector('.filters__panel')!;
    const legends = () => [...panel().querySelectorAll('legend')].map((one) => one.textContent);

    fireEvent.click(kindButton('Vendors'));
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(legends()).toEqual(['Sort of stand', 'Where', 'Tags']);

    fireEvent.click(kindButton('Places'));
    expect(legends()).toEqual(['Right now', 'Building', 'Floor']);

    fireEvent.click(kindButton('Events'));
    expect(legends()).toContain('Day');
    expect(legends()).toContain('Cost');
  });

  it('narrows rather than empties, once those filters are the right ones', () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.click(kindButton('Vendors'));
    const before = options().length;
    expect(before).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Sort of stand' })).getByRole('button', {
        name: /^Artists/,
      }),
    );
    expect(options().length).toBeGreaterThan(0);
    expect(results()!.textContent).not.toContain('Nothing matches');
  });

  it('offers nearest-first only once something says where you are', () => {
    // An order by distance from nowhere would be a made-up order, so the option
    // is absent rather than present and inert.
    setup();
    fireEvent.focus(screen.getByRole('combobox', { name: /search rooms and events/i }));
    fireEvent.click(kindButton('Food'));
    expect(screen.queryByRole('option', { name: /nearest first/i })).toBeNull();

    cleanup();
    setup({ roomId: 'block-party-street' });
    fireEvent.focus(screen.getByRole('combobox', { name: /search rooms and events/i }));
    fireEvent.click(kindButton('Food'));
    expect(screen.getByRole('option', { name: /nearest first/i })).toBeTruthy();
  });

  it('orders by distance, and says how far each one is', () => {
    const { input } = setup({ roomId: 'block-party-street' });
    fireEvent.focus(input);
    fireEvent.click(kindButton('Food'));
    fireEvent.change(screen.getByRole('combobox', { name: /^sort$/i }), { target: { value: 'near' } });

    // "you are here" is nought minutes: from the Block Party, the trucks on it
    // are in the room you are standing in.
    const minutes = options().map((option) => {
      const text = within(option).queryByText(/^(\d+ min|you are here)$/)?.textContent ?? '';
      return text === 'you are here' ? 0 : Number(/^(\d+) min$/.exec(text)?.[1]);
    });
    expect(minutes.length).toBeGreaterThan(3);
    expect(minutes.every(Number.isFinite)).toBe(true);
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
  });

  it('says why the list is empty when the reason is the clock', () => {
    // Half past three on a Tuesday morning: everywhere downtown is shut and the
    // trucks do not run at all. That is a true answer, and an empty box under a
    // pressed chip reads as a broken filter — so it says which clock it read.
    const { input } = setup(null, Date.parse('2026-08-11T03:30:00-04:00'));
    fireEvent.focus(input);
    fireEvent.click(kindButton('Food'));
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Right now' })).getByRole('button', {
        name: /^Open now/,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(options()).toHaveLength(0);
    expect(screen.getByText(/nothing here is open at .* in indianapolis/i)).toBeTruthy();
  });

  it('narrows rather than empties when things really are open', () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.click(kindButton('Food'));
    const before = options().length;
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Right now' })).getByRole('button', {
        name: /^Open now/,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(options().length).toBeGreaterThan(0);
    expect(options().length).toBeLessThanOrEqual(before);
  });

  it('puts the list away again when the kind goes back to everything', () => {
    // The other half: "Everything" with nothing typed is not a question, and
    // answering it would be the whole campus under the search box.
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.click(kindButton('Food'));
    expect(options().length).toBeGreaterThan(0);
    fireEvent.click(kindButton('Everything'));
    expect(options()).toHaveLength(0);
  });
});

describe('the keyboard', () => {
  it('starts on the first result', () => {
    const { type } = setup();
    type('hall');
    expect(highlighted()).toBe(options()[0]);
  });

  it('moves the highlight down and up', () => {
    const { type, input } = setup();
    type('hall');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(highlighted()).toBe(options()[1]);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(highlighted()).toBe(options()[0]);
  });

  it('wraps at both ends rather than sticking', () => {
    // Eight results and a thumb on the down arrow. Sticking at the bottom is
    // a dead key; wrapping is the whole reason to hold it.
    const { type, input } = setup();
    type('hall');
    const count = options().length;
    expect(count).toBeGreaterThan(1);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(highlighted()).toBe(options()[count - 1]);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(highlighted()).toBe(options()[0]);
  });

  it('picks the one the arrows left highlighted, not the first', () => {
    // The bug this is really for: a highlight that moves on screen while Enter
    // still reads the top of the list takes you somewhere you did not choose,
    // and looks like a working search doing something inexplicable.
    const { type, input, onPick, picked } = setup();
    type('hall');
    const second = options()[1].textContent;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(second).toContain(picked().name);
  });

  it('starts again from the top when the query changes under it', () => {
    // Not cosmetic. Arrow down to the sixth of eight results, then type another
    // letter and the list is two long — the highlight is off the end of it, and
    // Enter reads `hits[5]` of a two-item array. That is `undefined`, and what
    // happens next is a crash in the picking rather than a wrong room.
    const { type, input, picked } = setup();
    type('hall');
    expect(options().length).toBeGreaterThan(2);
    for (let n = 0; n < 5; n += 1) fireEvent.keyDown(input, { key: 'ArrowDown' });
    type('hall b');
    expect(options().length).toBeLessThan(5);
    expect(highlighted()).toBe(options()[0]);
    expect(() => fireEvent.keyDown(input, { key: 'Enter' })).not.toThrow();
    expect(picked().id).toBe('hall-b');
  });

  it('does nothing on Enter with nothing to pick', () => {
    const { type, input, onPick } = setup();
    type('zzzzzz');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('follows the mouse, so Enter picks what is under it', () => {
    const { type, input, picked } = setup();
    type('hall');
    fireEvent.mouseEnter(options()[2]);
    expect(highlighted()).toBe(options()[2]);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(picked().name).toBeTruthy();
  });
});

describe('picking one', () => {
  it('commits on pointer-down, because the click never arrives', () => {
    // A pointer down outside the box closes the list, and the result is inside
    // it — so on `click` the list would already be gone by the time the click
    // landed and tapping a result would do nothing. On a phone, which is where
    // this is used.
    const { type, onPick, picked } = setup();
    type('hall b');
    fireEvent.pointerDown(options()[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(picked().id).toBe('hall-b');
  });

  it('clears itself and gets out of the way', () => {
    // The map is about to move to the room that was picked, and it is behind
    // this. A box still holding the query is a box still showing the list.
    const { type, input } = setup();
    type('hall b');
    fireEvent.pointerDown(options()[0]);
    expect(input.value).toBe('');
    expect(options()).toHaveLength(0);
  });

  it('hands over the room even when an event was what matched', () => {
    // An event is not a place. The hit is really a hit on where it happens,
    // and the room is the only thing the map can be taken to.
    const feed = buildEventSearchIndex({
      byPin: new Map(),
      byRoom: new Map([
        [
          'hall-b',
          [
            {
              id: 'x',
              title: 'Catan Championship',
              locationText: 'ICC',
              start: '2026-07-30T10:00:00-04:00',
            },
          ],
        ],
      ]),
    } as never);
    const onPick = vi.fn();
    render(
      <SearchBar
        events={feed}
        choices={filterChoices([])}
        feedDays={[]}
        nowMs={NOW}
        offsetMinutes={-240}
        onPick={onPick}
      />,
    );
    const input = screen.getByRole('combobox', { name: /search rooms and events/i });
    fireEvent.change(input, { target: { value: 'catan' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick.mock.calls[0][0].room.id).toBe('hall-b');
  });
});

/*
 * How far away a result says it is, read off its own element.
 *
 * Never off the row's whole text: that ends "… Level 1" and then "2 min",
 * which concatenates to "12 min" — a trap that let an earlier version of these
 * assertions pass while comparing numbers that did not exist.
 */
const away = (option: HTMLElement) =>
  within(option).queryByText(/^(\d+ min|you are here)$/)?.textContent ?? '';

describe('how far away each result is', () => {
  it('says nothing when nothing says where you are', () => {
    // The header search has no starting point until a route is being planned
    // or a room is open, and a time measured from nowhere would be a made-up
    // number beside a real one.
    const { type } = setup();
    type('hall');
    expect(screen.queryByText(/min$/)).toBeNull();
  });

  it('puts a time against each one once there is somewhere to measure from', () => {
    const { type } = setup({ roomId: 'westin-grand-ballroom' });
    type('hall');
    expect(options().length).toBeGreaterThan(0);
    for (const option of options()) expect(away(option)).toMatch(/^\d+ min$/);
  });

  it('says you are already there rather than putting a minute on it', () => {
    const { type } = setup({ roomId: 'hall-a' });
    type('exhibit hall a');
    expect(away(options()[0])).toBe('you are here');
  });

  it('gives each result its own answer rather than one number for the list', () => {
    // The one that proves it is measuring rather than printing a constant.
    // From Hall A, Hall B is next door and Hall G is the far corner of the
    // floor, reached round the outside of Hall H.
    const { type } = setup({ roomId: 'hall-a' });
    type('exhibit hall');
    const minutes = (name: string) =>
      Number(
        /^(\d+) min$/.exec(
          away(options().find((option) => option.textContent?.startsWith(name))!),
        )?.[1],
      );
    expect(minutes('Exhibit Hall B')).toBeLessThan(minutes('Exhibit Hall G'));
  });
});
