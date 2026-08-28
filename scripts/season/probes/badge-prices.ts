/**
 * Has Gen Con published a new badge rate card?
 *
 * `badge-prices.ts` carries the table off `/gen-con-indy/your_badge` with
 * the year it was published for. This probe re-reads that page and says
 * whether the figures on file are still the ones being sold.
 *
 * IT READS THE PAGE IN TWO HALVES, AND THIS IS THE WHOLE CARE OF IT. Gen
 * Con does not delete last cycle's prices — it wraps the table in an HTML
 * comment and leaves it in place while the new page is written, which is
 * where the table sits for most of the year. Stripping tags without
 * stripping comments finds six real-looking prices and calls them current,
 * and nothing downstream would ever doubt them. So the comments come out
 * first, the live half is parsed on its own, and only the live half can
 * propose a new `YEAR`. What is in the comment is reported as what it is:
 * last cycle's, already on file, and not news.
 */

import type { Probe, ProbeResult } from '../lib';
import { withNetwork, daysBetween } from '../lib';
import { BADGE_CENTS, BADGE_PRICE_YEAR, BADGE_PRICES_CHECKED, SOURCE } from '../../../src/data/badge-prices';
import { planningYear } from '../../../src/data/key-dates';

/** The badge kinds the table names, as `badges.ts` keys them. */
const KIND_OF: ReadonlyArray<{ key: string; match: RegExp }> = [
  { key: 'four-day', match: /^4[\s-]*day/i },
  { key: 'trade-day', match: /^trade[\s-]*day/i },
  { key: 'thursday', match: /^thu/i },
  { key: 'friday', match: /^fri/i },
  { key: 'saturday', match: /^sat/i },
  { key: 'sunday', match: /^sun/i },
];

const textOf = (markup: string) =>
  markup
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

/**
 * Badge kind against price in cents, from one half of the page.
 *
 * Read off the flattened text rather than by walking the table's cells:
 * the markup around it has been rewritten more than once — nested in a
 * paragraph, wrapped in a comment, the class names changed — while "a badge
 * type on one line and a dollar figure on the next" has held throughout.
 * A row is only taken when the price is directly after the name, so the
 * prose further down the page ("$16 shipping", "10% admissions tax") cannot
 * attach itself to a badge.
 */
export function parseBadgeTable(markup: string): Record<string, number> {
  const lines = textOf(markup);
  const out: Record<string, number> = {};
  for (let at = 0; at < lines.length - 1; at += 1) {
    const kind = KIND_OF.find((candidate) => candidate.match.test(lines[at]));
    if (!kind || out[kind.key] !== undefined) continue;
    const price = /^\$\s*(\d{1,4})(?:\.(\d{2}))?$/.exec(lines[at + 1]);
    if (!price) continue;
    out[kind.key] = Number(price[1]) * 100 + Number(price[2] ?? 0);
  }
  return out;
}

/** The page's rate card, live text and commented-out text kept apart. */
export function splitBadgePrices(html: string): {
  live: Record<string, number>;
  commented: Record<string, number>;
} {
  const comments = [...html.matchAll(/<!--([\s\S]*?)(?:--!?>)/g)].map((m) => m[1]).join('\n');
  return {
    live: parseBadgeTable(html.replace(/<!--[\s\S]*?(?:--!?>)/g, ' ')),
    commented: parseBadgeTable(comments),
  };
}

/** The lines `badge-prices.ts` holds, ready to paste over `COMPILED_CENTS`. */
export function asCentsLines(found: Record<string, number>, year: number): string[] {
  const order = ['four-day', 'thursday', 'friday', 'saturday', 'sunday', 'trade-day'];
  const quote = (key: string) => (/^[a-z]+$/.test(key) ? key : `'${key}'`);
  const money = (cents: number) => `${Math.floor(cents / 1000)}_${String(cents % 1000).padStart(3, '0')}`;
  return [
    `const COMPILED_YEAR = ${year};`,
    'const COMPILED_CENTS: Record<BadgeKind, number | null> = {',
    ...order
      .filter((key) => found[key] !== undefined)
      .map((key) => `  ${quote(key)}: ${money(found[key])},`),
    '  none: null,',
    '};',
  ];
}

