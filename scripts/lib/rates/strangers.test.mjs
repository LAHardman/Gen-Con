/**
 * The rules that decide whether a search result becomes somewhere to sleep.
 *
 * Every one of them refuses rather than guesses, and every one is here because
 * the alternative is a hotel listed twice under two names, or a block of flats
 * listed forty times, or a motel in another county sitting in the walk ring.
 */

import { describe, expect, it } from 'vitest';

import { keepFound, kindOf, placesFromStrangers } from './strangers.mjs';

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

describe('what earlier runs found', () => {
  const kept = (name, metres, nightly) => ({
    id: `serp:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    kind: 'rental',
    metres,
    ring: metres <= 1600 ? 'walk' : 'drive',
    nightly,
    ...east(metres),
  });

  it('does not throw away three hundred listings because this run found three', () => {
    /*
     * Measured, and caught before it merged. A top-up run with three searches
     * left returned three listings, and the file is written from what the run
     * found — so it would have deleted the other three hundred and thirty that
     * earlier runs paid for. `run.mjs` promises "NOTHING HERE DELETES"; that
     * was true of the quotes and had never been true of these.
     */
    const previous = Array.from({ length: 330 }, (_, i) => kept(`Flat ${i}`, 2000 + i * 40, 200));
    const fresh = [kept('Downtown Penthouse Suite', 580, 375)];

    const all = keepFound(previous, fresh);
    expect(all).toHaveLength(331);
    expect(all[0].name).toBe('Downtown Penthouse Suite');
  });

  it('takes this month’s price for a place it already had', () => {
    // The opposite of the cheapest-wins rule inside one response: there the
    // duplicates are room types, here they are months, and newer is truer.
    const all = keepFound([kept('McOuat Place 6B', 817, 228)], [kept('McOuat Place 6B', 817, 265)]);
    expect(all).toHaveLength(1);
    expect(all[0].nightly).toBe(265);
  });

  it('still lets one doorway be one place across runs', () => {
    // Last month's listing and this month's differently-named one can be the
    // same building, and neither pass on its own would notice.
    const all = keepFound([kept('Indy Urban Nest', 300, 341)], [kept('City View Stay', 304, 390)]);
    expect(all).toHaveLength(1);
  });

  it('keeps everything when a run finds nothing at all', () => {
    // The case that would have emptied the file: every source down, or the
    // month's allowance already spent.
    const previous = [kept('Stone Soup Inn', 900, 168)];
    expect(keepFound(previous, [])).toEqual(previous);
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
