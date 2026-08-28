/**
 * Is the parking on file still what Gen Con and its partner say?
 *
 * THIS PROBE EXISTS BECAUSE ITS PREDECESSOR WAS CONFIDENTLY WRONG. It
 * fetched `gencon.com/attend/parking`, found no dollar figures, and reported
 * that Gen Con priced no parking — for a year. What had actually happened is
 * that the URL was retired and now redirects to the front page, which has no
 * dollar figures for the same reason a blank sheet has none. Meanwhile Gen
 * Con had an official parking partner: iPark, running the Lucas Oil lots
 * with a free shuttle, since 2025.
 *
 * So this one does three things the old one did not. It asks Gen Con's help
 * centre through its API rather than guessing at page URLs, because the help
 * centre is where Gen Con actually keeps this and an article search survives
 * a site rebuild. It follows the link that article carries rather than
 * hard-coding iPark's, so the partner is Gen Con's to change and a change of
 * partner arrives as a finding rather than as silence. And it reads the
 * price itself off iPark's event list when Gen Con is on it, which is the
 * half the old probe left as homework.
 *
 * NONE OF WHICH MAKES AN ABSENT PRICE A FAULT. iPark lists Gen Con only
 * while reservations are open, so for much of the year the honest answer is
 * that there is no figure yet — reported as what it is, and not as a dead
 * page or a free car park.
 */

import type { Probe, ProbeResult } from '../lib';
import { withNetwork, daysBetween } from '../lib';
import { CHECKED, GARAGES, IPARK_EVENTS, OFFICIAL_SOURCE } from '../../../src/data/parking';

/**
 * Gen Con's help centre, asked for whatever it currently files under
 * parking. An article id would be quicker and would rot the first time
 * somebody re-published it; the search survives that.
 */
const HELP_SEARCH = 'https://gencon.zendesk.com/api/v2/help_center/articles/search.json?query=parking';

/** Every "$NN" with a few words either side, deduplicated, for reading. */
export function dollarFigures(html: string): string[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const found = [...text.matchAll(/(?:\S+\s+){0,4}\$\d{1,3}(?:\.\d{2})?(?:\s*[-–]\s*\$?\d{1,3})?(?:\s+\S+){0,4}/g)]
    .map((m) => m[0].trim());
  return [...new Set(found)].slice(0, 12);
}

/**
 * The links a help-centre article body carries, absolute ones only.
 *
 * The point is to find where Gen Con currently sends people to book, so that
 * `IPARK_EVENTS` is a default rather than a fact: if Gen Con changes partner,
 * the article changes and this reports the new link.
 */
export function linksIn(body: string): string[] {
  return [...new Set([...body.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))];
}

/**
 * iPark's event list, as name against the id that prices it.
 *
 * Their events page is a `<select>` of everything currently on sale. Gen Con
 * appears in it when reservations open and comes out again afterwards, which
 * is why a null price in `parking.ts` is a season rather than a fault.
 */
export function eventOptions(html: string): Array<{ id: string; name: string }> {
  return [...html.matchAll(/<option[^>]*value="([0-9A-F]{16,})"[^>]*>([^<]*)<\/option>/gi)].map(
    (m) => ({ id: m[1], name: m[2].trim() }),
  );
}

/** A priced lot on an iPark event page: the lot's name and its cents. */
export function lotPrices(html: string): Array<{ lot: string; cents: number }> {
  const lines = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const out: Array<{ lot: string; cents: number }> = [];
  for (let at = 0; at < lines.length - 1; at += 1) {
    const price = /^\$\s*(\d{1,4})(?:\.(\d{2}))?$/.exec(lines[at + 1]);
    // A lot name is prose with a bracketed location on the end — "Gen Con
    // 2027 (Merrill)" — which is what keeps the page's marketing copy out.
    if (!price || !/\(.+\)\s*$/.test(lines[at])) continue;
    out.push({ lot: lines[at], cents: Number(price[1]) * 100 + Number(price[2] ?? 0) });
  }
  return out;
}

const INSTRUCTIONS = [
  'The ranges live in `GARAGES` in `src/data/parking.ts`, in cents; update the ones that moved and set `COMPILED_CHECKED` to today.',
  'The official entry (`ipark-lucas-oil`) takes a single published figure in both `lowCents` and `highCents` while booking is open, and `null` in both once iPark takes the event down again — null prints as "priced when booking opens", which is true, and zero would print as free, which is not.',
  'The downtown garages are ranges, not points: printing a single figure would invent a precision nobody has, which is the file\'s own rule. Convention-week prices come from attendee reports on gencon.com/forums.',
  `If Gen Con's help-centre article names a different partner, change \`OFFICIAL_SOURCE\` and \`IPARK_EVENTS\` to match — the article is the authority, not this file.`,
  'Then `npm run check`, and `npm run build:pack` so installed copies can take the new figures without a release.',
];