const INSTRUCTIONS = [
  'The figures live in `COMPILED_CENTS` in `src/data/badge-prices.ts`, in whole cents before tax; set `COMPILED_YEAR` to the convention they are for and `COMPILED_CHECKED` to today.',
  `They are stated as a plain table on ${SOURCE} — badge type against price.`,
  'Check the small print under it too: the Marion County admissions tax (`COMPILED_TAX`) and the USPS packet fee (`COMPILED_SHIPPING_CENTS`) are stated there and are not in the table.',
  'Prices found inside an HTML comment are last cycle\'s, left on the page while the new one is written — never ship those as the new year\'s.',
  'Then `npm run check`: `badge-prices.test.ts` holds the shape, and `npm run build:pack` puts the new figures where installed copies can take them without a release.',
];

export const probe: Probe = {
  id: 'badge-prices',
  title: 'Badge prices',
  run: (ctx) => {
    const planning = planningYear(ctx.now.getTime());
    // Floored at zero: the file is stamped at noon, so a check run the same
    // morning it was written would otherwise report "-1 days ago".
    const age = Math.max(0, daysBetween(new Date(`${BADGE_PRICES_CHECKED}T12:00:00Z`), ctx.now));
    const held = `${BADGE_PRICE_YEAR}'s prices, read ${BADGE_PRICES_CHECKED} (${age} days ago)`;

    return withNetwork(
      async () => {
        const { status, body } = await ctx.text(SOURCE);
        if (status !== 200) {
          return {
            status: BADGE_PRICE_YEAR < planning ? 'warn' : 'ok',
            summary: `the badge page answered HTTP ${status}; on file are ${held}`,
            instructions: BADGE_PRICE_YEAR < planning ? INSTRUCTIONS : undefined,
          } satisfies ProbeResult;
        }

        const { live, commented } = splitBadgePrices(body);
        const details = [
          ...Object.entries(live).map(([kind, cents]) => `live on the page: ${kind} $${(cents / 100).toFixed(0)}`),
          ...Object.entries(commented).map(
            ([kind, cents]) => `inside an HTML comment (last cycle's, most likely): ${kind} $${(cents / 100).toFixed(0)}`,
          ),
        ];

        if (!Object.keys(live).length) {
          // The ordinary state for most of the year: the old table is sitting
          // in a comment and the new one is not written. Nothing to do, and
          // the app is already showing the old figures with their year on.
          return {
            status: BADGE_PRICE_YEAR < planning ? 'warn' : 'ok',
            summary:
              BADGE_PRICE_YEAR < planning
                ? `${planning}'s prices are not published yet; the app shows ${held}, labelled as ${BADGE_PRICE_YEAR}'s`
                : `no live table on the page; on file are ${held}`,
            details,
            instructions:
              BADGE_PRICE_YEAR < planning
                ? ['Nothing to copy yet — this probe proposes the lines the week the table goes live.', ...INSTRUCTIONS]
                : undefined,
          };
        }

        // A live table. Compare it against what is on file, kind by kind.
        const moved = Object.entries(live).filter(([kind, cents]) => BADGE_CENTS[kind as never] !== cents);
        if (!moved.length && BADGE_PRICE_YEAR >= planning) {
          return {
            status: 'ok',
            summary: `the page's table matches the ${BADGE_PRICE_YEAR} figures on file`,
            details,
          };
        }

        return {
          status: 'fail',
          summary: moved.length
            ? `the page states ${moved.length} price${moved.length === 1 ? '' : 's'} that differ${moved.length === 1 ? 's' : ''} from the ${BADGE_PRICE_YEAR} figures on file`
            : `the page's table is live and the figures on file are still marked ${BADGE_PRICE_YEAR}`,
          details,
          repair: [
            `Paste over the two constants in \`src/data/badge-prices.ts\` (year taken as ${planning} — check the page's own heading agrees):`,
            '```',
            ...asCentsLines(live, planning),
            '```',
          ],
          instructions: INSTRUCTIONS,
        };
      },
      {
        summary: `gencon.com was unreachable from here; on file are ${held}`,
        instructions:
          BADGE_PRICE_YEAR < planning
            ? INSTRUCTIONS
            : ['Re-run `npm run season:check` somewhere with network access.'],
      },
    );
  },
};
