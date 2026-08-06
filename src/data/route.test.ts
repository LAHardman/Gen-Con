/**
 * The router, over the real campus.
 *
 * These assert the properties a route must have rather than particular
 * distances: the metres shift whenever a plan is re-read, and a test that
 * pinned them would fail for a reason nobody cares about. What must not shift
 * is that every pair of buildings has an answer, that a measured route is never
 * passed over for a straight line, and that a straight line is never dressed up
 * as anything else.
 */

import { describe, expect, it } from 'vitest';
import { ROOMS, ROOMS_BY_ID, VENUES, VENUE_LEVELS, venueOutline } from './venues';
import { doorsOf, floorArea, floorOf } from './walkable';
import { walkBetween } from './route';
import { placeAnchor, roomPlace } from './navigation';

/** One room per building, so the sample covers the campus rather than a corner. */
const perVenue = VENUES.map((venue) => ROOMS.find((room) => room.venueId === venue.id)!).filter(
  Boolean,
);

const routeBetweenRooms = (a: string, b: string) =>
  walkBetween(
    placeAnchor(roomPlace(ROOMS_BY_ID[a]), null)!,
    placeAnchor(roomPlace(ROOMS_BY_ID[b]), null)!,
  );

describe('every building can be reached from every other', () => {
  it('leaves no pair without a route', () => {
    // This is what door nodes exist for. Before them, two rooms in buildings no
    // skywalk joined got no edge at all — 18 of the 182 pairs — because an
    // outdoor edge was only ever drawn from a node that had no square to stand
    // on. The panel fell back to a bearing and nothing looked broken.
    const missing: string[] = [];
    for (const a of perVenue) {
      for (const b of perVenue) {
        if (a === b) continue;
        if (!routeBetweenRooms(a.id, b.id)) missing.push(`${a.venueId} -> ${b.venueId}`);
      }
    }
    expect(missing).toEqual([]);
  }, 60_000);

  it('reaches a building with no floor drawn at all', () => {
    // The Indiana Rep is one room on one floor, and Gen Con does not colour it
    // as its own venue on the campus sheets, so nothing draws its circulation.
    // Its room has no square to stand on and the route has to reach it as a
    // loose point — which must still be offered, and said to be a straight
    // line. (Lucas Oil was the example here until its floors were read.)
    const walk = routeBetweenRooms('hall-b', 'indiana-rep-stage')!;
    expect(walk).not.toBeNull();
    expect(walk.legs.some((leg) => leg.kind === 'outdoor')).toBe(true);
    expect(walk.indoors).toBe(false);
  });

  it('walks the pavements rather than guessing a line across them', () => {
    // What the OpenStreetMap footway network bought: of the 182 pairs, 170
    // needed a straight line before it and 168 now follow surveyed pavement.
    const walk = routeBetweenRooms('hall-b', 'jw-white-river-abcd')!;
    expect(walk.legs.some((leg) => leg.kind === 'pavement')).toBe(true);
    const paved = walk.legs.filter((leg) => leg.kind === 'pavement');
    // And it is drawn, rather than being a two-point line under another name.
    expect(Math.max(...paved.map((leg) => leg.points.length))).toBeGreaterThan(2);
  });
});

describe('you can get around inside a building', () => {
  it('joins every room of a building to every other room of it', () => {
    // The nastiest failure this repository has had, because it arrives as an
    // *improvement*. A room on a floor nobody drew is a loose point: it has no
    // square to stand on, so it goes out to the street and routes badly but
    // routes. Draw that floor and it gains a square — and if no staircase
    // reaches that square, it is stranded with nothing to fall back to.
    //
    // Reading the JW's 2nd and 3rd floors did exactly that to 114 pairs of its
    // own rooms. Two things had to be true to fix it, and both are silent on
    // their own: a building's floors come from one placement rather than two
    // that disagree, and the inference still runs where the drawings leave a
    // piece of floor unserved.
    //
    // Every room against one of its building rather than every pair: the graph
    // is undirected, so if each room reaches the same room then each reaches
    // all the others. That is 146 searches rather than 2,202.
    const missing: string[] = [];
    for (const venue of VENUES) {
      const rooms = ROOMS.filter((room) => room.venueId === venue.id);
      const [first] = rooms;
      if (!first) continue;
      for (const room of rooms) {
        if (room === first) continue;
        if (!routeBetweenRooms(room.id, first.id)) missing.push(`${room.id} -> ${first.id}`);
      }
    }
    expect(missing).toEqual([]);
  }, 60_000);

  it('changes floor under cover rather than going round by the street', () => {
    // Two floors of one building joined by a staircase somebody drew. If the
    // link is lost the route does not disappear — it goes out of the door and
    // back in, which reads as a route and is a floor change in disguise.
    const walk = routeBetweenRooms('jw-white-river-abcd', 'jw-griffin-hall')!;
    expect(walk.indoors).toBe(true);
    expect(walk.legs.some((leg) => leg.kind === 'stairs')).toBe(true);
  });
});

