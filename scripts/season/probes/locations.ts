/**
 * Does every event still land in a room?
 *
 * The room matcher fails by quietly returning null — an event with a
 * renamed room draws nothing, which looks exactly like an empty room. The
 * count of unmatched events is therefore the one number that says whether
 * this year's vocabulary still fits, and when it doesn't, the fix is an
 * alias in `venues.ts` — so each unmatched string arrives here with the
 * rooms it most resembles and the line to paste, rather than as a bare
 * complaint.
 *
 * The schedule read is the *published* one where possible: the live site's
 * `events.json` is what phones are actually being served, so checking it
 * checks the deploy as well as the matcher. A local `public/events.json`
 * (from `npm run fetch:events`) is used when no site is configured.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Probe, ProbeResult } from '../lib';
import { closest, withNetwork } from '../lib';
import { expandFeed, indexEvents, venueIdForEvent, type ConEvent } from '../../../src/data/events';
import { ROOMS, VENUES_BY_ID } from '../../../src/data/venues';

/** Where the deployed app lives; `SEASON_SITE` or derived from the repo in CI. */
export function siteUrl(): string | null {
  const explicit = (process.env.SEASON_SITE ?? '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo) {
    const [owner, name] = repo.split('/');
    return `https://${owner.toLowerCase()}.github.io/${name}`;
  }
  return null;
}

function suggestionsFor(event: ConEvent): string[] {
  const venueId = venueIdForEvent(event);
  const wanted = event.roomText ?? event.locationText;
  const pool = venueId ? ROOMS.filter((room) => room.venueId === venueId) : ROOMS;
  const best = closest(wanted, pool, (room) => [room.name, room.shortName ?? '', ...(room.aliases ?? [])]);
  if (!venueId) {
    return [
      `\`${event.locationText}\` matches no venue. A renamed building wants the new wording added to its entry in \`VENUES\` (src/data/venues.ts); a genuinely new venue is a new entry, with its footprint.`,
      ...(best.length
        ? [`Nearest rooms anywhere, for orientation: ${best.map((b) => `\`${b.candidate.id}\``).join(', ')}`]
        : []),
    ];
  }
  if (!best.length) {
    return [
      `\`${wanted}\` (in ${VENUES_BY_ID[venueId]?.name ?? venueId}) resembles no room there — possibly a new room; see the venue's block in \`ROOMS\` (src/data/venues.ts).`,
    ];
  }
  return [
    `\`${wanted}\` (in ${VENUES_BY_ID[venueId]?.name ?? venueId}) — likeliest rooms: ${best
      .map((b) => `\`${b.candidate.id}\``)
      .join(', ')}. If the first is right, add to its entry in src/data/venues.ts: \`aliases: [${JSON.stringify(wanted)}]\` (or append to the existing list).`,
  ];
}

function assess(raw: unknown, source: string): ProbeResult {
  // The sample schedule tags itself so it can never be mistaken for the real
  // one — and a matcher scored against invented rooms would fail everything.
  if ((raw as { sample?: boolean })?.sample) {
    return {
      status: 'skip',
      summary: `the schedule at ${source} is the deliberately-fake sample`,
      instructions: ['Run `npm run fetch:events` for a real schedule, or set `SEASON_SITE` to the deployed app.'],
    };
  }
  const feed = expandFeed(raw);
  const index = indexEvents(feed.events);
  if (!index.total) {
    return {
      status: 'skip',
      summary: `the schedule at ${source} is empty or a sample`,
      instructions: ['Run `npm run fetch:events` for a real schedule, or set `SEASON_SITE` to the deployed app.'],
    };
  }
  const unmatched = index.unmatched;
  const share = unmatched.length / index.total;
  if (share <= 0.005) {
    return {
      status: 'ok',
      summary: `${index.total.toLocaleString()} events read from ${source}; ${unmatched.length} without a room (${(share * 100).toFixed(2)}%), which is the healthy floor`,
    };
  }

  // Group the misses by their wording — one alias usually recovers hundreds.
  const byText = new Map<string, { count: number; example: ConEvent }>();
  for (const event of unmatched) {
    const key = `${event.locationText} : ${event.roomText ?? ''}`;
    const entry = byText.get(key);
    if (entry) entry.count += 1;
    else byText.set(key, { count: 1, example: event });
  }
  const worst = [...byText.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 15);

  return {
    status: 'fail',
    summary: `${unmatched.length.toLocaleString()} of ${index.total.toLocaleString()} events resolve to no room (${(share * 100).toFixed(1)}%) — the matcher's vocabulary is behind the schedule's`,
    details: worst.map(([key, { count }]) => `${count.toLocaleString()} events: ${key}`),
    repair: worst.flatMap(([, { example }]) => suggestionsFor(example)),
    instructions: [
      'Each alias added recovers every event that uses the wording; start from the biggest counts above.',
      'Then `npm run check` — `events.test.ts` runs the matcher over every distinct location string and holds the floor.',
      'A wording that names a building the map has never drawn is the yearly "new venue" case: docs/mobile.md §8 and the venue block in `venues.ts` are the path.',
    ],
  };
}

export const probe: Probe = {
  id: 'locations',
  title: 'Events landing in rooms',
  run: (ctx) => {
    const site = siteUrl();
    if (site) {
      return withNetwork(
        async () => {
          const { status, body } = await ctx.text(`${site}/events.json`);
          if (status === 200) return assess(JSON.parse(body), `${site}/events.json`);
          return {
            status: 'fail',
            summary: `the deployed schedule answered HTTP ${status} at ${site}/events.json`,
            instructions: [
              'If the site has moved, set the `SEASON_SITE` repository variable to its new address.',
              'If the deploy is broken, the Actions tab of the repository says which step; `deploy.yml` builds and publishes it weekly.',
            ],
          };
        },
        {
          summary: `${site} was unreachable from here`,
          instructions: ['Re-run `npm run season:check` somewhere that can reach the deployed site, or run `npm run fetch:events` first to check a local schedule.'],
        },
      );
    }
    try {
      const local = readFileSync(join(process.cwd(), 'public/events.json'), 'utf8');
      return Promise.resolve(assess(JSON.parse(local), 'public/events.json (local)'));
    } catch {
      return Promise.resolve({
        status: 'skip',
        summary: 'no deployed site configured and no local schedule present',
        instructions: [
          'Set the `SEASON_SITE` repository variable (or env) to the deployed app to check what phones are served, or run `npm run fetch:events` locally first.',
        ],
      } satisfies ProbeResult);
    }
  },
};
