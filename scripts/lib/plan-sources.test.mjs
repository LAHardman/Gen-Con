/**
 * Whether a plan build may write.
 *
 * The failure this exists for is the quietest one in the repository, because
 * its output is a *valid file*. `plans/campus/` is gitignored — Gen Con's own
 * drawings, eighteen megabytes — so a fresh clone has none, and a rebuild
 * without them wrote a `venue-plan.ts` that parsed, type-checked, rendered, and
 * was missing ten floors and the convention centre's staircases. Nothing said
 * so. The symptoms arrive much later and somewhere else: a building that stops
 * changing floors, hotels no route can reach.
 *
 * It warned. A warning scrolls past in a build log.
 */

import { describe, expect, it } from 'vitest';
import { campusOnlyFloors, refuseToWrite } from './plan-sources.mjs';

/** The shape of `CAMPUS_SHEETS`: one sheet, one or more things read off it. */
const SHEETS = {
  'level-1': [
    { venueId: 'icc', level: 'Level 1', verticalsOnly: true },
    { venueId: 'jw-marriott', level: '1st floor' },
    { venueId: 'hyatt', level: '1st floor' },
  ],
  'level-2': [
    { venueId: 'icc', level: 'Level 2', verticalsOnly: true },
    { venueId: 'jw-marriott', level: '2nd floor' },
  ],
};

describe('what the campus sheets are the only source of', () => {
  it('separates a floor that would vanish from stairs that would', () => {
    // Not the same loss. A sheet read only for its staircases leaves the floor
    // to the building's own screenshot, so losing it strands the floors that
    // are there rather than removing them — and a route that cannot change
    // floor looks nothing like a building that isn't drawn.
    expect(campusOnlyFloors(SHEETS)).toEqual({
      floors: ['hyatt 1st floor', 'jw-marriott 1st floor', 'jw-marriott 2nd floor'],
      stairs: ['icc Level 1', 'icc Level 2'],
    });
  });

  it('reads the table rather than a list written beside it', () => {
    // The list in the old warning said "six whole floors" for as long as there
    // were nine. Anything derived from the table cannot drift from it.
    const grown = { ...SHEETS, 'level-3': [{ venueId: 'jw-marriott', level: '3rd floor' }] };
    expect(campusOnlyFloors(grown).floors).toContain('jw-marriott 3rd floor');
    expect(campusOnlyFloors(grown).floors.length).toBe(campusOnlyFloors(SHEETS).floors.length + 1);
  });

  it('counts a floor once however many sheets mention it', () => {
    const twice = { a: [{ venueId: 'hyatt', level: '1st floor' }], b: [{ venueId: 'hyatt', level: '1st floor' }] };
    expect(campusOnlyFloors(twice).floors).toEqual(['hyatt 1st floor']);
  });

  it('says nothing about a table that is empty or absent', () => {
    expect(campusOnlyFloors({})).toEqual({ floors: [], stairs: [] });
    expect(campusOnlyFloors(undefined)).toEqual({ floors: [], stairs: [] });
  });
});

describe('whether the run may write', () => {
  it('lets a run with the sheets through', () => {
    expect(
      refuseToWrite({ campusFiles: ['level-1.png', 'level-2.png'], campusSheets: SHEETS }),
    ).toBeNull();
  });

  it('stops a run without them', () => {
    // The whole point. Before this, the run finished, reported success, and
    // left the bad file where the good one had been.
    expect(refuseToWrite({ campusFiles: [], campusSheets: SHEETS })).not.toBeNull();
  });

  it('stops a run that could not even look', () => {
    // No directory at all is the fresh-clone case, and the commonest one.
    expect(refuseToWrite({ campusFiles: undefined, campusSheets: SHEETS })).not.toBeNull();
  });

  it('names what would be missing, so the message is worth reading', () => {
    // A refusal that only says "something is wrong" gets worked around. This
    // one has to say what you would lose and how to get it.
    const refusal = refuseToWrite({ campusFiles: [], campusSheets: SHEETS });
    expect(refusal).toContain('jw-marriott 2nd floor');
    expect(refusal).toContain('icc Level 2');
    expect(refusal).toContain('npm run plans:campus');
    expect(refusal).toContain('--without-campus');
  });

  it('lets somebody through who asked for it in so many words', () => {
    // Rebuilding only the hotel screenshots is a real thing to want. It just
    // has to be said out loud, because the damage is invisible to anyone who
    // did not mean it.
    expect(refuseToWrite({ campusFiles: [], allowed: true, campusSheets: SHEETS })).toBeNull();
  });
});