describe('what a route is worth walking to stay dry', () => {
  it('stays under cover when the street would barely be shorter', () => {
    // 407 m over the skywalks against 391 m across Maryland St — 4%, in an
    // Indianapolis August, for which nobody would choose the street. This is
    // the whole reason the shortest route is not simply taken.
    const walk = routeBetweenRooms('sagamore-ballroom', 'marriott-indiana-ballroom')!;
    expect(walk.indoors).toBe(true);
    expect(walk.legs.some((leg) => leg.kind === 'skywalk')).toBe(true);
  });

  // A skywalk lands where it lands, and twice on this campus that is a car
  // park. Both spans of each pair were in `CONNECTIONS` from the start, and
  // each named exactly one venue, so neither joined anything — the JW and the
  // Hyatt had no covered route anywhere. The JW's 1,008 room pairs with the
  // Marriott, the Westin, the ICC and the Hyatt were all outdoors; 273 are not
  // now. The Hyatt's 48 with Le Méridien were all outdoors; none is now.
  //
  // Neither garage is a venue or ever will be — nobody is going there — but
  // each is a floor between two bridges, which is all a route needs of it.
  it.each([
    ['jw-griffin-hall', 'marriott-ballroom', 'Through the Government Center car park'],
    ['hyatt-lobby', 'le-meridien-lobby', 'Through the World of Wonders garage'],
  ])('crosses a building nobody is going to, %s -> %s', (from, to, crossing) => {
    const walk = routeBetweenRooms(from, to)!;
    expect(walk.indoors).toBe(true);
    expect(walk.legs.filter((leg) => leg.kind === 'skywalk')).toHaveLength(2);
    expect(walk.legs.map((leg) => leg.text)).toContain(crossing);
    // Named, rather than reported as a floor of a building with no plan: there
    // is no `undefined` in a direction anybody is meant to follow.
    for (const leg of walk.legs) expect(leg.text).not.toMatch(/undefined/);
  });

  it('takes the street when the covered way is a long way round', () => {
    // Exhibit Hall B to the Marriott Ballroom is 154 m apart and 500 m by
    // skywalk, which doglegs up through the Westin and back down. 217 m on the
    // pavement is the right answer and used to lose to that dogleg.
    const walk = routeBetweenRooms('hall-b', 'marriott-ballroom')!;
    expect(walk.indoors).toBe(false);
    expect(walk.legs.some((leg) => leg.kind === 'pavement')).toBe(true);
    expect(walk.metres).toBeLessThan(300);
  });

  it('stays on one floor when both ends are on it', () => {
    const walk = routeBetweenRooms('hall-a', 'hall-e')!;
    expect(walk.legs).toHaveLength(1);
    expect(walk.legs[0].kind).toBe('walk');
    expect(walk.indoors).toBe(true);
  });

  it('walks further than the straight line, because walls are in the way', () => {
    const walk = routeBetweenRooms('hall-a', 'hall-e')!;
    const from = placeAnchor(roomPlace(ROOMS_BY_ID['hall-a']), null)!.at;
    const to = placeAnchor(roomPlace(ROOMS_BY_ID['hall-e']), null)!.at;
    const straight = Math.hypot((from.lat - to.lat) * 111_320, (from.lng - to.lng) * 85_570);
    expect(walk.metres).toBeGreaterThan(straight);
  });
});

