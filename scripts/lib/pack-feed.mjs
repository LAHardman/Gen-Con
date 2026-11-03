/**
 * The feed, as columns with the repetition taken out.
 *
 * A schedule written as 27,467 objects is mostly the same few strings over and
 * over: five distinct age requirements cost 0.85 MB, 22 buildings cost 0.62 MB,
 * and the 1,076 distinct start times cost 0.99 MB because each is written out
 * as a 25-character timestamp every time it occurs. The field *names* are
 * repeated 27,467 times too.
 *
 * So each repetitive field becomes a table of its distinct values and a column
 * of indexes into it, and each non-repetitive one becomes a plain column. That
 * is 8.87 MB down to 2.03 MB on disk and 0.99 MB down to 0.48 MB over the wire.
 * The remaining 0.80 MB is the titles, which are nearly all distinct and are
 * the actual payload — this is close to the floor without dropping information.
 *
 * Worth it because the file is stored on a phone, and downloaded over
 * convention wifi, which is the worst network anybody will use this on.
 *
 * `expandFeed` in `src/data/events.ts` is the other half, and reads both this
 * and the old shape — a phone with the old one cached must keep working.
 */
export function pack(events, source, roomOf) {
  const DICT = ['idPrefix', 'type', 'gameSystem', 'locationText', 'roomText', 'tableText', 'start', 'end', 'ageRequirement', 'durationMinutes', 'roomId'];
  const of = (event, field) => {
    if (field === 'idPrefix') return event.id.replace(/[0-9]+$/, '');
    // Worked out here rather than on the phone. See the note by `roomId` below.
    if (field === 'roomId') return roomOf(event) ?? undefined;
    return event[field];
  };
  const keys = {};
  const lookup = {};
  for (const field of DICT) {
    const seen = [...new Set(events.map((e) => of(e, field)).filter((v) => v !== undefined && v !== ''))].sort();
    keys[field] = seen;
    lookup[field] = new Map(seen.map((v, i) => [v, i]));
  }
  const column = (field) => events.map((e) => {
    const value = of(e, field);
    return value === undefined || value === '' ? -1 : lookup[field].get(value);
  });
  return {
    // Named so the reader can tell the two apart without guessing, and so a
    // third shape later is a version bump rather than an archaeology problem.
    format: 'columns-2',
    source,
    year: Number(events[0].start.slice(0, 4)),
    count: events.length,
    keys,
    columns: {
      ...Object.fromEntries(DICT.map((field) => [field, column(field)])),
      // The number off the end of the id; its prefix is in the dictionary.
      idNumber: events.map((e) => Number(/[0-9]+$/.exec(e.id)?.[0] ?? 0)),
      title: events.map((e) => e.title),
      cost: events.map((e) => e.cost ?? null),
      ticketsAvailable: events.map((e) => e.ticketsAvailable ?? null),
    },
  };
}
