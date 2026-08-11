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

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  // By name: the filter bar's sort control is a <select>, which is also a
  // combobox, so the bare role now matches two things.
  const input = screen.getByRole('combobox', { name: /search rooms and events/i });
  fireEvent.change(input, { target: { value: text } });
  // Scoped to the results list: the filter bar's sort control is a <select>,
  // and its <option>s carry the option role too.
  return within(screen.getByRole('listbox')).getAllByRole('option');
}

describe('starting up', () => {
  it('is a map before there is any schedule at all', () => {
    // A missing feed is a normal state rather than an error, and the app has to
    // be worth opening in it: this is what a fresh clone runs.
    render(<App />);
    expect(document.querySelectorAll('path.map__venue')).toHaveLength(16);
    expect(openRooms()).toHaveLength(0);
    expect(floors()).toHaveLength(0);
  });
});

describe('finding the other pages', () => {
  const menu = () => screen.getByRole('button', { name: /^Menu —/ });

  it('says which page you are on outside the button that switches them', () => {
    // The menu button is the icon and nothing else, so if the name is not
    // printed in the header there is nowhere left that says where you are.
    render(<App />);
    expect(document.querySelector('.app__page')!.textContent).toBe('Map');
    expect(menu().textContent).toBe('');
  });

  it('moves the name along with the page', () => {
    render(<App />);
    fireEvent.click(menu());
    fireEvent.click(screen.getByRole('menuitem', { name: /Key dates/ }));
    expect(document.querySelector('.app__page')!.textContent).toBe('Key dates');
    expect(screen.getByRole('region', { name: 'Key dates' })).toBeTruthy();
    // And the button follows it, for anybody who cannot see the header.
    expect(menu().getAttribute('aria-label')).toBe('Menu — Key dates');
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

describe('how far away the search results are', () => {
  const away = (option: HTMLElement) =>
    within(option).queryByText(/^(\d+ min|you are here)$/)?.textContent ?? '';

  /**
   * A browser that has already been given permission, and a position to report.
   *
   * Both halves matter: the point of the permission query is that a *standing*
   * grant lets a position be used without one being asked for, so a stub that
   * only reported a position would prove nothing about the part that matters.
   */
  function alreadyAllowed(at: { lat: number; lng: number } | null) {
    const geolocation = {
      watchPosition: vi.fn((onSuccess: PositionCallback) => {
        if (at) {
          setTimeout(() =>
            onSuccess({
              coords: { latitude: at.lat, longitude: at.lng, accuracy: 25 },
              timestamp: 0,
            } as GeolocationPosition),
          );
        }
        return 1;
      }),
      clearWatch: vi.fn(),
    };
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation,
      permissions: { query: async () => ({ state: 'granted', addEventListener() {}, removeEventListener() {} }) },
    });
    vi.stubGlobal('isSecureContext', true);
    return geolocation;
  }

  /*
   * Two ticks, not one. The permission query is a promise; granting sets state,
   * which starts the watch; the watch reports on a timer of its own. One flush
   * lands between the two and the position never arrives.
   */
  /** Where `distances.ts` says that room is entered. Somewhere real to stand. */
  const WESTIN_GRAND_DOOR = { lat: 39.76603, lng: -86.16413 };

  const settle = async () => {
    for (let n = 0; n < 3; n += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
  };

  it('says nothing while nothing knows where you are', () => {
    render(<App />);
    for (const option of searchFor('ballroom')) expect(away(option)).toBe('');
  });

  it('measures from the room you have open', () => {
    render(<App />);
    fireEvent.pointerDown(searchFor('exhibit hall a')[0]);
    const [first] = searchFor('wabash ballroom');
    expect(away(first)).toMatch(/^\d+ min$/);
  });

  it('measures from where you are when no room is chosen', async () => {
    // Standing on the Westin Grand Ballroom's own doorway, having granted
    // location on some earlier visit. Nothing is selected and nothing prompted.
    alreadyAllowed(WESTIN_GRAND_DOOR);
    render(<App />);
    await settle();

    // The room being stood in reads as no walk; the Wabash is across Maryland
    // St and through the convention centre.
    const named = (query: string, name: string) =>
      away(searchFor(query).find((option) => option.textContent?.startsWith(name))!);
    expect(named('grand ballroom', 'Grand Ballroom I–V')).toBe('you are here');
    const fromWestin = Number(/^(\d+) min$/.exec(named('wabash', 'Wabash Ballroom'))?.[1]);
    expect(fromWestin).toBeGreaterThan(2);
  });

  it('prefers a room you have opened over where you happen to be standing', async () => {
    // Opening a room is somebody saying "this is what I am interested in";
    // standing somewhere is not.
    alreadyAllowed(WESTIN_GRAND_DOOR);
    render(<App />);
    await settle();
    const westin = () =>
      away(searchFor('grand ballroom').find((option) => option.textContent?.startsWith('Grand Ballroom I–V'))!);
    expect(westin()).toBe('you are here');

    fireEvent.pointerDown(searchFor('exhibit hall a')[0]);
    expect(westin()).toMatch(/^\d+ min$/);
  });

  it('asks for nothing when the permission was never given', async () => {
    // The rule this whole path lives under: a venue map may use a location it
    // has already been allowed, and may never raise the question itself.
    const geolocation = alreadyAllowed(null);
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation,
      permissions: { query: async () => ({ state: 'prompt', addEventListener() {}, removeEventListener() {} }) },
    });
    render(<App />);
    await settle();
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });
});
