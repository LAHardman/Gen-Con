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
import { ACROSS_THE_AISLES, HALL_DIVIDES, boothIn, hallForBooth } from './booths';
import { EXHIBITORS } from './exhibitors';
import { ROOMS_BY_ID } from './venues';

describe('the divides themselves', () => {
  it('agrees with the two halls the schedule names', () => {
    // The whole guarantee, and both halves of it. Read the between-aisle walls
    // the other way round — I below the 500s rather than above — and booth 174
    // lands in Hall I. Read the cross wall the other way round and it lands in
    // Hall K. The schedule says J, and it is the only thing that says which of
    // J and K is the far side.
    expect(hallForBooth(2667)).toBe('hall-g');
    expect(hallForBooth(174)).toBe('hall-j');
  });

  it('puts each wall between the two booths it was given as', () => {
    // Each divide, from both sides. A fencepost here moves a whole aisle into
    // the next hall and nothing else notices.
    expect([hallForBooth(599), hallForBooth(600)]).toEqual(['hall-j', 'hall-i']);
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

  it('cuts the first stretch across its aisles rather than between them', () => {
    // The wall between J and K is a different shape from the other four: the
    // two halls are stacked at the same end of the building, so it crosses
    // every aisle from the 100s to the 500s and a booth's hall depends on how
    // far along its aisle it stands.
    //
    // The two places it was given as, from both sides:
    expect([hallForBooth(339), hallForBooth(331)]).toEqual(['hall-j', 'hall-k']);
    expect([hallForBooth(439), hallForBooth(429)]).toEqual(['hall-j', 'hall-k']);
    // ...and the same line holding across every other aisle in the stretch.
    expect([132, 234, 533, 175, 275, 575].map(hallForBooth)).toEqual(Array(6).fill('hall-j'));
    expect([100, 203, 315, 403, 501].map(hallForBooth)).toEqual(Array(5).fill('hall-k'));
  });

  it('leaves no stand in the first stretch unplaced', () => {
    const stretch = EXHIBITORS.filter(
      (stand) => stand.area === 'Exhibit Hall' && Number(stand.booth) < 600,
    );
    // A floor, not the count. Gen Con owns this number and it moves whenever an
    // exhibitor signs up or drops out — the scheduled refresh exists to pull
    // exactly that — so pinning it means a red build for a non-reason, and the
    // repair anyone reaches for is to bump the number, which is how a check
    // gets trained out of being read. What is worth asserting is that the
    // filter is not vacuous; the loop under it is the actual test.
    expect(stretch.length).toBeGreaterThan(100);
    for (const stand of stretch) {
      expect(['hall-j', 'hall-k'], `${stand.name} at ${stand.booth}`).toContain(
        hallForBooth(stand.booth),
      );
    }
  });

  it('names a real room for every hall it places', () => {
    // The ids are strings written by hand beside a set of numbers, and a room
    // id that no room has resolves to nothing, silently, for a whole hall.
    for (const { hall } of HALL_DIVIDES) {
      if (hall) expect(ROOMS_BY_ID[hall], hall).toBeDefined();
    }
    expect(HALL_DIVIDES.filter(({ hall }) => hall)).toHaveLength(4);
    expect(ROOMS_BY_ID[ACROSS_THE_AISLES.beyond]).toBeDefined();
    expect(ROOMS_BY_ID[ACROSS_THE_AISLES.before]).toBeDefined();
  });

  it('places every stand in a hall, never off the end', () => {
    const halls = new Set<string | null>([
      ...HALL_DIVIDES.map(({ hall }) => hall),
      ACROSS_THE_AISLES.beyond,
      ACROSS_THE_AISLES.before,
    ]);
    halls.delete(null);
    for (const stand of EXHIBITORS) {
      if (stand.area !== 'Exhibit Hall' || !stand.booth) continue;
      expect(halls, `${stand.name} at ${stand.booth}`).toContain(hallForBooth(stand.booth));
    }
  });

  it('draws every hall it fills as an exhibit hall', () => {
    // Halls J and K were drawn as gaming rooms and named for the programmes
    // somebody remembered being in them — "Open Gaming" and "Family Fun" —
    // and neither the schedule nor the stand list nor the printed plan says
    // either of those words anywhere. What the stand list does say is that
    // 127 trade stands are in that stretch, which is not what a hall of free
    // tables looks like. So the category is the check: a hall this table puts
    // booths in is an exhibit hall, in the legend and in the colour it is
    // drawn, whatever else also happens inside it.
    const filled = new Set(
      EXHIBITORS.filter((stand) => stand.area === 'Exhibit Hall')
        .map((stand) => hallForBooth(stand.booth))
        .filter((hall): hall is string => Boolean(hall)),
    );
    expect(filled.size).toBe(6);
    for (const hall of filled) expect(ROOMS_BY_ID[hall].category, hall).toBe('exhibit');
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
