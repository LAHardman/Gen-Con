#!/usr/bin/env node
/**
 * Writes a small, obviously-fake schedule to public/events.json.
 *
 * This exists so the schedule UI can be seen and tested without network access,
 * and so the app has something to show before `npm run fetch:events` has been
 * run against the real source. Every event is tagged so it can never be mistaken
 * for real programming.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'public/events.json');

/** Gen Con Indy runs Thursday to Sunday. */
const DAYS = ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'];
const OFFSET = '-04:00';

const LOCATIONS = [
  { location: 'Exhibit Hall J', type: 'BGM', titles: ['Open Gaming Library Pickup', 'Learn to Play: Everdeep', 'Board Game Speed Dating'] },
  { location: 'Exhibit Hall A', type: 'EXH', titles: ['Exhibit Hall Opens', 'Publisher Signing Hour'] },
  { location: 'Sagamore Ballroom', type: 'SEM', titles: ['Industry Keynote', 'Designing Your First Game', 'True Dungeon Briefing'] },
  { location: 'Wabash Ballroom', type: 'ENT', titles: ['Costume Contest', 'Live Podcast Recording'] },
  { location: 'Meeting Room 203', type: 'RPG', titles: ['Curse of the Crimson Vault', 'One-Shot: Salvage Run', 'Delve: The Undercity'] },
  { location: 'Meeting Room 238', type: 'RPG', titles: ['Campaign Session: Ashfall', 'Mystery at Miller Manor'] },
  { location: 'Meeting Room 104', type: 'SEM', titles: ['GM Techniques Workshop', 'Running Horror at the Table'] },
  { location: 'Lucas Oil Stadium', type: 'MIN', titles: ['Grand Melee: 200 Player Battle', 'Open Miniatures Tables'] },
  { location: 'JW Marriott Indianapolis', type: 'RPG', titles: ['Society Special: Deep Roads', 'Beginner Box Table'] },
  { location: 'Exhibit Hall K', type: 'KID', titles: ['Family Game Hour', 'Kids Dice Painting'] },
  { location: 'Westin Indianapolis', type: 'TCG', titles: ['Draft Pod', 'Constructed Side Event'] },
  { location: '500 Ballroom', type: 'WKS', titles: ['Author Reading', 'Worldbuilding Workshop'] },
];

const START_HOURS = [9, 11, 13, 15, 17, 19, 21];

/**
 * Formats an instant as an ISO string in convention local time (UTC-04:00),
 * not UTC — the app reads the wall-clock time out of these strings so that
 * "10am" means 10am in Indianapolis regardless of where it's being viewed.
 */
function toConventionIso(ms) {
  const asLocalFields = new Date(ms - 4 * 60 * 60 * 1000);
  return `${asLocalFields.toISOString().slice(0, 19)}${OFFSET}`;
}

const events = [];
let counter = 0;

for (const day of DAYS) {
  for (const spot of LOCATIONS) {
    for (let slot = 0; slot < START_HOURS.length; slot += 1) {
      // Vary which slots each location uses so the schedule isn't a solid grid.
      if ((slot + spot.location.length) % 3 === 0) continue;

      const hour = START_HOURS[slot];
      const title = spot.titles[(slot + DAYS.indexOf(day)) % spot.titles.length];
      const durationMinutes = spot.type === 'RPG' ? 240 : 120;
      const startMs = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00${OFFSET}`);
      counter += 1;

      events.push({
        id: `SAMPLE${String(counter).padStart(4, '0')}`,
        title: `${title} [sample data]`,
        type: spot.type,
        locationText: spot.location,
        tableText: spot.type === 'RPG' ? String((counter % 12) + 1) : undefined,
        start: toConventionIso(startMs),
        end: toConventionIso(startMs + durationMinutes * 60_000),
        durationMinutes,
        cost: spot.type === 'RPG' ? 6 : 0,
        ticketsAvailable: (counter * 7) % 40,
        url: 'https://gencon.eventdb.us/',
      });
    }
  }
}

const feed = {
  source: {
    name: 'Sample data (not from the Gen Con event database)',
    url: 'https://gencon.eventdb.us/',
    fetchedAt: new Date().toISOString(),
  },
  year: 2026,
  sample: true,
  events,
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(feed, null, 2)}\n`);
console.log(`Wrote ${events.length} sample events to ${OUTPUT}`);
console.log('Replace them with the real schedule using: npm run fetch:events');
