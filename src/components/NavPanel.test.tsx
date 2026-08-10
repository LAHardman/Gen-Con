/**
 * The directions panel: choosing the two ends, and what it is willing to say
 * about the line between them.
 *
 * The panel holds no state but the search box — the two ends, which one is
 * being chosen, and whether the map is picking all live in the app — so these
 * tests drive it the way the app does, by rendering it with the props that
 * state produces and asserting on what comes back out of the callbacks.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NavPanel } from './NavPanel';
import { buildEventSearchIndex } from '../data/search';
import { routeBetween, type NavPlace } from '../data/navigation';
import type { DeviceLocation } from '../hooks/useDeviceLocation';

afterEach(cleanup);

const HALL_B: NavPlace = { kind: 'room', roomId: 'hall-b' };
const SAGAMORE: NavPlace = { kind: 'room', roomId: 'sagamore-ballroom' };
const DEVICE: NavPlace = { kind: 'device' };

/* Rooms are searchable with no event feed at all, which is what a fresh clone has. */
const EVENTS = buildEventSearchIndex(null);

const READY: DeviceLocation = {
  status: 'ready',
  fix: { position: { lat: 39.7662, lng: -86.1652 }, accuracy: 30 },
};

function setup(props: Partial<Parameters<typeof NavPanel>[0]> = {}) {
  const handlers = {
    onEdit: vi.fn(),
    onSet: vi.fn(),
    onPickOnMap: vi.fn(),
    onSwap: vi.fn(),
    onClose: vi.fn(),
  };
  const all = {
    from: null,
    to: HALL_B,
    editing: null,
    pickingOnMap: false,
    covered: false,
    device: { status: 'idle', fix: null } as DeviceLocation,
    route: null,
    events: EVENTS,
    ...handlers,
    ...props,
  };
  const view = render(<NavPanel {...all} />);
  return { ...handlers, view, rerender: (next: Partial<typeof all>) =>
    view.rerender(<NavPanel {...all} {...next} />) };
}

const row = (end: 'From' | 'To') =>
  screen.getByRole('button', { expanded: false, name: new RegExp(`^${end}`) });

describe('the two ends', () => {
  it('names the destination with its building and floor, and asks for a start', () => {
    setup();
    expect(screen.getByText('Exhibit Hall B')).toBeTruthy();
    expect(screen.getByText('Convention Center · Level 1')).toBeTruthy();
    expect(screen.getByText('Choose a starting point')).toBeTruthy();
  });

  it('opens an end for editing when its row is clicked', () => {
    const { onEdit } = setup();
    fireEvent.click(row('To'));
    expect(onEdit).toHaveBeenCalledWith('to');
  });

  it('closes the end that is already open, rather than reopening it', () => {
    const { onEdit } = setup({ editing: 'from' });
    fireEvent.click(screen.getByRole('button', { expanded: true }));
    expect(onEdit).toHaveBeenCalledWith(null);
  });

  it('swaps the ends, which is what makes this navigation between two places', () => {
    const { onSwap } = setup({ from: SAGAMORE });
    fireEvent.click(screen.getByRole('button', { name: /swap/i }));
    expect(onSwap).toHaveBeenCalled();
  });

  it('has nothing to swap when neither end is set', () => {
    setup({ from: null, to: null });
    expect(screen.getByRole('button', { name: /swap/i }).hasAttribute('disabled')).toBe(true);
  });
});

