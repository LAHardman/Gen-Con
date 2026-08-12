/**
 * Where each food truck and stand stands on the closed street.
 *
 *     node scripts/place-block-party.mjs
 *
 * Writes src/data/block-party.ts.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. Gen Con numbers its Block Party pitches —
 * Food Truck 1 to 30 down one side, Booth BP1 to BP15 down the other — and
 * `exhibitors.ts` carries which trader is in which. What no source here has is a
 * survey of where pitch 17 actually is. So these positions are **derived, not
 * measured**: the order is Gen Con's and the spacing is this app's, laid evenly
 * along the kerbs of the street OpenStreetMap surveyed.
 *
 * That is worth doing and worth saying. A row of thirty trucks down a 310-metre
 * street in numbered order is a real fact about the street, and it makes "which
 * end is Arepas at" answerable to within a few metres, which is the question.
 * It is not a claim that a given truck is on a given paving slab, and the app
 * says so where it draws them.
 *
 * The check on it is arithmetic that has to come out: thirty pitches over the
 * north kerb is 10.3 m each, and a food truck with its serving side is about
 * nine. If a future year's list no longer fits the street this refuses to write.
 */

import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/data/block-party.ts');

/** Metres a pitch needs. A food truck with its serving side is about nine. */
const PITCH = 9;
/** Metres in from the kerb, so a mark sits in the street rather than on a wall. */
const INSET = 4;

const METRES_PER_DEGREE_LAT = 111320;

