/**
 * Which hall a booth number is in.
 *
 * This table is not derived from anything. Every published source gives a
 * booth its number and none gives it a hall — not the schedule, not the stand
 * list, not the map API, and not Gen Con's own printed exhibit-hall plan, which
 * draws the grid to scale and letters no hall on it. Where the air walls are is
 * something somebody who has walked the hall knows.
 *
 * Which makes it exactly the kind of table that can be silently back to front,
 * and the reason most of what follows is the checking rather than the values.
 * Reversed, it does not fail: every booth still gets a hall, every hall still
 * has booths, and everybody walks confidently to the wrong end of a building
 * four hundred metres long.
 *
 * The check is that the schedule names a hall twice, in among 27,467 events
 * that otherwise never do — `Exhibit Hall J : Booth #174` and `Exhibit Hall G`
 * with `Booth #2667`. Two points, at opposite ends, from a source that had no
 * part in writing this down.
 */

import { describe, expect, it } from 'vitest';
import { HALL_DIVIDES, boothIn, hallForBooth } from './booths';
import { EXHIBITORS } from './exhibitors';
import { ROOMS_BY_ID } from './venues';

describe('the divides themselves', () => {
  it('agrees with the two halls the schedule names', () => {
    // The whole guarantee. Read the other way round — I below the 500s rather
    // than above — booth 174 lands in Hall I, and the schedule says J.
    expect(hallForBooth(2667)).toBe('hall-g');
    // 174 is in the stretch that is J or K, so it has no hall here; what
    // matters is that it is *not* one of the halls the divides do place, which
    // is what a reversed table would make it.
    expect(hallForBooth(174)).toBeNull();
    expect(['hall-i', 'hall-h', 'hall-g', 'hall-f']).not.toContain(hallForBooth(174));
  });

  it('puts each wall between the two booths it was given as', () => {
    // Each divide, from both sides. A fencepost here moves a whole aisle into
    // the next hall and nothing else notices.
    expect([hallForBooth(599), hallForBooth(600)]).toEqual([null, 'hall-i']);
    expect([hallForBooth(1399), hallForBooth(1400)]).toEqual(['hall-i', 'hall-h']);
    expect([hallForBooth(2299), hallForBooth(2300)]).toEqual(['hall-h', 'hall-g']);
    // The only wall that falls inside an aisle rather than between two.
    expect([hallForBooth(2723), hallForBooth(2727)]).toEqual(['hall-g', 'hall-f']);
  });

  it('runs each hall the whole way to its wall', () => {
    // Sampled across each stretch rather than at its edges alone, so a divide
    // that stopped applying halfway through would show.
    expect([601, 900, 1229, 1399].map(hallForBooth)).toEqual(Array(4).fill('hall-i'));
    expect([1400, 1853, 2100, 2299].map(hallForBooth)).toEqual(Array(4).fill('hall-h'));
    expect([2300, 2500, 2667, 2723].map(hallForBooth)).toEqual(Array(4).fill('hall-g'));
    expect([2727, 2900, 3062].map(hallForBooth)).toEqual(Array(3).fill('hall-f'));
  });

  it('says nothing where the sources say nothing', () => {
    // 127 of the 573 stands are in the stretch that is J *or* K, and which is
    // not stated. A coin toss would send half of them to a hall a hundred
    // metres from their stand, and would look exactly like knowing.
    expect([100, 174, 350, 599].map(hallForBooth)).toEqual(Array(4).fill(null));
    const unplaced = EXHIBITORS.filter(
      (stand) => stand.area === 'Exhibit Hall' && stand.booth && !hallForBooth(stand.booth),
    );
    expect(unplaced.length).toBe(127);
    for (const stand of unplaced) expect(Number(stand.booth)).toBeLessThan(600);
  });

  it('names a real room for every hall it places', () => {
    // The ids are strings written by hand beside a set of numbers, and a room
    // id that no room has resolves to nothing, silently, for a whole hall.
    for (const { hall } of HALL_DIVIDES) {
      if (hall) expect(ROOMS_BY_ID[hall], hall).toBeDefined();
    }
    expect(HALL_DIVIDES.filter(({ hall }) => hall)).toHaveLength(4);
  });

  it('places every stand in the hall or in no hall, never off the end', () => {
    const halls = new Set(HALL_DIVIDES.map(({ hall }) => hall));
    for (const stand of EXHIBITORS) {
      if (stand.area !== 'Exhibit Hall' || !stand.booth) continue;
      expect(halls, `${stand.name} at ${stand.booth}`).toContain(hallForBooth(stand.booth));
    }
  });

  it('has nothing to say about what is not a booth number', () => {
    expect(hallForBooth(undefined)).toBeNull();
    expect(hallForBooth(null)).toBeNull();
    expect(hallForBooth('')).toBeNull();
    expect(hallForBooth('Authors Avenue')).toBeNull();
    // Below the grid: the stadium numbers its own halls 1 and 2.
    expect(hallForBooth(2)).toBeNull();
  });
});

describe('finding a booth number in what the source wrote', () => {
  it('reads the ways Gen Con writes one', () => {
    expect(boothIn('Exhibit Hall Booth #1229')).toBe('1229');
    expect(boothIn('Booth 2667')).toBe('2667');
    expect(boothIn('booth#403')).toBe('403');
  });

  it('does not take a room number for a stand', () => {
    // The convention centre numbers its meeting rooms in the same range the
    // exhibit hall numbers its aisles, so this has to be anchored on the word
    // rather than on the digits — otherwise Room 1229 becomes a stand in
    // Exhibit Hall I.
    expect(boothIn('Rm 1229')).toBeNull();
    expect(boothIn('Meeting Room 140')).toBeNull();
    expect(boothIn('Room 231-245')).toBeNull();
  });

  it('will not shorten a number that is not one of ours', () => {
    // The grid stops at 3062, so five digits after "Booth" is a mangled row
    // rather than a stand — and taking the first four of it invents a booth
    // that exists, in a hall, which is the worst kind of wrong.
    expect(boothIn('Booth 12345')).toBeNull();
    expect(boothIn('Booth 12')).toBeNull();
  });

  it('has nothing to say about a booth with no number', () => {
    // "Floor next to Hoosier Concourse Info Booth" is a real one.
    expect(boothIn('Floor next to Hoosier Concourse Info Booth')).toBeNull();
    expect(boothIn('Exhibit Hall')).toBeNull();
    expect(boothIn(undefined)).toBeNull();
  });
});