describe('choosing a place', () => {
  it('offers all three ways of answering', () => {
    setup({ editing: 'from' });
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pick on the map' })).toBeTruthy();
    expect(screen.getByLabelText('Choose a starting point')).toBeTruthy();
  });

  it('takes the device as an end', () => {
    const { onSet } = setup({ editing: 'from' });
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(onSet).toHaveBeenCalledWith('from', { kind: 'device' });
  });

  it('finds a room by name and takes it as an end', () => {
    const { onSet } = setup({ editing: 'from' });
    fireEvent.change(screen.getByLabelText('Choose a starting point'), {
      target: { value: 'sagamore' },
    });

    const results = screen.getByRole('listbox');
    expect(within(results).getByText('Sagamore Ballroom')).toBeTruthy();
    fireEvent.click(within(results).getByRole('option', { name: /Sagamore Ballroom/ }));
    expect(onSet).toHaveBeenCalledWith('from', { kind: 'room', roomId: 'sagamore-ballroom' });
  });

  it('takes the first result on Enter', () => {
    const { onSet } = setup({ editing: 'to' });
    const box = screen.getByLabelText('Choose a destination');
    fireEvent.change(box, { target: { value: 'sagamore' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSet).toHaveBeenCalledWith('to', { kind: 'room', roomId: 'sagamore-ballroom' });
  });

  it('says so rather than silently offering nothing', () => {
    setup({ editing: 'from' });
    fireEvent.change(screen.getByLabelText('Choose a starting point'), {
      target: { value: 'zzzznowhere' },
    });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });

  it('hands the choosing to the map, and says what to do with it', () => {
    const { onPickOnMap } = setup({ editing: 'from' });
    fireEvent.click(screen.getByRole('button', { name: 'Pick on the map' }));
    expect(onPickOnMap).toHaveBeenCalledWith(true);
  });

  it('puts the search away while the map is the one being asked', () => {
    setup({ editing: 'from', pickingOnMap: true });
    expect(screen.queryByLabelText('Choose a starting point')).toBeNull();
    expect(screen.getByText(/Tap a building to look inside it/)).toBeTruthy();
  });
});

describe('when the device has not answered', () => {
  it('explains itself after the chooser has closed', () => {
    // The regression this exists for: the note used to live inside the chooser,
    // and choosing "use my location" closes the chooser — so the one person who
    // needed the explanation was the one person who never saw it.
    setup({ from: DEVICE, editing: null, device: { status: 'denied', fix: null } });
    expect(screen.getByText(/Location is blocked for this site/)).toBeTruthy();
  });

  it('says it is still looking, so a blank panel does not read as broken', () => {
    setup({ from: DEVICE, editing: null, device: { status: 'locating', fix: null } });
    expect(screen.getByText('Finding your location…')).toBeTruthy();
  });

  it('says nothing about a device no end is using', () => {
    setup({ from: SAGAMORE, editing: null, device: { status: 'denied', fix: null } });
    expect(screen.queryByText(/Location is blocked/)).toBeNull();
  });

  it('stops explaining once a fix arrives', () => {
    setup({ from: DEVICE, editing: null, device: READY });
    expect(screen.queryByText(/Finding your location/)).toBeNull();
    expect(screen.getByText('Accurate to about 30 m')).toBeTruthy();
  });
});

describe('what it says about the line', () => {
  const routeOf = (from: NavPlace, to: NavPlace, device = READY.fix) =>
    routeBetween(from, to, device)!;

  it('gives the distance to walk, and the steps of the walk', () => {
    const route = routeOf(SAGAMORE, HALL_B);
    setup({ from: SAGAMORE, to: HALL_B, route });
    expect(route.walk).not.toBeNull();
    expect(screen.getByText(/to walk/)).toBeTruthy();
    // One step per leg, in the order they are walked.
    expect(screen.getAllByRole('listitem')).toHaveLength(route.walk!.legs.length);
  });

  it('says the route follows drawn floors', () => {
    setup({ from: SAGAMORE, to: HALL_B, route: routeOf(SAGAMORE, HALL_B) });
    expect(screen.getByText(/floors the plans draw/)).toBeTruthy();
  });

  it('claims a staircase only where a plan drew one', () => {
    // The distinction that matters, and the reason a link carries its
    // certainty at all. A stair Gen Con drew is a stair the route can send you
    // up. One merely implied by two floors overlapping is a stretch it must be
    // on, and "take the stairs" of that would be inventing a staircase.
    const route = routeOf(SAGAMORE, HALL_B);
    const stairs = route.walk!.legs.filter((leg) => leg.kind === 'stairs');
    expect(stairs.length).toBeGreaterThan(0);
    for (const leg of stairs) {
      const drawn = /^Up the stairs to /.test(leg.text);
      const implied = /off this stretch/.test(leg.text);
      expect(drawn || implied, leg.text).toBe(true);
    }
  });

  it('marks an outdoor leg as the straight line it is', () => {
    // Lucas Oil's plazas are drawn as nothing walkable, so the last leg to it
    // is unmapped ground and has to look like one.
    const far: NavPlace = { kind: 'room', roomId: 'lucas-oil-field' };
    const route = routeBetween(SAGAMORE, far, READY.fix);
    setup({ from: SAGAMORE, to: far, route });
    if (route?.walk) {
      expect(route.walk.indoors).toBe(false);
      expect(screen.getByText(/nothing maps/)).toBeTruthy();
    } else {
      // No route at all: the summary falls back to the bearing and the note
      // says the data has no floor for it to follow.
      expect(screen.getByText(/nothing here has floor drawn/)).toBeTruthy();
    }
  });

  it('drops the walking time from beyond the campus, and says why', () => {
    const far: DeviceLocation = { status: 'ready', fix: { position: { lat: 40.5, lng: -83.0 }, accuracy: 40 } };
    setup({ from: DEVICE, to: HALL_B, device: far, route: routeOf(DEVICE, HALL_B, far.fix) });
    expect(screen.getByText(/Too far to walk/)).toBeTruthy();
    expect(screen.queryByText(/min\b/)).toBeNull();
  });

  it('names the floor it changes to, on the step that changes it', () => {
    const route = routeOf(SAGAMORE, HALL_B);
    setup({ from: SAGAMORE, to: HALL_B, route });
    const stairs = route.walk!.legs.filter((leg) => leg.kind === 'stairs');
    expect(stairs.length).toBeGreaterThan(0);
    for (const leg of stairs) expect(leg.text).toContain('Level 1');
  });

  it('draws no route, and no disclaimer, when you are already there', () => {
    setup({ from: HALL_B, to: HALL_B, route: routeOf(HALL_B, HALL_B) });
    expect(screen.getByText('You are already there.')).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.queryByText(/floors the plans draw/)).toBeNull();
  });

  it('keeps the summary out of the way while an end is being chosen', () => {
    setup({ from: SAGAMORE, to: HALL_B, editing: 'from', route: routeOf(SAGAMORE, HALL_B) });
    expect(screen.queryByText(/to walk/)).toBeNull();
  });
});

describe('escape', () => {
  it('backs out of picking on the map first, keeping the route', () => {
    const { onPickOnMap, onEdit, onClose } = setup({ editing: 'from', pickingOnMap: true });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onPickOnMap).toHaveBeenCalledWith(false);
    expect(onEdit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('then closes the chooser', () => {
    const { onEdit, onClose } = setup({ editing: 'from' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onEdit).toHaveBeenCalledWith(null);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('and only then closes the directions', () => {
    const { onClose } = setup({ from: SAGAMORE });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('leaves the key to whatever is open on top of it', () => {
    // A room's dialog closes on Escape too; both acting would close two things.
    const { onClose } = setup({ from: SAGAMORE, covered: true });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('while somebody is walking it', () => {
  // The route is held steady and the numbers count down. A figure that stays at
  // "320 m" until you arrive is the app not watching, and it is exactly what
  // this looked like before `useFollowedRoute` existed.
  const walk = {
    legs: [{ kind: 'walk' as const, points: [], metres: 320, text: 'along' }],
    metres: 320,
    minutes: 5,
    indoors: true,
    viaStairs: false,
  };
  const route = {
    from: null, to: null, fromAt: { lat: 0, lng: 0 }, toAt: { lat: 0, lng: 0 },
    metres: 320, straightMetres: 320, walk, minutes: 5,
    floorChange: null, venueChange: null, arrived: false,
  } as never;

  it('shows what is left, not what it started as', () => {
    setup({
      route,
      progress: { offMetres: 3, alongMetres: 250, remainingMetres: 70, onRoute: true },
    });
    expect(screen.getByText(/left/)).toBeTruthy();
    expect(screen.getByText('70 m')).toBeTruthy();
    // 70 m at 70 m/min.
    expect(screen.getByText('1 min')).toBeTruthy();
  });

  it('shows the whole route again when the fix has wandered off it', () => {
    // Counting down from a position somebody is not at would be worse than not
    // counting down at all.
    setup({
      route,
      progress: { offMetres: 140, alongMetres: 250, remainingMetres: 70, onRoute: false },
    });
    expect(screen.getByText(/to walk/)).toBeTruthy();
    expect(screen.getAllByText('320 m').length).toBeGreaterThan(0);
    expect(screen.getByText('5 min')).toBeTruthy();
  });

  it('shows the whole route when there is no position at all', () => {
    setup({ route, progress: null });
    expect(screen.getAllByText('320 m').length).toBeGreaterThan(0);
    expect(screen.getByText(/to walk/)).toBeTruthy();
  });
});

describe('how far away each candidate is', () => {
  const typeInto = (label: string, text: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
  const option = (name: RegExp) =>
    within(screen.getByRole('listbox')).getByRole('option', { name });
  /* Read off its own element. A row's whole text ends "… Level 1" then "2 min",
     which concatenates to "12 min" — a trap that let an earlier version of
     these assertions pass while comparing nonsense. */
  const away = (name: RegExp) =>
    within(option(name)).queryByText(/^(\d+ min|you are here)$/)?.textContent ?? '';
  const minutes = (name: RegExp) => Number(/^(\d+) min$/.exec(away(name))?.[1]);

  it('measures a destination from the start that is already chosen', () => {
    setup({ from: HALL_B, to: null, editing: 'to' });
    typeInto('Choose a destination', 'exhibit hall');
    // Hall A is next door to Hall B; the Sagamore is upstairs and along.
    expect(minutes(/Exhibit Hall A/)).toBeLessThan(6);
    cleanup();
    setup({ from: HALL_B, to: null, editing: 'to' });
    typeInto('Choose a destination', 'sagamore');
    expect(minutes(/Sagamore Ballroom/)).toBeGreaterThan(1);
  });

  it('measures a start from the destination, not from the start being replaced', () => {
    // The end being edited is the one about to be thrown away, so measuring
    // from it would answer a question nobody asked — and would answer it
    // differently depending on what was there before.
    setup({ from: SAGAMORE, to: HALL_B, editing: 'from' });
    typeInto('Choose a starting point', 'exhibit hall a');
    const fromHallB = minutes(/Exhibit Hall A/);
    cleanup();
    setup({ from: SAGAMORE, to: { kind: 'room', roomId: 'westin-grand-ballroom' }, editing: 'from' });
    typeInto('Choose a starting point', 'exhibit hall a');
    expect(minutes(/Exhibit Hall A/)).toBeGreaterThan(fromHallB);
  });

  it('says nothing while the other end is still unchosen', () => {
    setup({ from: null, to: null, editing: 'to' });
    typeInto('Choose a destination', 'sagamore');
    expect(away(/Sagamore Ballroom/)).toBe('');
  });

  it('says nothing while "my location" has had no fix', () => {
    // The end is chosen but the browser has not answered yet, and a time
    // measured from a position nobody has is a made-up number.
    setup({ from: DEVICE, to: null, editing: 'to', device: { status: 'locating', fix: null } });
    typeInto('Choose a destination', 'sagamore');
    expect(away(/Sagamore Ballroom/)).toBe('');
  });

  it('measures from where the device says it is once it has said', () => {
    setup({ from: DEVICE, to: null, editing: 'to', device: READY });
    typeInto('Choose a destination', 'sagamore');
    expect(minutes(/Sagamore Ballroom/)).toBeGreaterThan(0);
  });
});