describe('what a leg says it is', () => {
  it('never calls a straight line a pavement, or the other way round', () => {
    // The two are drawn differently and mean different things: a pavement leg
    // is a footway somebody surveyed, an outdoor leg is the unmapped ground
    // between a door and the kerb. Reading one as the other is the whole
    // failure this file exists to prevent.
    const walk = routeBetweenRooms('hall-b', 'indiana-rep-stage')!;
    for (const leg of walk.legs) {
      if (leg.kind === 'outdoor') expect(leg.text).toMatch(/^(Outside|Out to the street)/);
      if (leg.kind === 'pavement') expect(leg.text).toMatch(/pavement/);
    }
  });

  it('sums its legs to the distance it reports', () => {
    // The panel prints both, and a total that disagreed with the steps under it
    // would be the sort of wrong that nobody notices for months.
    for (const [a, b] of [['hall-b', 'marriott-ballroom'], ['hall-b', 'lucas-oil-lower-suites']]) {
      const walk = routeBetweenRooms(a, b)!;
      const summed = walk.legs.reduce((total, leg) => total + leg.metres, 0);
      expect(Math.abs(summed - walk.metres), `${a} -> ${b}`).toBeLessThan(0.5);
    }
  });

  it('says each thing once rather than once per hop', () => {
    // A route down a pavement crosses a footway junction every few metres, and
    // each of those is its own edge in the graph: the Marriott run comes out of
    // the search as a dozen separate legs that all say "Along the pavement".
    // `merge` folds a run into one leg, and it folds about seven times per
    // route across the campus. Without it the panel is a list of junctions.
    for (const [a, b] of [
      ['hall-b', 'jw-white-river-abcd'],
      ['hall-b', 'lucas-oil-lower-suites'],
      ['sagamore-ballroom', 'marriott-indiana-ballroom'],
    ]) {
      const walk = routeBetweenRooms(a, b)!;
      for (let i = 1; i < walk.legs.length; i += 1) {
        const last = walk.legs[i - 1];
        const leg = walk.legs[i];
        const same = last.kind === leg.kind && last.venueId === leg.venueId && last.level === leg.level;
        expect(same, `${a} -> ${b}, legs ${i - 1} and ${i} both ${leg.kind}`).toBe(false);
      }
    }
  });

  it('gives every leg at least two points to draw', () => {
    const walk = routeBetweenRooms('hall-b', 'marriott-ballroom')!;
    for (const leg of walk.legs) expect(leg.points.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the surface a route is searched over', () => {
  it('leaves no scrap of floor too small to stand on', () => {
    // A single stray open cell is the worst kind of surface: it is floor to
    // everything downstream, and being isolated it is the *nearest* floor to
    // whatever sits beside it, so anything snapping to the storey snaps to it
    // and is then stranded on an island one square across. Lucas Oil's event
    // level came out as 513 cells and one stray, the drawn escalator up to the
    // concourse snapped to the stray, and the whole stadium above that floor
    // became unreachable — from inside it as well as from the campus.
    for (const venue of VENUES) {
      for (const level of VENUE_LEVELS[venue.id] ?? []) {
        const floor = floorOf(venue.id, level);
        if (floor.empty) continue;
        const seen = new Uint8Array(floor.open.length);
        for (let start = 0; start < floor.open.length; start += 1) {
          if (!floor.open[start] || seen[start]) continue;
          const queue = [start];
          let size = 0;
          seen[start] = 1;
          while (queue.length) {
            const i = queue.pop()!;
            size += 1;
            const cx = i % floor.width;
            const cy = Math.floor(i / floor.width);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= floor.width || ny >= floor.height) continue;
              const next = ny * floor.width + nx;
              if (!floor.open[next] || seen[next]) continue;
              seen[next] = 1;
              queue.push(next);
            }
          }
          expect(size, `${venue.id}/${level}`).toBeGreaterThanOrEqual(8);
        }
      }
    }
  }, 30_000);

  it('draws a surface for every floor a plan was read for', () => {
    // Three floors have none, and all three are venues Gen Con does not colour
    // as its own on the campus sheets. Everything it does colour is drawn.
    const bare = VENUES.flatMap((venue) =>
      (VENUE_LEVELS[venue.id] ?? [])
        .filter((level) => !floorArea(venue.id, level).cells)
        .map((level) => `${venue.id}/${level}`),
    );
    expect(bare).toEqual([
      'indiana-rep/Auditorium',
      'escape-room/200 S. Meridian St',
      'circle-centre/Levels 1–4',
    ]);
  });
});

describe('doors', () => {
  it('gives every piece of a floor its own way out', () => {
    // One door per floor was the first attempt, and it stranded everything
    // outside the piece the door happened to land in: the JW Marriott, whose
    // ground floor is drawn as several disconnected runs, became unreachable
    // from every building on the campus.
    for (const venue of VENUES) {
      for (const level of VENUE_LEVELS[venue.id] ?? []) {
        const floor = floorOf(venue.id, level);
        if (floor.empty) continue;
        expect(doorsOf(floor, venueOutline(venue)).length, venue.id).toBeGreaterThan(0);
        break;
      }
    }
  });

  it('puts the JW back on the map', () => {
    // The regression this whole guard exists for.
    const walk = routeBetweenRooms('hall-b', 'jw-white-river-abcd');
    expect(walk).not.toBeNull();
  });
});
