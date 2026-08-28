/**
 * Are the Block Party's hours still the ones Gen Con states?
 *
 * `food.ts` carries them by hand, with the year they were published for,
 * because the page keeps them *inside an HTML comment* while the new year's
 * page is being written — scraping it blind would ship last year's times as
 * this year's. So this probe reads the page the careful way: the live text
 * and the commented text separately, hour prose parsed only where it names
 * days and times, and a proposal made only from the *live* half. What it
 * finds arrives as the exact lines `food.ts` holds, ready to paste.
 */

import type { Probe, ProbeResult } from '../lib';
import { asOpeningLines, parseHourProse, withNetwork } from '../lib';
import { FOOD_TRUCK_HOURS, BEER_GARDEN_HOURS } from '../../../src/data/food';
import { planningYear } from '../../../src/data/key-dates';

const PAGE = 'https://www.gencon.com/gen-con-indy/block-party';

const INSTRUCTIONS = [
  'The one place to change is the hours block in `src/data/food.ts` — `FOOD_TRUCK_HOURS` and `BEER_GARDEN_HOURS`, each with its `year`.',
  `Gen Con states them in prose on ${PAGE} ("Thursday - Saturday, 9am - 9pm / Sunday, 9am - 4pm"); the beer garden's (Sun King) are usually a separate line.`,
  'Check whether the hours are in the visible page or still in an HTML comment — commented-out hours are last year\'s, left there while the new page is written, and must not be shipped as this year\'s.',
  'Then `npm run check`: `food.test.ts` holds the shape.',
];

/** The page's hour prose, live text and commented text kept apart. */
export function splitHourProse(html: string): { live: string[]; commented: string[] } {
  const comments = [...html.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const textOf = (markup: string) =>
    markup
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  const hourish = (line: string) =>
    /(\d{1,2}(:\d{2})?\s*(am|pm)|noon|midnight)/i.test(line) &&
    /\b(sun|mon|tue|wed|thu|fri|sat)/i.test(line);
  return {
    live: textOf(withoutComments).filter(hourish),
    commented: comments.flatMap(textOf).filter(hourish),
  };
}

export const probe: Probe = {
  id: 'blockparty-hours',
  title: 'Block Party hours',
  run: (ctx) => {
    const year = planningYear(ctx.now.getTime());
    const held = Math.max(FOOD_TRUCK_HOURS.year ?? 0, BEER_GARDEN_HOURS.year ?? 0);
    return withNetwork(
      async () => {
        const { status, body } = await ctx.text(PAGE);
        if (status !== 200) {
          return {
            status: held < year ? 'warn' : 'ok',
            summary: `the Block Party page answered HTTP ${status}; hours on file are ${held}'s`,
            instructions: held < year ? INSTRUCTIONS : undefined,
          } satisfies ProbeResult;
        }
        const { live, commented } = splitHourProse(body);
        const details = [
          ...live.map((line) => `live on the page: "${line}"`),
          ...commented.map((line) => `inside an HTML comment (last year's, most likely): "${line}"`),
        ];

        if (!live.length) {
          return {
            status: held < year ? 'warn' : 'ok',
            summary:
              held < year
                ? `hours on file are ${held}'s and the page shows none yet — ${year}'s are still ${commented.length ? 'commented out' : 'unwritten'}`
                : `hours on file are ${held}'s and the page publishes nothing newer`,
            details,
            instructions: held < year ? ['Nothing to copy yet; this probe proposes the lines the week the page shows them.', ...INSTRUCTIONS] : undefined,
          };
        }

        // The page states hours in the open. Try to read them; propose only
        // what parsed, and show the raw line either way.
        const repair: string[] = [];
        for (const line of live) {
          const spans = parseHourProse(line);
          if (spans) {
            const which = /sun\s*king|beer|tapping/i.test(line) ? 'BEER_GARDEN_HOURS' : 'FOOD_TRUCK_HOURS';
            repair.push(`From "${line}" — paste into \`${which}\` in src/data/food.ts:`);
            repair.push('```', ...asOpeningLines(year, spans), '```');
          } else {
            repair.push(`"${line}" is on the page but did not parse — read it by eye rather than trusting a guess.`);
          }
        }

        if (held >= year) {
          return {
            status: 'ok',
            summary: `hours on file are ${held}'s and the page agrees a year is published; compare below if in doubt`,
            details,
            repair,
          };
        }
        return {
          status: 'fail',
          summary: `the page states hours in the open and \`food.ts\` still holds ${held}'s`,
          details,
          repair,
          instructions: INSTRUCTIONS,
        };
      },
      {
        summary: `gencon.com was unreachable from here; hours on file are ${held}'s`,
        instructions: held < year ? INSTRUCTIONS : ['Re-run `npm run season:check` somewhere with network access.'],
      },
    );
  },
};
