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

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchBar } from './SearchBar';
import { buildEventSearchIndex } from '../data/search';

afterEach(cleanup);

/** Rooms are searchable with no event feed at all, which is what a clone has. */
const EVENTS = buildEventSearchIndex(null);

function setup() {
  const onPick = vi.fn();
  render(<SearchBar events={EVENTS} onPick={onPick} />);
  const input = screen.getByRole('combobox') as HTMLInputElement;
  return { onPick, input, type: (text: string) => fireEvent.change(input, { target: { value: text } }) };
}

const options = () => screen.queryAllByRole('option');
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
    const { type, input, onPick } = setup();
    type('hall');
    const second = options()[1].textContent;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(second).toContain(onPick.mock.calls[0][0].name);
  });

  it('starts again from the top when the query changes under it', () => {
    // Not cosmetic. Arrow down to the sixth of eight results, then type another
    // letter and the list is two long — the highlight is off the end of it, and
    // Enter reads `hits[5]` of a two-item array. That is `undefined`, and what
    // happens next is a crash in the picking rather than a wrong room.
    const { type, input, onPick } = setup();
    type('hall');
    expect(options().length).toBeGreaterThan(2);
    for (let n = 0; n < 5; n += 1) fireEvent.keyDown(input, { key: 'ArrowDown' });
    type('hall b');
    expect(options().length).toBeLessThan(5);
    expect(highlighted()).toBe(options()[0]);
    expect(() => fireEvent.keyDown(input, { key: 'Enter' })).not.toThrow();
    expect(onPick.mock.calls[0][0].id).toBe('hall-b');
  });

  it('does nothing on Enter with nothing to pick', () => {
    const { type, input, onPick } = setup();
    type('zzzzzz');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('follows the mouse, so Enter picks what is under it', () => {
    const { type, input, onPick } = setup();
    type('hall');
    fireEvent.mouseEnter(options()[2]);
    expect(highlighted()).toBe(options()[2]);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick.mock.calls[0][0].name).toBeTruthy();
  });
});

describe('picking one', () => {
  it('commits on pointer-down, because the click never arrives', () => {
    // A pointer down outside the box closes the list, and the result is inside
    // it — so on `click` the list would already be gone by the time the click
    // landed and tapping a result would do nothing. On a phone, which is where
    // this is used.
    const { type, onPick } = setup();
    type('hall b');
    fireEvent.pointerDown(options()[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].id).toBe('hall-b');
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
    render(<SearchBar events={feed} onPick={onPick} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'catan' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick.mock.calls[0][0].id).toBe('hall-b');
  });
});
