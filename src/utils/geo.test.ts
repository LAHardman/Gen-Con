/**
 * The projection and the distance the rest of the map is measured with.
 *
 * Pure maths with known answers, and every route's distance and walking time
 * comes out of the last two functions here — so they are worth pinning even
 * though they are four lines each.
 */

import { describe, expect, it } from 'vitest';
import { distanceMetres, localRectToBounds, offsetLatLng, walkingMinutes } from './geo';

const ICC = { lat: 39.765683, lng: -86.166846 };

describe('offsetLatLng', () => {
  it('moves 100 m south by a known fraction of a degree', () => {
    const moved = offsetLatLng(ICC, 0, 100);
    expect(moved.lat).toBeCloseTo(ICC.lat - 100 / 111_320, 9);
    expect(moved.lng).toBe(ICC.lng);
  });

  it('needs more degrees of longitude than of latitude, this far north', () => {
    // Longitude narrows away from the equator, so 100 m east is a bigger
    // angular step than 100 m north. Getting this backwards would skew every
    // building on the map.
    const east = offsetLatLng(ICC, 100, 0);
    const north = offsetLatLng(ICC, 0, -100);
    expect(Math.abs(east.lng - ICC.lng)).toBeGreaterThan(Math.abs(north.lat - ICC.lat));
  });

  it('goes back where it came from', () => {
    const there = offsetLatLng(ICC, 250, 175);
    const back = offsetLatLng(there, -250, -175);
    expect(back.lat).toBeCloseTo(ICC.lat, 9);
    expect(back.lng).toBeCloseTo(ICC.lng, 6);
  });
});

describe('localRectToBounds', () => {
  const container = { x: 0, y: 0, width: 100, height: 200 };
  const anchor = { nw: ICC, widthMetres: 400, heightMetres: 800 };

  it('projects a rect filling its container onto the anchor itself', () => {
    const [nw, se] = localRectToBounds(container, container, anchor);
    expect(nw).toEqual(ICC);
    expect(se.lat).toBeCloseTo(offsetLatLng(ICC, 0, 800).lat, 9);
    expect(se.lng).toBeCloseTo(offsetLatLng(ICC, 400, 0).lng, 9);
  });

  it('places a quarter-sized rect a quarter of the way in', () => {
    const [nw] = localRectToBounds({ x: 25, y: 50, width: 25, height: 50 }, container, anchor);
    expect(nw.lat).toBeCloseTo(offsetLatLng(ICC, 0, 200).lat, 9);
    expect(nw.lng).toBeCloseTo(offsetLatLng(ICC, 100, 0).lng, 9);
  });
});

describe('distanceMetres', () => {
  it('measures a known offset back to the metre', () => {
    expect(distanceMetres(ICC, offsetLatLng(ICC, 0, 300))).toBeCloseTo(300, 6);
    expect(distanceMetres(ICC, offsetLatLng(ICC, 400, 0))).toBeCloseTo(400, 6);
  });

  it('measures a diagonal as the hypotenuse', () => {
    // To the centimetre rather than exactly: `offsetLatLng` converts east
    // metres at the origin's latitude and `distanceMetres` at the midpoint's,
    // so the two disagree by millimetres over half a kilometre. That is the
    // flat-earth approximation both are documented as, and it is five orders of
    // magnitude below anything this map claims.
    expect(distanceMetres(ICC, offsetLatLng(ICC, 300, 400))).toBeCloseTo(500, 1);
  });

  it('does not care which way round the two points are', () => {
    const other = offsetLatLng(ICC, 120, -80);
    expect(distanceMetres(ICC, other)).toBeCloseTo(distanceMetres(other, ICC), 9);
  });

  it('is zero for a point and itself', () => {
    expect(distanceMetres(ICC, { ...ICC })).toBe(0);
  });
});

describe('walkingMinutes', () => {
  it('walks at the unhurried convention-crowd pace', () => {
    expect(walkingMinutes(700)).toBe(10);
    expect(walkingMinutes(140)).toBe(2);
  });

  it('never rounds a walk down to nothing', () => {
    // "0 min" would read as "you are there" for a walk that is still a walk.
    expect(walkingMinutes(5)).toBe(1);
    expect(walkingMinutes(0)).toBe(1);
  });
});