export const probe: Probe = {
  id: 'parking',
  title: 'Parking figures',
  run: (ctx) => {
    const age = Math.max(0, daysBetween(new Date(`${CHECKED}T12:00:00Z`), ctx.now));
    const official = GARAGES.find((garage) => garage.official);

    return withNetwork(
      async () => {
        const details: string[] = [];
        const repair: string[] = [];
        let booking = IPARK_EVENTS;

        // 1. What does Gen Con itself currently say about parking?
        const help = await ctx.json(HELP_SEARCH);
        const results = (help.body as { results?: Array<{ title?: string; html_url?: string; body?: string }> })
          ?.results;
        const article = results?.find((one) => /parking/i.test(one.title ?? ''));
        if (!article) {
          details.push(`Gen Con's help centre returned no parking article (HTTP ${help.status}).`);
        } else {
          details.push(`Gen Con's help centre: "${article.title}" — ${article.html_url}`);
          if (article.html_url && article.html_url !== OFFICIAL_SOURCE) {
            repair.push(`The article has moved. Set \`OFFICIAL_SOURCE\` to \`${article.html_url}\`.`);
          }
          const links = linksIn(article.body ?? '');
          const partner = links.find((link) => /ipco\.services|ipark/i.test(link));
          if (partner) {
            booking = partner;
            details.push(`It links to the booking at ${partner}`);
          } else if (links.length) {
            repair.push(
              `The article no longer links to iPark. It now links to: ${links.join(', ')} — check whether the partner has changed, and update \`IPARK_EVENTS\` and the \`ipark-lucas-oil\` entry.`,
            );
          }
        }

        // 2. Is Gen Con listed for booking, and at what price?
        const events = await ctx.text(new URL(booking).origin + new URL(booking).pathname);
        const options = eventOptions(events.body);
        const genCon = options.find((one) => /gen\s*-?\s*con/i.test(one.name));
        if (!options.length) {
          details.push(`${booking} listed no events at all — the page may have moved.`);
        } else if (!genCon) {
          details.push(
            `iPark currently lists ${options.length} event${options.length === 1 ? '' : 's'} and Gen Con is not among them: ${options.map((one) => one.name).join(', ')}.`,
          );
        } else {
          const priced = await ctx.text(`${booking.split('?')[0]}?e=${genCon.id}`);
          const lots = lotPrices(priced.body);
          details.push(
            lots.length
              ? `iPark prices "${genCon.name}": ${lots.map((lot) => `${lot.lot} $${(lot.cents / 100).toFixed(2)}`).join('; ')}`
              : `iPark lists "${genCon.name}" but named no price on it.`,
          );
          if (lots.length) {
            const cheapest = Math.min(...lots.map((lot) => lot.cents));
            const dearest = Math.max(...lots.map((lot) => lot.cents));
            const held = official?.lowCents;
            if (held !== cheapest || official?.highCents !== dearest) {
              repair.push(
                'Booking is open and priced. In `src/data/parking.ts`, the `ipark-lucas-oil` entry becomes:',
                '```',
                `    lowCents: ${cheapest.toLocaleString('en-US').replace(/,/g, '_')},`,
                `    highCents: ${dearest.toLocaleString('en-US').replace(/,/g, '_')},`,
                '```',
              );
            }
          }
        }

        // 3. The reported ranges, which only time invalidates.
        const stale = age >= 330;
        if (stale) {
          repair.push(
            `The downtown garages' ranges were read ${CHECKED}, ${age} days ago — likely a convention ago. They come from attendee reports rather than a rate card, so re-reading them is a forum trawl rather than a fetch.`,
          );
        }

        const wrong = repair.length > 0;
        return {
          status: wrong ? 'fail' : stale ? 'warn' : 'ok',
          summary: wrong
            ? `parking has moved on since ${CHECKED} — ${repair.length} thing${repair.length === 1 ? '' : 's'} to change`
            : stale
              ? `the reported ranges were read ${CHECKED}, ${age} days ago; Gen Con's official parking is unchanged`
              : `checked ${CHECKED}, ${age} days ago — ${GARAGES.length} entries, Gen Con's own among them`,
          details,
          repair: repair.length ? repair : undefined,
          instructions: wrong || stale ? INSTRUCTIONS : undefined,
        } satisfies ProbeResult;
      },
      {
        summary: `nothing was reachable from here; parking was last read ${CHECKED}, ${age} days ago`,
        instructions: ['Re-run `npm run season:check` somewhere with open network access.'],
      },
    );
  },
};
