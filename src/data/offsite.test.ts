/**
 * Turning what Gen Con printed into somewhere you can walk to.
 *
 * Every failure here is silent in the same way: the event keeps its title and
 * its time, and simply has no location — which looks exactly like an event
 * nobody has scheduled yet rather than one at a steakhouse two blocks away.
 * Forty of 27,467 are like this, so nothing about the totals would move if the
 * matcher stopped working entirely.
 *
 * The other failure is worse and quieter still: an address that matches the
 * *wrong* row. A pin confidently in the wrong block is a walk somebody takes.
 */

import { describe, expect, it } from 'vitest';
import { ADDRESSES } from './addresses';
import { NAMED_PINS, pinForEvent, plainStreet, plainWords } from './offsite';
import { indexEvents, type ConEvent } from './events';
import { distanceMetres } from '../utils/geo';

const at = (locationText: string, roomText?: string): ConEvent =>
  ({ id: 'x', title: 't', locationText, roomText, start: '2026-07-30T19:00:00-04:00' }) as ConEvent;

describe('reading an address the way it was written', () => {
  it('spells out the abbreviations both sides use', () => {
    // Gen Con writes `127 S Illinois St` and OpenStreetMap writes `South
    // Illinois Street`. Neither is going to change, so both are reduced to the
    // same shape rather than either being rewritten at its source.
    expect(plainStreet('127 S Illinois St')).toBe('127 south illinois street');
    expect(plainStreet('South Illinois Street')).toBe('south illinois street');
    expect(plainStreet('501 W Maryland St')).toBe('501 west maryland street');
  });

  it('does not turn a saint into a street', () => {
    // `St` is both, and downtown Indianapolis has a St. Elmo Steak House on
    // South Illinois Street. Expand it wherever it appears and the restaurant
    // becomes "Street Elmo", which nobody will ever type. A street type comes
    // last in an American address and a saint comes first, so position is the
    // whole distinction — and it is the only one available.
    expect(plainStreet('St. Elmo Steak House')).toBe('st elmo steak house');
    expect(plainStreet('127 S Illinois St')).toContain('street');
  });

  it('collapses a directional the source wrote twice', () => {
    // `310 South S Delaware St` is real, and spelling out its `S` gives
    // "south south delaware street" against a gazetteer that has one south.
    expect(plainStreet('310 South S Delaware St')).toBe('310 south delaware street');
  });

  it('reduces a name to letters and spaces, so punctuation cannot hide it', () => {
    expect(plainWords('St. Elmo Steak House')).toBe('st elmo steak house');
    expect(plainWords('30 S Meridian St.')).toBe('30 s meridian st');
  });
});

