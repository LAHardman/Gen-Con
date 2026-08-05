/**
 * The skywalks and the tunnel, and the rule that decides when to draw one.
 *
 * These are somebody else's ways off OpenStreetMap, pasted in as coordinates,
 * and every failure mode here is a silent one: a floor named as a building does
 * not name it means a span that never draws, and a `REACH` that catches a
 * building the bridge only passes near means one that draws over the wrong
 * floor. Neither throws, and neither is visible unless you happen to open that
 * building on that floor.
 */

import { describe, expect, it } from 'vitest';
import { CONNECTIONS, ENTERS_ON, connectionShown } from './connections';
import { VENUES_BY_ID, VENUE_LEVELS } from './venues';

/** Every venue a span claims to reach, with the floor it claims to reach it on. */
function reachesOf(connection: (typeof CONNECTIONS)[number]) {
  const found = new Map<string, string>();
  for (const venueId of Object.keys(VENUES_BY_ID)) {
    for (const level of VENUE_LEVELS[venueId] ?? []) {
      if (connectionShown(connection, venueId, level)) found.set(venueId, level);
    }
  }
  return found;
}

describe('the connections themselves', () => {
  it('has the campus network: eleven skywalks and the tunnel', () => {
    expect(CONNECTIONS.filter((c) => c.kind === 'skywalk')).toHaveLength(11);
    expect(CONNECTIONS.filter((c) => c.kind === 'tunnel')).toHaveLength(1);
  });

  it('cites a distinct OSM way for each, so any of them can be checked', () => {
    const ways = CONNECTIONS.map((c) => c.way);
    expect(new Set(ways).size).toBe(ways.length);
    for (const way of ways) expect(Number.isInteger(way) && way > 0).toBe(true);
  });

  it('draws each as a line with at least two ends, downtown', () => {
    for (const connection of CONNECTIONS) {
      expect(connection.line.length, String(connection.way)).toBeGreaterThanOrEqual(2);
      for (const [lat, lng] of connection.line) {
        // A coordinate pasted in with its pair the wrong way round would put a
        // skywalk in the Indian Ocean, and nothing else would notice.
        expect(lat, String(connection.way)).toBeGreaterThan(39.7);
        expect(lat, String(connection.way)).toBeLessThan(39.8);
        expect(lng, String(connection.way)).toBeGreaterThan(-86.2);
        expect(lng, String(connection.way)).toBeLessThan(-86.1);
      }
    }
  });
});

describe('which floor a span belongs to', () => {
  it('draws every span while no building is open', () => {
    // That view is the campus, and where the covered crossings are is the most
    // useful thing on it.
    for (const connection of CONNECTIONS) {
      expect(connectionShown(connection, null, undefined)).toBe(true);
    }
  });

  it('names a real floor of a real building in the table itself', () => {
    // Asserted against the table rather than against what draws: a floor the
    // building does not call by that name — `2nd floor` where the rooms say
    // `Level 2` — makes the lookup return nothing, so checking through the
    // lookup could never see the bad name. That is a test which cannot fail.
    for (const [venueId, level] of Object.entries(ENTERS_ON)) {
      expect(VENUES_BY_ID[venueId], venueId).toBeDefined();
      expect(VENUE_LEVELS[venueId] ?? [], venueId).toContain(level);
    }
  });

  it('reaches the convention centre on Level 2 and never on Level 1', () => {
    // The campus network runs at the second level throughout, so a span drawn
    // over Level 1 would be a line over your head sold as a way out.
    const icc = CONNECTIONS.filter((c) => reachesOf(c).get('icc') === 'Level 2');
    expect(icc.length).toBeGreaterThan(0);
    for (const connection of CONNECTIONS) {
      expect(connectionShown(connection, 'icc', 'Level 1'), String(connection.way)).toBe(false);
    }
  });

  it('shows a span nothing reaches on no floor of an open building', () => {
    // Opening a building it does not touch must not draw it: the point of the
    // rule is that a span on screen is a way out of where you are standing.
    const stadium = CONNECTIONS.filter((c) => reachesOf(c).has('lucas-oil'));
    for (const connection of CONNECTIONS) {
      if (stadium.includes(connection)) continue;
      for (const level of VENUE_LEVELS['lucas-oil'] ?? []) {
        expect(connectionShown(connection, 'lucas-oil', level), String(connection.way)).toBe(false);
      }
    }
  });

  it('gives every span at least one building to belong to', () => {
    // A span reaching nothing draws only on the campus view and vanishes the
    // moment any building is opened — which would mean its coordinates land
    // nowhere near the buildings it is supposed to join.
    for (const connection of CONNECTIONS) {
      expect(reachesOf(connection).size, `way ${connection.way} reaches nothing`).toBeGreaterThan(0);
    }
  });
});
