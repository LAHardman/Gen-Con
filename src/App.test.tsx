/**
 * The app itself: the state the components hand back and forth.
 *
 * Every piece here is tested on its own — the search box, the map, the
 * directions panel, the router. What is not tested anywhere else is what the
 * app *does* with what they report, and that is where the awkward decisions
 * live: which building is open, which floor of it, and what happens to the
 * selected room when one of those changes underneath it.
 *
 * These drive it the way somebody does, through the search box and the map,
 * and assert on what is drawn. The feed is stubbed absent, which is a real
 * state — the app is a map before anybody has run `npm run fetch:events` — and
 * keeps these about the map rather than about 27,000 events.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';

beforeEach(() => {
  // The feed is absent: 404 is the documented "no schedule yet" answer.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 404 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const openRooms = () =>
  [...document.querySelectorAll('path.map__room')].filter(
    (room) => !room.classList.contains('map__room--closed'),
  );

/** The floor buttons, which only appear once a building is open. */
const floors = () => {
  const picker = document.querySelector('.floors');
  return picker ? [...picker.querySelectorAll('button')] : [];
};
const currentFloor = () =>
  floors().find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent;

function searchFor(text: string) {
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: text } });
  return screen.getAllByRole('option');
}

describe('starting up', () => {
  it('is a map before there is any schedule at all', () => {
    // A missing feed is a normal state rather than an error, and the app has to
    // be worth opening in it: this is what a fresh clone runs.
    render(<App />);
    expect(document.querySelectorAll('path.map__venue')).toHaveLength(14);
    expect(openRooms()).toHaveLength(0);
    expect(floors()).toHaveLength(0);
  });
});

describe('going to a room', () => {
  it('opens its building on its floor, not on the ground floor', () => {
    // The room is on the 3rd and drawing it over the 1st would put it in the
    // wrong building's worth of walls — a room shown somewhere it is not.
    render(<App />);
    const [hit] = searchFor('griffin hall');
    fireEvent.pointerDown(hit);
    expect(currentFloor()).toBe('2nd floor');
    expect(screen.getByRole('dialog').textContent).toContain('Griffin Hall');
  });

  it('drops the selection when the floor moves out from under it', () => {
    // Changing floor under a selected room leaves it a storey away and no
    // longer drawn. Keeping it selected means a highlight on a room that is
    // not on screen.
    render(<App />);
    fireEvent.pointerDown(searchFor('griffin hall')[0]);
    // Two of them: the ✕ in the header and the one in the row at the bottom.
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[0]);
    const selected = () => document.querySelectorAll('.map__room--selected').length;
    expect(selected()).toBe(1);
    const other = floors().find((button) => button.textContent !== '2nd floor')!;
    fireEvent.click(other);
    expect(selected()).toBe(0);
  });
});

describe('asking for directions', () => {
  /** Open a room's dialog and press its directions button. */
  function directionsTo(room: string) {
    fireEvent.pointerDown(searchFor(room)[0]);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /directions/i }));
  }

  it('opens with the room you were reading as the destination', () => {
    // The question left to answer is where you are starting from, so that is
    // the end the panel opens on.
    render(<App />);
    directionsTo('sagamore ballroom');
    const panel = document.querySelector('.nav') as HTMLElement;
    // Which end holds it, not merely that the panel mentions it: opening with
    // the room as the *origin* leaves the same words on screen and asks the
    // wrong question.
    const ends = [...panel.querySelectorAll('.nav__row')].map((row) => row.textContent ?? '');
    expect(ends[0]).toMatch(/^From/);
    expect(ends[0]).not.toContain('Sagamore Ballroom');
    expect(ends[1]).toMatch(/^To/);
    expect(ends[1]).toContain('Sagamore Ballroom');
  });

  it('draws the floor you are going to when both ends are in one building', () => {
    // The decision worth pinning. Two rooms in one building on different
    // floors: the map can only draw one of them, and showing the origin means
    // the destination — the thing you asked how to reach — is the one not on
    // screen. Nothing about that looks broken.
    render(<App />);
    directionsTo('griffin hall'); // JW, 2nd floor — the destination
    const panel = document.querySelector('.nav')!;
    const from = within(panel as HTMLElement).getByLabelText(/starting point/i);
    fireEvent.change(from, { target: { value: 'white river ballroom a' } });
    fireEvent.click(within(panel as HTMLElement).getAllByRole('option')[0]);

    // Both ends really are set, and in one building on two floors — otherwise
    // there is no choice to make and this asserts nothing.
    const ends = [...panel.querySelectorAll('.nav__row')].map((row) => row.textContent ?? '');
    expect(ends[0]).toContain('White River Ballroom A–D');
    expect(ends[0]).toContain('1st floor');
    expect(ends[1]).toContain('Griffin Hall');
    expect(ends[1]).toContain('2nd floor');

    // White River is on the 1st; Griffin Hall on the 2nd. The 2nd is drawn.
    expect(currentFloor()).toBe('2nd floor');
  });
});
