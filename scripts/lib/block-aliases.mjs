/**
 * Hand-written ties between Gen Con's hotel names and this app's hotels.
 *
 * WHY A TABLE RATHER THAN A BETTER MATCHER. The two sources name the same
 * buildings differently on purpose, and no rule reconciles them:
 *
 *     Gen Con                                 OpenStreetMap
 *     Hampton Inn Indianapolis Downtown       Hampton Inn Indianapolis Downtown
 *                                               Across from Circle Centre
 *     The Alexander Hotel                     The Alexander, Autograph Collection
 *     Sheraton Indianapolis City Center       Sheraton Indianapolis City Centre
 *     Staybridge Suites Indianapolis          Staybridge Suites
 *       City Centre
 *
 * A matcher loose enough to tie those also ties "Homewood Suites by Hilton
 * Indianapolis **Canal IUPUI**" to "Homewood Suites by Hilton
 * Indianapolis**-Downtown**", which are two different buildings a block apart,
 * only one of which Gen Con has booked. Loosening it until nothing is missed
 * guarantees something is wrong; the honest fix is to write down the handful of
 * answers a human has checked.
 *
 * WHAT A WRONG ENTRY COSTS, which is why every one carries its evidence:
 *
 *   - a wrong `placeId` prints Gen Con's rate on somebody else's hotel;
 *   - a missing tie both loses that rate *and* offers a block hotel as an
 *     alternative to the block, which is a comparison of the block with itself;
 *   - a wrong `NOT_IN_BLOCK` entry does the same thing the other way round.
 *
 * So each tie was checked against the street address in OpenStreetMap and
 * against Gen Con's own published distance, and the evidence is in the `why`.
 * Addresses were read from OSM on 2026-08-12.
 *
 * HOW TO ADD ONE. Run `node scripts/fetch-block-rates.mjs`. It prints every
 * block hotel it could not tie and every walkable hotel that looks like one.
 * Find the building — the address is the only reliable way — and add a line
 * here. `null` is a real answer: it means Gen Con lists the hotel and this
 * app's inventory does not have it, which is common, because the hotel list is
 * a capped sample of OpenStreetMap rather than everything.
 */

/**
 * Gen Con's name for a hotel → the id in `src/data/lodging.ts`.
 *
 * `placeId: null` means "checked, and this app does not have that building".
 * That is not the same as leaving the hotel out of this table, which means
 * "nobody has looked yet" and lets the matcher guess.
 */
export const TIES = {
  /* ---------------------------------------------------------- downtown campus */

  'Bottleworks Hotel': {
    placeId: 'node14077761226',
    why: '850 Massachusetts Avenue. Outside the walk ring, which is the only pool downtown entries are matched against.',
  },
  'Candlewood Suites Indianapolis Downtown': {
    placeId: 'way212705933',
    why: '1150 North White River Parkway West Drive. OSM adds "Medical Dist"; Gen Con does not.',
  },
  'Columbia Club': {
    placeId: null,
    why: 'A private club on Monument Circle that lets rooms. OpenStreetMap does not tag it as lodging, so this app has no such place.',
  },
  'Hampton Inn Indianapolis Downtown': {
    placeId: 'way341313470',
    why: '105 South Meridian Street — OSM calls it "Across from Circle Centre", which is where Gen Con\'s "2 Blocks" puts it. Not the Canal IUPUI Hampton, which Gen Con lists separately.',
  },
  'Hotel Indy': {
    placeId: 'way341041832',
    why: '141 East Washington Street. OSM keeps the full "Hotel Indy, Indianapolis, A Tribute Portfolio Hotel".',
  },
  'Sheraton Indianapolis City Center Hotel': {
    placeId: 'way339985751',
    why: '31 West Ohio Street. Center and Centre, the same building.',
  },
  'Sleep Inn & Suites Downtown': {
    placeId: null,
    why: 'Gen Con puts it 2.3 miles out; no such hotel is in this app\'s sample of OpenStreetMap.',
  },
  'Staybridge Suites Indianapolis City Centre': {
    placeId: 'way199297626',
    why: '535 South West Street. OSM records the brand and drops the rest.',
  },
  'The Alexander Hotel': {
    placeId: 'way341317948',
    why: '333 South Delaware Street, OSM\'s "The Alexander, Autograph Collection".',
  },

  /* ------------------------------------------------------- west side / airport */

  'Candlewood Suites Indianapolis Airport': {
    placeId: 'way955435501',
    why: '5250 West Bradbury Avenue, postcode 46241 — the airport. The only untied Candlewood on that side.',
  },
  'Comfort Inn Indianapolis Airport - Plainfield': {
    placeId: 'way240444551',
    why: '6107 Cambridge Way, Plainfield. OSM names it "Comfort Inn Airport" and puts the town in the address rather than the name.',
  },
  'Courtyard by Marriott Indianapolis Airport': {
    placeId: null,
    why: 'Exists in OpenStreetMap at 2602 Fortune Circle East, but fell outside this app\'s capped hotel sample.',
  },
  'Embassy Suites by Hilton Airport-Plainfield': {
    placeId: 'way1043308091',
    why: '6089 Clarks Creek Road, Plainfield. The only Embassy Suites in that town.',
  },
  'Home2 Suites by Hilton Indianapolis Airport': {
    placeId: 'way1050619821',
    why: '8345 Belfast Drive, postcode 46241 — the same airport postcode as the block\'s La Quinta and Candlewood. The other two untied Home2s are 46237 (south) and 46268 (northwest).',
  },
  'Home2 Suites by Hilton Indianapolis Brownsburg': {
    placeId: null,
    why: 'No Home2 Suites in Brownsburg is in this app\'s sample; the nearest untied one is in Carmel, the other side of the city.',
  },
  'LaQuinta by Wyndham Indianapolis Airport - Executive Drive': {
    placeId: null,
    why: 'Deliberately untied. The nearest candidate is at 5316 West Southern Avenue and OSM names it "Airport Lynhurst"; Gen Con says Executive Drive. Two airport La Quintas have existed, and putting a $109 block rate on the wrong one is worse than leaving it out.',
  },
  'Residence Inn by Marriott Indianapolis Plainfield': {
    placeId: null,
    why: 'No Residence Inn in Plainfield is in this app\'s sample — the untied ones are Northwest, South/Greenwood, Fishers and Carmel.',
  },

  /* --------------------------------------------------------------- east side */

  'Baymont by Wyndham Indianapolis - Brookville Crossing': {
    placeId: 'way644548597',
    why: '1540 Brookville Crossing Way. OSM names it plain "Baymont Indianapolis"; the street settles it.',
  },
  'Delta Hotels Indianapolis East': {
    placeId: null,
    why: 'The only Delta Hotels within forty kilometres of the hall is the airport one, which Gen Con lists separately.',
  },

  /* -------------------------------------------------------------- north side */

  'Best Western Plus Indianapolis NW': {
    placeId: 'way511357813',
    why: '9320 Michigan Road — the northwest corridor. OSM leaves the name as bare "Best Western Plus"; the other two are Greenwood and Plainfield.',
  },
};

