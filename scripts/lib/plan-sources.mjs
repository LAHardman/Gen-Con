/**
 * Whether a plan build has everything it needs to write its output.
 *
 * `venue-plans.mjs` reads two kinds of sheet. The screenshots in `plans/venues/`
 * are committed; the campus sheets in `plans/campus/` are not — they are Gen
 * Con's own drawings and eighteen megabytes of them — so a fresh clone has none
 * until `npm run plans:campus` fetches them.
 *
 * A run without them still works. That is the problem. It writes a
 * `venue-plan.ts` that is well-formed, plausible and missing ten floors and the
 * convention centre's staircases, and nothing about the file says so. The only
 * symptoms are a building that stops changing floors and hotels no route can
 * reach — and by then the bad file is on disk and looks like the good one.
 *
 * So the run refuses rather than warning, and this is the decision, kept apart
 * from the script because the script fetches and writes on import and could not
 * otherwise be asked.
 */

/**
 * What the campus sheets are the only source of.
 *
 * Derived from the table rather than written down beside it, because a list
 * written down is a list that goes stale: this one said "six whole floors" for
 * as long as there were nine.
 */
export function campusOnlyFloors(campusSheets) {
  const floors = [];
  const stairs = [];
  for (const targets of Object.values(campusSheets ?? {})) {
    for (const target of targets ?? []) {
      const where = `${target.venueId} ${target.level}`;
      // A sheet read only for its staircases leaves the floor itself to the
      // building's own screenshot, so losing it loses the stairs and not the
      // floor. Worth saying separately: the two break different things.
      (target.verticalsOnly ? stairs : floors).push(where);
    }
  }
  return { floors: [...new Set(floors)].sort(), stairs: [...new Set(stairs)].sort() };
}

/**
 * Why this run may not write, or `null` if it may.
 *
 * `allowed` is the escape hatch — somebody rebuilding only the hotel
 * screenshots, who knows what they are leaving out and means to. It has to be
 * asked for explicitly, because the whole point is that the damage is invisible
 * to anyone who did not.
 */
export function refuseToWrite({ campusFiles, allowed = false, campusSheets }) {
  if (allowed) return null;
  if (campusFiles && campusFiles.length > 0) return null;

  const { floors, stairs } = campusOnlyFloors(campusSheets);
  const lines = [
    'plans/campus/ is empty, so this run would write a venue-plan.ts missing',
    `${floors.length} floors and the stairs of ${stairs.length} more — a file that looks`,
    'perfectly healthy and cannot route into half the hotels.',
    '',
    ...floors.map((where) => `  no floor at all   ${where}`),
    ...stairs.map((where) => `  no stairs         ${where}`),
    '',
    'Run `npm run plans:campus` first. To build without them anyway, and get',
    'that file on purpose, pass --without-campus.',
  ];
  return lines.join('\n');
}
