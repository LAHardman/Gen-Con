/**
 * The pavement network, and the rule that keeps the skywalks out of it.
 *
 * Two things are checked here and they fail in opposite directions. The filter
 * fails *open*: let a bridge through and the skywalk system arrives a second
 * time as ground-level footway, so a route could cross one without going
 * upstairs — and the graph would look better connected, not broken. The
 * generated table fails *silently*: a units slip or a bad index would give
 * every route plausible-looking numbers that were wrong by a constant.
 */

import { describe, expect, it } from 'vitest';
import { onTheGround } from '../../scripts/lib/pavements.mjs';
import { PAVEMENT_EDGES, PAVEMENT_NODES } from './pavements';
import { distanceMetres } from '../utils/geo';

describe('what counts as pavement', () => {
  it('takes the footways, crossings and plazas', () => {
    expect(onTheGround({ highway: 'footway', footway: 'sidewalk' })).toBe(true);
    expect(onTheGround({ highway: 'footway', footway: 'crossing', crossing: 'traffic_signals' })).toBe(true);
    expect(onTheGround({ highway: 'pedestrian' })).toBe(true);
    expect(onTheGround({ highway: 'steps' })).toBe(true);
  });

  it('leaves the skywalks alone, however they are tagged', () => {
    // These are the tags Gen Con's skywalks actually carry in this bounding
    // box — 22 bridges and 9 tunnels — and `connections.ts` already holds them
    // with the floor each one lands on.
    expect(onTheGround({ highway: 'footway', bridge: 'yes', covered: 'yes', layer: '1', level: '1' })).toBe(false);
    expect(onTheGround({ highway: 'footway', bridge: 'yes' })).toBe(false);
    expect(onTheGround({ highway: 'footway', covered: 'yes' })).toBe(false);
    expect(onTheGround({ highway: 'footway', layer: '1' })).toBe(false);
    expect(onTheGround({ highway: 'footway', level: '2' })).toBe(false);
    expect(onTheGround({ highway: 'footway', tunnel: 'yes', layer: '-1' })).toBe(false);
    expect(onTheGround({ highway: 'corridor', indoor: 'yes' })).toBe(false);
  });

  it('is not fooled by a tag that says no', () => {
    // `bridge=no` is a real tagging, and reading it as "there is a bridge tag,
    // therefore a bridge" would throw away ordinary pavement.
    expect(onTheGround({ highway: 'footway', bridge: 'no' })).toBe(true);
    expect(onTheGround({ highway: 'footway', layer: '0' })).toBe(true);
  });

  it('leaves out what is not a road for people, or not open to them', () => {
    expect(onTheGround({ highway: 'service' })).toBe(false);
    expect(onTheGround({ highway: 'residential' })).toBe(false);
    expect(onTheGround({})).toBe(false);
    expect(onTheGround({ highway: 'footway', access: 'private' })).toBe(false);
    expect(onTheGround({ highway: 'footway', access: 'no' })).toBe(false);
  });
});

describe('the network that was generated', () => {
  it('has one, which a rebuild could quietly empty', () => {
    expect(PAVEMENT_NODES.length).toBeGreaterThan(100);
    expect(PAVEMENT_EDGES.length).toBeGreaterThan(100);
  });

  it('points every edge at a junction that exists', () => {
    for (const edge of PAVEMENT_EDGES) {
      expect(PAVEMENT_NODES[edge.a], `edge ${edge.a}->${edge.b}`).toBeDefined();
      expect(PAVEMENT_NODES[edge.b], `edge ${edge.a}->${edge.b}`).toBeDefined();
      expect(edge.a).not.toBe(edge.b);
    }
  });

  it('never claims a path is shorter than the straight line across it', () => {
    // The one arithmetic check worth having: a run's length is summed over its
    // bends, so a metres/degrees slip or a simplification that dropped the
    // wrong points shows up here and nowhere else. Half a metre of slack for
    // the rounding the table is written with.
    for (const edge of PAVEMENT_EDGES) {
      const [aLat, aLng] = PAVEMENT_NODES[edge.a];
      const [bLat, bLng] = PAVEMENT_NODES[edge.b];
      const chord = distanceMetres({ lat: aLat, lng: aLng }, { lat: bLat, lng: bLng });
      expect(edge.metres + 0.5, `edge ${edge.a}->${edge.b}`).toBeGreaterThanOrEqual(chord);
    }
  });

  it('is one network rather than several', () => {
    // `fetch-pavements.mjs` keeps only the largest connected piece, because a
    // route can only use what it can reach. If this ever splits, a whole corner
    // of the campus has silently stopped being routable.
    const neighbours = new Map<number, number[]>();
    for (const edge of PAVEMENT_EDGES) {
      if (!neighbours.has(edge.a)) neighbours.set(edge.a, []);
      if (!neighbours.has(edge.b)) neighbours.set(edge.b, []);
      neighbours.get(edge.a)!.push(edge.b);
      neighbours.get(edge.b)!.push(edge.a);
    }
    const seen = new Set<number>([PAVEMENT_EDGES[0].a]);
    const queue = [PAVEMENT_EDGES[0].a];
    while (queue.length) {
      for (const next of neighbours.get(queue.pop()!) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    expect(seen.size).toBe(PAVEMENT_NODES.length);
  });
});
