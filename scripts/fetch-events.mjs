/**
 * The Gen Con schedule, from Gen Con.
 *
 *     node scripts/fetch-events.mjs
 *
 * Writes public/events.json, which is not committed — the deploy builds it.
 *
 * WHY THIS REPLACED A SCRAPER. The schedule used to come from
 * `gencon.eventdb.us`, a third-party site with no API, by fetching one HTML
 * page per event: 27,000 requests, hours of wall clock, a cache and a lock and
 * a resume protocol to make that survivable, and every field recovered by
 * parsing markup somebody else was free to restyle. It worked. It was also the
 * single most fragile thing in this repository, and it was one person's hobby
 * site standing between the app and its entire reason to exist.
 *
 * Gen Con publishes the same catalogue themselves, as JSON, at
 * `/api/event_search`. Every field this app wants is a named field on it —
 * including `location`, `room_name` and `table_number`, which is the whole of
 * what the room matcher needs and which the scraper had to pick back out of a
 * sentence.
 *
 * THE ONE OBSTACLE, and how it is got round. The endpoint pages 25 at a time
 * and stops at page 400 — a 10,000-record window, which is Elasticsearch's
 * default and not something a caller can raise. The catalogue is 27,467.
 *
 * `day[]` slices it, and the slices are exact: 191 + 8,046 + 8,241 + 7,805 +
 * 3,184 = 27,467, which is the number the unsliced query reports for the whole
 * catalogue. So five slices, each comfortably inside the window, add up to
 * everything with nothing double-counted and nothing missed — and that identity
 * is checked on every run rather than assumed, because it is exactly the sort of
 * thing that stops being true when a convention gets bigger.
 *
 * About 1,100 requests, against 27,000.
 *
 * THE PAGING AND THE MAPPING NOW LIVE IN `src/lib/import-events.ts`, because
 * a native shell runs the same import on the phone when this project's own
 * hosting can no longer answer, and two importers that agree until the day
 * they quietly don't is the failure this whole file is careful about. Node
 * strips the types, Vite compiles them; both callers really do run those
 * lines. What stays here is what only a build machine does: the CLI, the
 * column packing, and writing the file.
 */

import { mkdir, writeFile, stat } from 'node:fs/promises';
import {
  AGENT,
  PAUSE_MS as DEFAULT_PAUSE,
  importCatalogue,
} from '../src/lib/import-events.ts';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'public/events.json');

const SOURCE = {
  name: 'Gen Con event catalogue',
  url: 'https://www.gencon.com/events',
};

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const PAUSE_MS = Number(value('delay', DEFAULT_PAUSE));

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
function pack(events, source, roomOf) {
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

async function main() {
  const started = Date.now();
  let said = 0;

  // The shared importer does the paging, the shaping and the arithmetic that
  // proves the day slices still partition the catalogue. Everything it can
  // refuse, it refuses by throwing — a short schedule that looks complete is
  // the one answer nobody could detect.
  const { events: usable, expected } = await importCatalogue({
    fetchJson: async (url) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          const response = await fetch(url, { headers: { 'User-Agent': AGENT } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return { status: response.status, body: await response.json() };
        } catch (error) {
          if (attempt >= 4) throw error;
          // Backing off rather than hammering: a run of eleven hundred requests
          // will meet a blip, and a blip is not a reason to lose the whole pull.
          await new Promise((done) => setTimeout(done, 500 * 2 ** attempt));
        }
      }
    },
    pauseMs: PAUSE_MS,
    // Every thousand *crossed*, not every thousand landed on exactly: an
    // event skipped as a duplicate shifts the count off the round numbers
    // for good, and a progress line that then goes quiet for six minutes
    // looks exactly like a run that has hung.
    onProgress: ({ got, expected: all, day }) => {
      if (got < said + 1000) return;
      said = got - (got % 1000);
      console.log(`  day ${day}: ${said.toLocaleString('en')} of ${all.toLocaleString('en')}`);
    },
  });
  console.log(`the catalogue reports ${expected.toLocaleString('en')} events`);

  // Which room each event is in, decided here instead of 27,467 times on a
  // phone. The matcher is `events.ts`'s own and the room table is `venues.ts`'s
  // own, both from this same checkout — so the answer cannot drift from what
  // the app would have worked out itself, and the app still falls back to
  // computing it for any event that has none.
  const { roomIdForEvent } = await import(join(ROOT, 'src/data/events.ts'));
  const feed = pack(usable, { ...SOURCE, fetchedAt: new Date().toISOString() }, roomIdForEvent);
  const placed = feed.columns.roomId.filter((i) => i >= 0).length;
  console.log(`rooms worked out here rather than on the phone: ${placed.toLocaleString('en')} of ${usable.length.toLocaleString('en')}`);

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(feed)}\n`);
  const megabytes = ((await stat(OUTPUT)).size / 1024 / 1024).toFixed(1);
  console.log(
    `\nWrote ${usable.length.toLocaleString('en')} events to ${OUTPUT} (${megabytes} MB, columns-1) `
    + `in ${((Date.now() - started) / 1000).toFixed(0)}s`,
  );
}

// Run, unconditionally.
//
// There used to be a guard here — "only when invoked directly, not when
// imported for its `shape`" — and it could not survive the move to
// `vite-node`, which strips the script path out of `process.argv`
// altogether. A guard that silently answers false is the worst shape a bug
// can take: this fetched the whole catalogue and then exited 0 having
// written nothing. The mapping is tested where it now lives,
// `src/lib/import-events.ts`, so nothing needs to import this file any more
// and there is nothing left to guard against.
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
