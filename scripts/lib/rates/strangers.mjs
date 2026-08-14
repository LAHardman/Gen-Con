/**
 * Places the price search found that OpenStreetMap does not have.
 *
 * A search for "hotels near Indiana Convention Center" answers with more than
 * hotels: whole flats, condos, lofts and rooms let by the night, which for a
 * convention where people travel four to a room are often the cheapest way to
 * sleep near the hall. It also answers with hotels that the OSM pull simply
 * missed — Le Méridien, the Sheraton City Centre and the InterContinental all
 * came back priced in the first real response and matched nothing.
 *
 * All of it was being thrown away. These are real places, positioned and
 * priced, and the question the page exists to answer is "where could I stay".
 *
 * KEPT SEPARATE FROM `lodging.ts`, DELIBERATELY. That file is OpenStreetMap's,
 * under ODbL, and it is a survey: somebody stood there. This is a booking
 * product — one listing, which may be one flat in a block of forty, may vanish
 * next week, and may be the same building as the listing beside it under a
 * different name. Mixing the two would launder the second into the first and
 * lose the only thing that lets a reader judge them differently.
 *
 * THE RULES, all of which refuse rather than guess:
 *
 *   Within eighty metres of a hotel we already have → dropped. That is the same
 *   `SAME_BUILDING_M` the matcher uses, and at that range it is the same
 *   building under another name, not a new place.
 *
 *   Two listings with the same name → the cheaper. A search answers per rate
 *   plan, so one flat arrives three times.
 *
 *   Beyond the drive ring → dropped. Nobody is commuting from there.
 */

const METRES_PER_DEGREE_LAT = 111_320;

/** The same radius the price matcher calls one building. */
export const SAME_BUILDING_M = 80;

/** Two listings this close with different names are two flats in one block. */
export const SAME_DOOR_M = 12;

function metresApart(a, b) {
  const R = 6_371_000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * What Google calls it, in the vocabulary `lodging.ts` already uses.
 *
 * Anything let by the night that is not a hotel is a `rental`, because the
 * distinction a reader cares about is "is this a front desk or somebody's
 * flat", not which of eleven words the listing chose.
 */
export function kindOf(type) {
  const said = String(type ?? '').toLowerCase();
  if (!said) return 'rental';
  if (said.includes('hotel')) return 'hotel';
  if (said.includes('motel')) return 'motel';
  if (said.includes('hostel')) return 'hostel';
  if (said.includes('resort')) return 'hotel';
  return 'rental';
}

/**
 * Turn what the searches saw into places, refusing everything doubtful.
 *
 * `hall` is the convention centre, `known` the hotels already listed. Returns
 * the keepers and a count of what each rule turned away, because a rule that
 * quietly drops ninety per cent of the input is one somebody should see.
 */
export function placesFromStrangers({ strangers, known, hall, driveMetres }) {
  const why = { tooFar: 0, alreadyKnown: 0, sameDoor: 0, cheaper: 0 };
  const kept = new Map();

  // Cheapest first, so a duplicate name or door keeps the better price.
  const order = [...strangers].sort((a, b) => a.nightly - b.nightly);

  for (const one of order) {
    const metres = Math.round(metresApart(hall, one));
    if (metres > driveMetres) {
      why.tooFar += 1;
      continue;
    }
    if (known.some((place) => metresApart(place, one) <= SAME_BUILDING_M)) {
      why.alreadyKnown += 1;
      continue;
    }

    const name = String(one.name).trim();
    if (kept.has(name)) {
      why.cheaper += 1;
      continue;
    }
    /*
     * Two names at one doorway is one building let twice over. Kept as one
     * place rather than two, because a reader scanning a list wants somewhere
     * to sleep, not a catalogue of that building's rate plans.
     */
    const atSameDoor = [...kept.values()].some((place) => metresApart(place, one) <= SAME_DOOR_M);
    if (atSameDoor) {
      why.sameDoor += 1;
      continue;
    }

    kept.set(name, {
      // Stable across runs, and visibly not an OSM id, which it must never be
      // mistaken for: nothing here was surveyed.
      id: `serp:${slug(name)}`,
      name,
      kind: kindOf(one.kind),
      metres,
      ring: metres <= 1600 ? 'walk' : 'drive',
      lat: Number(one.lat.toFixed(6)),
      lng: Number(one.lng.toFixed(6)),
      nightly: one.nightly,
      city: one.town ?? '',
    });
  }

  return { places: [...kept.values()].sort((a, b) => a.metres - b.metres), why };
}

/**
 * Everything found so far, with this month's answers replacing last month's.
 *
 * Listings are gathered from whatever the searches happened to return, and a
 * run with a small allowance returns almost nothing — so rebuilding the file
 * from one run's findings deletes every place the runs before it found. That
 * is not a hypothetical: a top-up run with three searches left produced three
 * listings, and would have dropped the other three hundred and thirty.
 *
 * So they accumulate, like the quotes do. A place seen again takes its newer
 * price, because a fresher number is the more truthful one — which is the
 * opposite of the cheapest-wins rule inside a single response, where the
 * duplicates are room types rather than months.
 *
 * The doorway rule is then applied across the union, since a listing kept last
 * month and a differently-named one kept this month can be the same building.
 */
export function keepFound(previous, fresh) {
  const byId = new Map(previous.map((one) => [one.id, one]));
  for (const one of fresh) byId.set(one.id, one);

  const kept = [];
  for (const one of [...byId.values()].sort((a, b) => a.metres - b.metres)) {
    if (kept.some((other) => metresApart(other, one) <= SAME_DOOR_M)) continue;
    kept.push(one);
  }
  return kept;
}

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
