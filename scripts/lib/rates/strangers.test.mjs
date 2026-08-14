/**
 * The rules that decide whether a search result becomes somewhere to sleep.
 *
 * Every one of them refuses rather than guesses, and every one is here because
 * the alternative is a hotel listed twice under two names, or a block of flats
 * listed forty times, or a motel in another county sitting in the walk ring.
 */

import { describe, expect, it } from 'vitest';

import { kindOf, placesFromStrangers } from './strangers.mjs';

/** The convention centre, near enough. */
const HALL = { lat: 39.7641, lng: -86.1639 };
const DRIVE = 25_000;

/** Metres east of the hall, as a coordinate. */
const east = (metres) => ({
  lat: HALL.lat,
  lng: HALL.lng + metres / (111_320 * Math.cos((HALL.lat * Math.PI) / 180)),
});

const stranger = (name, metres, nightly, extra = {}) => ({
  name,
  nightly,
  kind: 'Vacation rental',
  town: 'Indianapolis',
  ...east(metres),
  ...extra,
});

const run = (strangers, known = []) =>
  placesFromStrangers({ strangers, known, hall: HALL, driveMetres: DRIVE });

describe('what becomes a place', () => {
  it('keeps a flat let by the night, which is not in OpenStreetMap and is real', () => {
    // The whole point. Four people to a two-bedroom flat is often the cheapest
    // way to sleep near the hall, and no survey has it.
    const { places } = run([stranger('Indy Urban Nest - Sleeps 8', 400, 341)]);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ kind: 'rental', ring: 'walk', metres: 400, nightly: 341 });
  });

  it('gives it an id nothing could mistake for a surveyed one', () => {
    // `lodging.ts` ids are OSM ways and relations. Nothing here was surveyed,
    // and an id that looked like one would launder that away.
    const { places } = run([stranger('Le Méridien Indianapolis', 500, 295)]);
    expect(places[0].id).toMatch(/^serp:/);
  });

  it('refuses one that stands where a hotel we already have stands', () => {
    /*
     * The duplicate that would look like two hotels. Within eighty metres it is
     * the same building under another name — which is exactly why the price
     * matcher uses the same radius.
     */
    const known = [{ id: 'way1', name: 'Hyatt Regency', ...east(60) }];
    const { places, why } = run([stranger('Hyatt Regency Indianapolis Downtown', 55, 200)], known);
    expect(places).toEqual([]);
    expect(why.alreadyKnown).toBe(1);
  });

  it('keeps one genuinely nearby but in its own building', () => {
    // Downtown hotels sit close together; the rule must not swallow the street.
    const known = [{ id: 'way1', name: 'Hyatt Regency', ...east(400) }];
    const { places } = run([stranger('Stone Soup Inn', 700, 168)], known);
    expect(places).toHaveLength(1);
  });

  it('takes the cheaper of two listings with one name', () => {
    // A search answers per rate plan, so one flat arrives three times.
    const { places, why } = run([
      stranger('City View Stay', 300, 390),
      stranger('City View Stay', 300, 355),
    ]);
    expect(places).toHaveLength(1);
    expect(places[0].nightly).toBe(355);
    expect(why.cheaper).toBe(1);
  });

  it('lists one doorway once, however many flats are let behind it', () => {
    /*
     * Forty listings in one block would bury every real hotel on the page. At
     * twelve metres apart they are the same front door, and somebody scanning a
     * list wants somewhere to sleep rather than that building's inventory.
     */
    const { places, why } = run([
      stranger('Indy Urban Nest - Sleeps 8', 300, 341),
      stranger('City View Stay - Sleeps 8', 304, 390),
      stranger('Modern Condo Near Monument Circle', 297, 420),
    ]);
    expect(places).toHaveLength(1);
    expect(places[0].nightly).toBe(341);
    expect(why.sameDoor).toBe(2);
  });

  it('drops anything past the drive ring', () => {
    const { places, why } = run([stranger('Somewhere In Ohio', 400_000, 60)]);
    expect(places).toEqual([]);
    expect(why.tooFar).toBe(1);
  });

  it('sorts them nearest first, as the hotel list is', () => {
    const { places } = run([
      stranger('Far', 5_000, 90),
      stranger('Near', 200, 300),
      stranger('Middle', 900, 150),
    ]);
    expect(places.map((one) => one.name)).toEqual(['Near', 'Middle', 'Far']);
  });
});

describe('what kind of thing it is', () => {
  it('keeps the distinction a reader cares about: front desk, or somebody’s flat', () => {
    expect(kindOf('Hotel')).toBe('hotel');
    expect(kindOf('Vacation rental')).toBe('rental');
    expect(kindOf('Apartment')).toBe('rental');
    expect(kindOf('Hostel')).toBe('hostel');
    expect(kindOf('Resort')).toBe('hotel');
    // Said nothing at all: assume the thing that needs the more careful reading.
    expect(kindOf(null)).toBe('rental');
  });
});
