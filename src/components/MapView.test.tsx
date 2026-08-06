/**
 * The map: what it draws, and what a tap on it means.
 *
 * This is the biggest file in the repository and it had no test, which was
 * uncomfortable for a specific reason rather than a general one. Everything it
 * does is imperative Leaflet inside effects, and Leaflet fails by drawing
 * *something*: a layer that is never added, a shape drawn on the wrong pane, a
 * click handler bound to the wrong thing — none of them throw, and the map
 * still looks like a map.
 *
 * So these assert on the DOM Leaflet actually produced. jsdom gives every
 * container zero size, which rules out anything about zoom or label crowding
 * (`roomFitsLabel` is the honest gap here), but every layer, class and handler
 * is real.
 *
 * The taps are the part worth having most. There are three meanings for a
 * click — open a building, open a room, answer the question the directions
 * panel is asking — and the third one silently changes the other two.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MapView } from './MapView';
import { routeBetween } from '../data/navigation';

afterEach(cleanup);

const HANDLERS = () => ({
  onSelectRoom: vi.fn(),
  onOpenRoom: vi.fn(),
  onOpenVenue: vi.fn(),
  onPickPlace: vi.fn(),
});

type Props = Parameters<typeof MapView>[0];

function setup(props: Partial<Props> = {}) {
  const handlers = HANDLERS();
  const all: Props = {
    selectedRoomId: null,
    focusRequest: null,
    basemapId: 'dark' as const,
    eventCounts: new Map<string, number>(),
    showAmenities: true,
    levels: {},
    openVenueId: null,
    picking: false,
    route: null,
    deviceFix: null,
    ...handlers,
    ...props,
  };
  const view = render(<MapView {...all} />);
  return {
    ...handlers,
    rerender: (next: Partial<Props>) => view.rerender(<MapView {...all} {...next} />),
  };
}

const venues = () => [...document.querySelectorAll('path.map__venue')];
const rooms = () => [...document.querySelectorAll('path.map__room')];
const openRooms = () => rooms().filter((room) => !room.classList.contains('map__room--closed'));
const links = () => [...document.querySelectorAll('path.map__link')];
const routeLegs = () => [...(document.querySelector('.leaflet-route-pane')?.querySelectorAll('path') ?? [])];

describe('what is on the map', () => {
  it('draws every building, every room and every covered crossing', () => {
    // Counts, because the way this goes wrong is that something stops being
    // drawn. A room missing from the map is invisible until somebody goes
    // looking for that room, and then it is simply not there.
    setup();
    expect(venues()).toHaveLength(14);
    expect(rooms()).toHaveLength(146);
    expect(links().filter((l) => l.classList.contains('map__link--skywalk'))).toHaveLength(11);
    expect(links().filter((l) => l.classList.contains('map__link--tunnel'))).toHaveLength(1);
  });

  it('names each building, since the campus view is outlines otherwise', () => {
    setup();
    const named = [...document.querySelectorAll('.leaflet-tooltip')].map((t) => t.textContent);
    expect(named).toContain('Convention Center');
    expect(named).toContain('Lucas Oil Stadium');
    expect(named).toHaveLength(14);
  });

  it('keeps every room shut until its building is opened', () => {
    // Nothing draws an inside until one is opened; that is the whole shape of
    // the map. Rooms drawn open everywhere would put 146 shapes on a campus
    // view meant to be fourteen outlines.
    const { rerender } = setup();
    expect(openRooms()).toHaveLength(0);
    rerender({ openVenueId: 'icc' });
    expect(openRooms().length).toBeGreaterThan(0);
    expect(openRooms().length).toBeLessThan(rooms().length);
  });

  it('switches the basemap under everything else', () => {
    const { rerender } = setup();
    const tile = () => (document.querySelector('.leaflet-tile-pane img') as HTMLImageElement).src;
    expect(tile()).toContain('dark');
    rerender({ basemapId: 'streets' });
    expect(tile()).toContain('voyager');
  });
});

describe('which skywalks belong to the floor you are on', () => {
  it('draws them all with nothing open, and only the right ones with something open', () => {
    // The rule that is invisible unless you happen to open that building on
    // that floor. The network runs at the second level throughout, so a span
    // drawn over the convention centre's Level 1 is a line over your head sold
    // as a way out — and a span that stops drawing on Level 2 is a covered
    // crossing nobody knows exists.
    const { rerender } = setup();
    expect(links()).toHaveLength(12);

    rerender({ openVenueId: 'icc', levels: { icc: 'Level 2' } });
    expect(links()).toHaveLength(5);

    rerender({ openVenueId: 'icc', levels: { icc: 'Level 1' } });
    expect(links()).toHaveLength(0);
  });

  it('draws none over a building no span reaches', () => {
    const { rerender } = setup();
    rerender({ openVenueId: 'lucas-oil' });
    expect(links()).toHaveLength(0);
  });
});

describe('what a tap means', () => {
  it('opens the building you tapped', () => {
    const { onOpenVenue } = setup();
    fireEvent.click(venues()[0]);
    expect(onOpenVenue).toHaveBeenCalledWith('icc');
  });

  it('opens the room you tapped, once its building is open', () => {
    // One click rather than two: there is nothing else a room click could mean,
    // and making people find that out by double-clicking helped nobody.
    const { rerender, onOpenRoom, onSelectRoom } = setup();
    rerender({ openVenueId: 'icc' });
    const room = openRooms()[0];
    fireEvent.click(room);
    expect(onOpenRoom).toHaveBeenCalledTimes(1);
    expect(onSelectRoom).toHaveBeenCalledWith(onOpenRoom.mock.calls[0][0].id);
  });

  it('shuts what is open when you tap the ground', () => {
    // The campus goes back to outlines, which is the view you pick the next
    // building from. Without it there is no way back out of a building except
    // the picker.
    const { rerender, onSelectRoom, onOpenVenue } = setup();
    rerender({ openVenueId: 'icc' });
    onOpenVenue.mockClear();
    fireEvent.click(document.querySelector('.leaflet-container')!);
    expect(onSelectRoom).toHaveBeenCalledWith(null);
  });
});

describe('while the directions panel is asking for a place', () => {
  it('takes a tap on open ground as that point', () => {
    const { onPickPlace, onSelectRoom } = setup({ picking: true });
    fireEvent.click(document.querySelector('.leaflet-container')!);
    expect(onPickPlace).toHaveBeenCalledTimes(1);
    expect(onPickPlace.mock.calls[0][0].kind).toBe('point');
    // And must not also shut the building you are looking inside.
    expect(onSelectRoom).not.toHaveBeenCalled();
  });

  it('takes a tap on a room as that room', () => {
    const { rerender, onPickPlace, onOpenRoom, onSelectRoom } = setup({ picking: true });
    rerender({ picking: true, openVenueId: 'icc' });
    fireEvent.click(openRooms()[0]);
    expect(onPickPlace).toHaveBeenCalledTimes(1);
    expect(onPickPlace.mock.calls[0][0].kind).toBe('room');
    // Picking a room must not also open it and change what is selected
    // underneath the panel that asked.
    expect(onOpenRoom).not.toHaveBeenCalled();
    expect(onSelectRoom).not.toHaveBeenCalled();
  });

  it('treats a tap on a building as a way in, and keeps asking', () => {
    // A building is not an answer: what you want from it is one of the rooms
    // inside, and those are not drawn until it opens. So this opens it and the
    // next tap is the one that answers.
    const { onOpenVenue, onPickPlace } = setup({ picking: true });
    fireEvent.click(venues()[0]);
    expect(onOpenVenue).toHaveBeenCalledWith('icc');
    expect(onPickPlace).not.toHaveBeenCalled();
  });
});

describe('drawing the route', () => {
  const route = routeBetween({ kind: 'room', roomId: 'hall-b' }, { kind: 'room', roomId: 'sagamore-ballroom' }, null);

  it('draws one line per leg, on its own pane above everything', () => {
    // The panel lists the legs and the map draws them, and the two agreeing is
    // the whole promise. A route described in words and not drawn — or drawn
    // under the buildings, which is the same thing — is the failure here.
    expect(route?.walk?.legs.length).toBeGreaterThan(1);
    const { rerender } = setup();
    expect(routeLegs()).toHaveLength(0);
    rerender({ route });
    expect(routeLegs()).toHaveLength(route!.walk!.legs.length);
  });

  it('takes the route away again when it is cleared', () => {
    const { rerender } = setup({ route });
    expect(routeLegs().length).toBeGreaterThan(0);
    rerender({ route: null });
    expect(routeLegs()).toHaveLength(0);
  });
});
