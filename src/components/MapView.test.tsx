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
 * So these assert on the DOM Leaflet actually produced. Every layer, class and
 * handler is real. What jsdom cannot give is a *size* — every container is zero
 * by zero, so Leaflet picks a zoom out of nothing and every room comes out big
 * enough to label — so the label rule is asked directly instead, with the
 * pixels supplied rather than measured. That is not a workaround: it is the
 * only way to put a case either side of a threshold.
 *
 * The taps are the part worth having most. There are three meanings for a
 * click — open a building, open a room, answer the question the directions
 * panel is asking — and the third one silently changes the other two.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MapView,
  ROOM_LABEL_MIN_ZOOM,
  levelOf,
  roomFitsLabel,
  roomShowsLabel,
  toLatLngs,
  type LabelSizer,
} from './MapView';
import { routeBetween } from '../data/navigation';
import { ROOMS_BY_ID, defaultLevel, roomBounds, type Room } from '../data/venues';

afterEach(cleanup);

const HANDLERS = () => ({
  onSelectRoom: vi.fn(),
  onOpenRoom: vi.fn(),
  onOpenStand: vi.fn(),
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
    pins: [],
    onOpenPin: () => {},
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
    expect(venues()).toHaveLength(16);
    expect(rooms()).toHaveLength(149);
    expect(links().filter((l) => l.classList.contains('map__link--skywalk'))).toHaveLength(11);
    expect(links().filter((l) => l.classList.contains('map__link--tunnel'))).toHaveLength(1);
  });

  it('names each building, since the campus view is outlines otherwise', () => {
    setup();
    const named = [...document.querySelectorAll('.leaflet-tooltip')].map((t) => t.textContent);
    expect(named).toContain('Convention Center');
    expect(named).toContain('Lucas Oil Stadium');
    expect(named).toHaveLength(16);
  });

  it('keeps every room shut until its building is opened', () => {
    // Nothing draws an inside until one is opened; that is the whole shape of
    // the map. Rooms drawn open everywhere would put 149 shapes on a campus
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

describe('when a room is big enough to hold its name', () => {
  /**
   * A map on which `room` comes out exactly `width` by `height` screen pixels.
   *
   * The real map cannot be asked in jsdom — every container is zero by zero, so
   * Leaflet picks a zoom out of nothing and every room comes out big enough.
   * This rule is arithmetic on screen pixels, which is precisely what that
   * makes unavailable, so the pixels are supplied rather than measured. Written
   * as "put this room at this size" rather than as a scale, because the cases
   * that matter are the ones either side of a threshold.
   */
  const sized = (room: Room, width: number, height: number): LabelSizer => {
    const [nw, se] = roomBounds(room);
    const perLng = width / (se.lng - nw.lng);
    const perLat = height / (nw.lat - se.lat);
    return {
      latLngToLayerPoint: ([lat, lng]) => ({ x: lng * perLng, y: -lat * perLat }),
    };
  };

  const HALL = () => ROOMS_BY_ID['hall-b'];

  it('wants a room wide enough and tall enough to write on', () => {
    // 38 by 12 pixels, which is about what a room's short name needs. Either
    // dimension short of it and the name is written across the wall.
    expect(roomFitsLabel(sized(HALL(), 38, 12), HALL())).toBe(true);
    expect(roomFitsLabel(sized(HALL(), 37, 12), HALL())).toBe(false);
    expect(roomFitsLabel(sized(HALL(), 38, 11), HALL())).toBe(false);
  });

  it('wants both of them, not the area between them', () => {
    // A corridor is long and thin and has area to spare. A name written down
    // the middle of one still lands outside it — this is the shape the rule
    // exists to reject, and an area test accepts it.
    expect(roomFitsLabel(sized(HALL(), 1_000, 5), HALL())).toBe(false);
    expect(roomFitsLabel(sized(HALL(), 5, 1_000), HALL())).toBe(false);
  });

  it('is not the same test twice: width and height differ', () => {
    // 38 and 12 are different numbers and swapping them changes the answer for
    // any room wider than it is tall — which, at the zoom you read a floor at,
    // is most of them.
    expect(roomFitsLabel(sized(HALL(), 20, 30), HALL())).toBe(false);
    expect(roomFitsLabel(sized(HALL(), 30, 20), HALL())).toBe(false);
    expect(roomFitsLabel(sized(HALL(), 40, 20), HALL())).toBe(true);
  });

  it('says nothing at all until you are inside a building', () => {
    // Room names over a view of the whole campus are a thousand words across
    // fourteen outlines. The size test cannot substitute for the zoom
    // threshold: Exhibit Hall B is 100 m across and passes it at any zoom.
    const big = sized(HALL(), 400, 300);
    const at = { zoom: ROOM_LABEL_MIN_ZOOM - 1, selectedRoomId: null };
    expect(roomFitsLabel(big, HALL())).toBe(true);
    expect(roomShowsLabel(big, HALL(), at)).toBe(false);
    expect(roomShowsLabel(big, HALL(), { ...at, zoom: ROOM_LABEL_MIN_ZOOM })).toBe(true);
  });

  it('and nothing about a room too small, however far in you are', () => {
    // The other half. Zoomed right in on a floor of single-table rooms — the
    // Marriott's ten state and city rooms, Union Station's eleven railroad
    // rooms — a dozen labels go into a space that fits two and pile up on each
    // other. That is what the size test is for.
    const tiny = sized(HALL(), 20, 6);
    expect(roomShowsLabel(tiny, HALL(), { zoom: 19, selectedRoomId: null })).toBe(false);
  });

  it('names the room you picked however small it is, and wherever you are', () => {
    // The exception, and the reason the rule is worth having in one piece: you
    // have tapped it, so being told what it is, is the answer. It beats both
    // halves — too far out *and* too small.
    const tiny = sized(HALL(), 10, 4);
    const far = { zoom: 1, selectedRoomId: null };
    expect(roomShowsLabel(tiny, HALL(), far)).toBe(false);
    expect(roomShowsLabel(tiny, HALL(), { ...far, selectedRoomId: 'hall-b' })).toBe(true);
  });
});

describe('reading a ring off the data', () => {
  it('keeps latitude first, as every source here writes it', () => {
    // The classic silent one. Footprints, plan rings and skywalk lines are all
    // [latitude, longitude], which is Leaflet's order — and swapping them
    // renders perfectly, off the coast of Somalia, with every other test in
    // this file still passing.
    const [point] = toLatLngs([[39.7663, -86.1652]]);
    expect(point.lat).toBeCloseTo(39.7663, 4);
    expect(point.lng).toBeCloseTo(-86.1652, 4);
  });
});

describe('which floor a building is showing', () => {
  it('starts on the one it opens on and stays there until told otherwise', () => {
    // Buildings hold their floor independently, so reading the JW's 3rd must
    // not move the Hyatt.
    expect(levelOf('icc', {})).toBe(defaultLevel('icc'));
    expect(levelOf('icc', { icc: 'Level 2', 'jw-marriott': '3rd floor' })).toBe('Level 2');
    expect(levelOf('hyatt', { 'jw-marriott': '3rd floor' })).toBe(defaultLevel('hyatt'));
  });
});