describe('the pin an event stands on', () => {
  it('finds a place by the number and street the schedule printed', () => {
    const pin = pinForEvent(at('Taxman CityWay', '310 South S Delaware St, Indianapolis, IN 46204'))!;
    expect(pin).toBeTruthy();
    // Against the gazetteer row rather than against a coordinate typed here:
    // this is the match being asserted, not the data.
    const row = ADDRESSES.find((a) => a.name === 'TaxMan CityWay')!;
    expect(distanceMetres(pin, row)).toBeLessThan(1);
  });

  it('finds a place by the name the schedule calls it', () => {
    // `127 S Illinois St` would do it too, but the name is what OpenStreetMap
    // files this one under and the name is what somebody types.
    const pin = pinForEvent(at('St. Elmo Steak House', '127 S Illinois St'))!;
    const row = ADDRESSES.find((a) => a.name === 'St. Elmo Steak House')!;
    expect(distanceMetres(pin, row)).toBeLessThan(1);
  });

  it('falls back to what was written down for the four OSM has no address for', () => {
    const pin = pinForEvent(at('Janus Lofts', '255 McCrea St, Indianapolis, IN 46225'))!;
    expect(pin.name).toBe('Janus Lofts');
    expect(pin.address).toContain('255 McCrea');
    // Downtown, not somewhere in the county: a geocoder that answered with the
    // wrong Indianapolis would still answer.
    expect(distanceMetres(pin, { lat: 39.7635, lng: -86.1626 })).toBeLessThan(1_500);
  });

  it('gives two events at one address the same pin', () => {
    // The coordinate is the identity, so the map draws one mark and the panel
    // lists both — rather than two marks a metre apart with one event each.
    const a = pinForEvent(at('St. Elmo Steak House', '127 S Illinois St'))!;
    const b = pinForEvent(at('St. Elmo Steak House', '127 South Illinois Street'))!;
    expect(a.id).toBe(b.id);
  });

  it('has nothing for a place inside a building the map already draws', () => {
    // "Georgia Street Entrance" is a real place in the convention centre and
    // the answer to it is a room nobody has drawn, not a pin in the street.
    // Ten events are like this and they stay unmatched on purpose.
    expect(pinForEvent(at('ICC', 'Georgia Street Entrance'))).toBeNull();
    expect(pinForEvent(at('Stadium', 'North Plaza'))).toBeNull();
    expect(pinForEvent(at('JW', '3rd Floor Foyer'))).toBeNull();
  });

  it('has nothing for an address that is not there', () => {
    expect(pinForEvent(at('Nowhere', '9999 Nonesuch Boulevard'))).toBeNull();
    expect(pinForEvent(at('', ''))).toBeNull();
  });

  it('names every pin it can be asked for', () => {
    for (const pin of NAMED_PINS) {
      expect(pin.name.trim()).toBe(pin.name);
      expect(pin.name.length).toBeGreaterThan(3);
      expect(pin.address).toMatch(/[0-9]/);
      expect(Number.isFinite(pin.lat) && Number.isFinite(pin.lng)).toBe(true);
    }
    expect(NAMED_PINS).toHaveLength(4);
  });
});

describe('over the whole schedule', () => {
  const feed = [
    at('Janus Lofts', '255 McCrea St, Indianapolis, IN 46225'),
    at('Taxman CityWay', '310 South S Delaware St, Indianapolis, IN 46204'),
    at('St. Elmo Steak House', '127 S Illinois St'),
    at('Victory Field', '501 W Maryland St'),
    at('416 Wabash', '416 E Wabash St'),
    at('White River State Park', 'Indiana State Museum Lawn'),
    at('The Oceanaire Seafood Room', '30 S Meridian St.'),
    at('ICC', 'Exhibit Hall B'),
    at('ICC', 'Georgia Street Entrance'),
  ];

  it('puts each one on a pin, and the room event in a room', () => {
    const index = indexEvents(feed);
    expect(index.byPin.size).toBe(7);
    expect([...index.byRoom.keys()]).toEqual(['hall-b']);
    // The one that is neither: a concourse spot inside a building the map
    // draws. It stays unmatched rather than being pinned to the street.
    expect(index.unmatched).toHaveLength(1);
  });

  it('never puts an event in a room on a pin', () => {
    // Order matters and this is the whole of it: an event in Exhibit Hall B has
    // a room, and the ICC has a street address, so a matcher that tried the
    // address first would move the entire convention outside onto the pavement.
    const index = indexEvents(feed);
    for (const { events } of index.byPin.values()) {
      for (const event of events) expect(event.roomText).not.toBe('Exhibit Hall B');
    }
  });

  it('sorts each pin by when things start there', () => {
    const index = indexEvents([
      { ...at('St. Elmo Steak House', '127 S Illinois St'), id: 'late', start: '2026-07-30T21:00:00-04:00' },
      { ...at('St. Elmo Steak House', '127 S Illinois St'), id: 'early', start: '2026-07-30T18:00:00-04:00' },
    ]);
    const [{ events }] = [...index.byPin.values()];
    expect(events.map((event) => event.id)).toEqual(['early', 'late']);
  });
});