/**
 * Hotels that look like block entries and are not.
 *
 * The generator casts a wide net for walkable hotels it could not tie, so that
 * a probable block hotel is never offered as an alternative *outside* the
 * block. The net catches these two on a single shared word, and both are real
 * hotels Gen Con has not booked, so being cautious about them costs the
 * comparison two of the very few alternatives downtown has.
 */
export const NOT_IN_BLOCK = {
  relation4821152: 'Oakwood at Canal Square, 359 North West Street — serviced apartments, on no Gen Con list. Caught on the word "canal".',
  way341313486:
    'Homewood Suites by Hilton Indianapolis-Downtown, 201 South Meridian Street. Gen Con books the *other* Homewood, at Canal IUPUI. Caught on the word "homewood".',
};

/**
 * Check the table against the page and the hotel list, and say what is wrong.
 *
 * A stale alias is silent by nature: Gen Con renames a hotel, the key stops
 * matching, and the tie quietly stops being applied. So the generator refuses
 * to run on a table that no longer describes reality.
 */
export function auditAliases(blockNames, placeIds, ties = TIES, excused = NOT_IN_BLOCK) {
  const names = new Set(blockNames);
  const places = new Set(placeIds);
  const problems = [];

  for (const [blockName, tie] of Object.entries(ties)) {
    if (!names.has(blockName)) {
      problems.push(`no hotel called ${JSON.stringify(blockName)} in the block any more`);
    } else if (tie.placeId && !places.has(tie.placeId)) {
      problems.push(`${blockName} points at ${tie.placeId}, which is not in the hotel list`);
    }
  }

  for (const placeId of Object.keys(excused)) {
    if (!places.has(placeId)) {
      problems.push(`${placeId} is excused from the block but is not in the hotel list`);
    }
  }

  // One building cannot be two hotels, and the symptom of thinking otherwise is
  // a rate on the wrong roof rather than an error anybody would see.
  const claimed = new Map();
  for (const [blockName, tie] of Object.entries(ties)) {
    if (!tie.placeId) continue;
    if (claimed.has(tie.placeId)) {
      problems.push(`${tie.placeId} is claimed by both ${claimed.get(tie.placeId)} and ${blockName}`);
    }
    claimed.set(tie.placeId, blockName);
  }

  // A hotel cannot be both in the block and excused from it.
  for (const [blockName, tie] of Object.entries(ties)) {
    if (tie.placeId && excused[tie.placeId]) {
      problems.push(`${tie.placeId} is tied to ${blockName} and excused from the block at the same time`);
    }
  }

  return problems;
}
