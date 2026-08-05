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

  it('says the route follows drawn floors, and never claims a staircase', () => {
    const route = routeOf(SAGAMORE, HALL_B);
    setup({ from: SAGAMORE, to: HALL_B, route });
    expect(screen.getByText(/floors the plans draw/)).toBeTruthy();
    // The one thing no source here knows. The step may say which stretch the
    // stairs are on; it may not say "take the stairs" as though it knew.
    const stairs = route.walk!.legs.filter((leg) => leg.kind === 'stairs');
    for (const leg of stairs) expect(leg.text).toMatch(/somewhere|off this stretch/i);
  });

  it('marks an outdoor leg as the straight line it is', () => {
    // Between two buildings no skywalk joins there is no pavement in the data,
    // so that leg is a bearing and has to look like one.
    const far: NavPlace = { kind: 'room', roomId: 'lucas-oil-field' };
    const route = routeBetween(SAGAMORE, far, READY.fix);
    setup({ from: SAGAMORE, to: far, route });
    if (route?.walk) {
      expect(route.walk.indoors).toBe(false);
      expect(screen.getByText(/no pavements in the map data/)).toBeTruthy();
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
    expect(route.walk!.legs.some((leg) => leg.kind === 'stairs')).toBe(true);
    expect(screen.getByText(/Change to Level 1/)).toBeTruthy();
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