async function load(entry) {
  const file = join(tmpdir(), `block-party-${process.pid}-${Math.abs(entry.length)}.mjs`);
  await build({
    entryPoints: [join(ROOT, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: file,
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(file).href);
  await rm(file, { force: true });
  return mod;
}

const { VENUES_BY_ID } = await load('src/data/venues.ts');
const { EXHIBITORS } = await load('src/data/exhibitors.ts');

const street = VENUES_BY_ID['block-party'];
if (!street) throw new Error('there is no block-party venue any more');

const ring = street.footprint;
const perLng = METRES_PER_DEGREE_LAT * Math.cos((ring[0][0] * Math.PI) / 180);
const east = (lng) => lng * perLng;
const north = (lat) => lat * METRES_PER_DEGREE_LAT;

/*
 * The ring is the two kerbs nose to tail: north kerb west to east, then back
 * along the south. Split it where the walk turns round, which is the one point
 * where the eastings stop rising.
 */
let turn = 1;
for (let i = 1; i < ring.length; i += 1) {
  // Not "starts going west" — the two kerbs are joined by the end of the
  // street, which runs straight across and changes no easting at all. The turn
  // is where the eastings stop rising, not where they start falling.
  if (ring[i][1] <= ring[i - 1][1]) {
    turn = i;
    break;
  }
}

/*
 * The ends of the street are not kerb, and nothing parks on them.
 *
 * Each end is one segment across the carriageway — 27 m of latitude and no
 * easting — and walking a row of pitches along the ring without dropping them
 * puts the last two trucks side-on across South Capitol Avenue. A leg that
 * travels under two metres east or west is an end, not a kerb.
 */
const ALONG = 2;
const kerbOnly = (points) => {
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    if (Math.abs(east(points[i][1]) - east(out[out.length - 1][1])) < ALONG) continue;
    out.push(points[i]);
  }
  return out;
};

const north0 = kerbOnly(ring.slice(0, turn + 1));
const south0 = kerbOnly(ring.slice(turn));
if (north0.length < 3 || south0.length < 3) throw new Error('the street ring is not two kerbs');

/** A kerb's total length, and a point a given distance along it. */
function walk(points) {
  const legs = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = east(points[i][1]) - east(points[i - 1][1]);
    const dy = north(points[i][0]) - north(points[i - 1][0]);
    const len = Math.hypot(dx, dy);
    legs.push({ from: points[i - 1], to: points[i], len, dx, dy });
    total += len;
  }
  return {
    total,
    at(distance, inset) {
      let left = Math.max(0, Math.min(total, distance));
      for (const leg of legs) {
        if (left > leg.len && leg !== legs[legs.length - 1]) {
          left -= leg.len;
          continue;
        }
        const t = leg.len === 0 ? 0 : left / leg.len;
        const lat = leg.from[0] + (leg.to[0] - leg.from[0]) * t;
        const lng = leg.from[1] + (leg.to[1] - leg.from[1]) * t;
        /*
         * A quarter turn to the *right* of the walk, which is the middle of the
         * street on both kerbs: the ring runs west along the north side and
         * back east along the south, so a left turn puts a truck on the
         * pavement on one side and in the stadium car park on the other.
         */
        const nx = leg.len === 0 ? 0 : leg.dy / leg.len;
        const ny = leg.len === 0 ? 0 : -leg.dx / leg.len;
        return [
          Number((lat + (ny * inset) / METRES_PER_DEGREE_LAT).toFixed(6)),
          Number((lng + (nx * inset) / perLng).toFixed(6)),
        ];
      }
      return [leg0(points)[0], leg0(points)[1]];
    },
  };
}
const leg0 = (points) => points[0];

const kerbs = { north: walk(north0), south: walk(south0) };

const pitches = EXHIBITORS.filter((one) => one.area === 'Block Party' && one.booth);
const trucks = pitches
  .filter((one) => /Food Truck/i.test(one.spot))
  .sort((a, b) => Number(a.booth) - Number(b.booth));
const stands = pitches
  .filter((one) => !/Food Truck/i.test(one.spot))
  .sort((a, b) => Number(a.booth.replace(/\D/g, '')) - Number(b.booth.replace(/\D/g, '')));

console.error(`${trucks.length} food trucks and ${stands.length} stands`);
console.error(
  `north kerb ${Math.round(kerbs.north.total)} m, south kerb ${Math.round(kerbs.south.total)} m`,
);

for (const [side, list] of [
  ['north', trucks],
  ['south', stands],
]) {
  const each = kerbs[side].total / list.length;
  console.error(`  ${side}: ${each.toFixed(1)} m a pitch`);
  if (each < PITCH) {
    throw new Error(
      `${list.length} pitches on the ${side} kerb is ${each.toFixed(1)} m each, under the ${PITCH} m one needs — refusing to write`,
    );
  }
}

/*
 * The trucks run west to east, the stands run back east to west, because the
 * ring does — and Gen Con numbers both from the Missouri Street end, which is
 * the west. So the stands are walked backwards along their own kerb.
 */
const placed = [
  ...trucks.map((one, i) => {
    const each = kerbs.north.total / trucks.length;
    const [lat, lng] = kerbs.north.at(each * (i + 0.5), INSET);
    return { spot: one.spot, booth: one.booth, name: one.name, side: 'north', lat, lng };
  }),
  ...stands.map((one, i) => {
    const each = kerbs.south.total / stands.length;
    const [lat, lng] = kerbs.south.at(kerbs.south.total - each * (i + 0.5), INSET);
    return { spot: one.spot, booth: one.booth, name: one.name, side: 'south', lat, lng };
  }),
];

writeFileSync(
  OUT,
  `/**
 * The Block Party's pitches, placed along the street. GENERATED — do not edit.
 *
 * Run \`node scripts/place-block-party.mjs\` to rebuild this.
 *
 * **These positions are derived, not surveyed.** Gen Con numbers its pitches —
 * Food Truck 1 to ${trucks.length} down the north side, ${stands.length} stands down the south — and
 * \`exhibitors.ts\` says who is in which. Nothing here has a survey of where a
 * given pitch stands, so the order is Gen Con's and the spacing is this app's,
 * laid evenly along the kerbs of the street as OpenStreetMap surveyed it:
 * ${(kerbs.north.total / trucks.length).toFixed(1)} m a truck and ${(kerbs.south.total / stands.length).toFixed(1)} m a stand, ${INSET} m in from the kerb.
 *
 * So "which end of the street is this one at" is answerable to within a few
 * metres, and "which paving slab" is not. The map says as much where it draws
 * them.
 *
 * © OpenStreetMap contributors, ODbL, for the street.
 */

export interface Pitch {
  /** Gen Con's own name for the pitch: 'Food Truck 12', 'Booth BP5'. */
  spot: string;
  /** Its number within the Block Party. */
  booth: string;
  /** Who was in it when the exhibitor list was last pulled. */
  name: string;
  /** Which kerb it stands against. */
  side: 'north' | 'south';
  lat: number;
  lng: number;
}

/** Spacing, in metres, so the page can say how rough this is. */
export const TRUCK_PITCH_METRES = ${(kerbs.north.total / trucks.length).toFixed(1)};

export const PITCHES: ReadonlyArray<Pitch> = [
${placed
  .map(
    (one) =>
      `  { spot: ${JSON.stringify(one.spot)}, booth: ${JSON.stringify(one.booth)}, name: ${JSON.stringify(one.name)}, side: '${one.side}', lat: ${one.lat}, lng: ${one.lng} },`,
  )
  .join('\n')}
];
`,
  'utf8',
);
console.error(`wrote ${OUT}: ${placed.length} pitches`);
