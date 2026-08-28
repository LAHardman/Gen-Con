/**
 * Has Gen Con published a new badge rate card?
 *
 * `badge-prices.ts` carries every card it could retrieve, and derives from
 * them both the latest price and the trend it estimates the next one with.
 * This probe's job is to notice a new card and hand over the one line that
 * adds it to that history.
 *
 * IT PREFERS THE PRESS RELEASE, AND THE REASON IS DATING. Gen Con announces
 * each year's prices in a January release whose title names the year — "Gen
 * Con Announces 2026 Registration Dates, Badge Prices" — so a card taken
 * from there cannot be attributed to the wrong convention. The badge page
 * carries the same table with no year attached to it at all, and Gen Con
 * leaves last cycle's table sitting on that page inside an HTML comment
 * while the new one is written, which is where the 2026 figures are today.
 * Stripping tags without stripping comments finds six real-looking prices
 * and calls them current; nothing downstream would ever doubt them. So the
 * page is the fallback, its comments come out first, and only what is live
 * on it can propose a year.
 *
 * THE SLUGS ARE NOT A PATTERN. 2022 and 2023 are
 * `gen-con-20XX-badge-registration`, 2024 is `2024-reg-dates-and-badge-prices`
 * and serves an unrelated release, 2025 has `-chairman` on the end. So the
 * index is read and the titles are followed, rather than a URL being
 * guessed — which is also how the 2024 hole in the history was found rather
 * than silently mis-filled.
 */

import type { Probe, ProbeResult } from '../lib';
import { withNetwork, daysBetween } from '../lib';
import {
  BADGE_CENTS,
  BADGE_HISTORY,
  BADGE_PRICE_YEAR,
  BADGE_PRICES_CHECKED,
  PRESS_INDEX,
  SOURCE,
} from '../../../src/data/badge-prices';
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

/**
 * Gen Con's press-release index, as date, URL and title.
 *
 * Read off the index rather than guessed at, because the slugs have no
 * pattern; the title is what identifies a release, and it is also the only
 * place a card's year is stated unambiguously.
 */
export function pressReleases(html: string): Array<{ url: string; title: string }> {
  return [...html.matchAll(/<a\s+href="(https:\/\/www\.gencon\.com\/press\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(
    (m) => ({
      url: m[1],
      title: m[2]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    }),
  );
}

/** The badge-price announcements among them, newest year first. */
export function badgeAnnouncements(html: string): Array<{ url: string; title: string; year: number }> {
  return pressReleases(html)
    .filter((one) => /badge price/i.test(one.title))
    .map((one) => ({ ...one, year: Number(/\b(20\d\d)\b/.exec(one.title)?.[1] ?? 0) }))
    .filter((one) => one.year > 0)
    .sort((a, b) => b.year - a.year);
}

/** The entry `badge-prices.ts` holds, ready to paste onto `COMPILED_HISTORY`. */
export function asHistoryEntry(found: Record<string, number>, year: number, source: string): string[] {
  const order = ['four-day', 'thursday', 'friday', 'saturday', 'sunday', 'trade-day'];
  const quote = (key: string) => (/^[a-z]+$/.test(key) ? key : `'${key}'`);
  const money = (cents: number) => `${Math.floor(cents / 1000)}_${String(cents % 1000).padStart(3, '0')}`;
  const priced = order.filter((key) => found[key] !== undefined).map((key) => `${quote(key)}: ${money(found[key])}`);
  return [
    '  {',
    `    year: ${year},`,
    `    cents: { ${priced.join(', ')}, none: null },`,
    `    source: '${source}',`,
    '  },',
  ];
}

const INSTRUCTIONS = [
  'Add the new card to `COMPILED_HISTORY` in `src/data/badge-prices.ts`, oldest first, and set `COMPILED_CHECKED` to today. Nothing else moves: the latest price, the base year and the trend are all derived from that list, so they cannot end up disagreeing with each other.',
  `Gen Con announces each card at ${PRESS_INDEX} in January, and repeats it as a table on ${SOURCE}. Take it from the release — its title names the year, and the page's table does not.`,
  'Check the small print under the page\'s table too: the Marion County admissions tax (`COMPILED_TAX`) and the USPS packet fee (`COMPILED_SHIPPING_CENTS`) are stated there and are not in the table.',
  'Prices found inside an HTML comment on the badge page are last cycle\'s, left there while the new one is written — never ship those as the new year\'s.',
  'Then `npm run check`: `badge-prices.test.ts` holds the shape and the trend, and `npm run build:pack` puts the new card where installed copies can take it without a release.',
];

export const probe: Probe = {
  id: 'badge-prices',
  title: 'Badge prices',
  run: (ctx) => {
    const planning = planningYear(ctx.now.getTime());
    // Floored at zero: the file is stamped at noon, so a check run the same
    // morning it was written would otherwise report "-1 days ago".
    const age = Math.max(0, daysBetween(new Date(`${BADGE_PRICES_CHECKED}T12:00:00Z`), ctx.now));
    const held = `${BADGE_HISTORY.length} cards, newest ${BADGE_PRICE_YEAR}'s, checked ${BADGE_PRICES_CHECKED} (${age} days ago)`;
    const known = new Set(BADGE_HISTORY.map((card) => card.year));

    return withNetwork(
      async () => {
        const details: string[] = [];

        // 1. The press releases, which are the only dated source.
        const index = await ctx.text(PRESS_INDEX);
        const announced = index.status === 200 ? badgeAnnouncements(index.body) : [];
        if (index.status !== 200) {
          details.push(`Gen Con's press index answered HTTP ${index.status}.`);
        } else {
          details.push(
            `Gen Con's press index lists badge-price announcements for ${announced.map((one) => one.year).join(', ') || 'no year'}.`,
          );
        }

        const missing = announced.filter((one) => !known.has(one.year));
        for (const release of missing) {
          const page = await ctx.text(release.url);
          const found = page.status === 200 ? parseBadgeTable(page.body) : {};
          if (!Object.keys(found).length) {
            // 2024's release is listed and serves an unrelated one; a year
            // that cannot be read is reported, not guessed at.
            details.push(
              `${release.year}'s announcement (${release.url}) carries no readable price table — HTTP ${page.status}. Left out of the history rather than filled in.`,
            );
            continue;
          }
          return {
            status: 'fail',
            summary: `Gen Con has announced ${release.year}'s badge prices and they are not on file`,
            details: [...details, ...Object.entries(found).map(([kind, cents]) => `${kind} $${(cents / 100).toFixed(0)}`)],
            repair: [
              `Add this to the end of \`COMPILED_HISTORY\` in \`src/data/badge-prices.ts\` (from ${release.title}):`,
              '```',
              ...asHistoryEntry(found, release.year, release.url),
              '```',
            ],
            instructions: INSTRUCTIONS,
          } satisfies ProbeResult;
        }

        // 2. The badge page, as a check on the newest card and as the place a
        //    price can move without an announcement.
        const page = await ctx.text(SOURCE);
        if (page.status !== 200) {
          return {
            status: BADGE_PRICE_YEAR < planning ? 'warn' : 'ok',
            summary: `no new announcement; the badge page answered HTTP ${page.status}. On file: ${held}`,
            details,
            instructions: BADGE_PRICE_YEAR < planning ? INSTRUCTIONS : undefined,
          };
        }

        const { live, commented } = splitBadgePrices(page.body);
        details.push(
          ...Object.entries(live).map(([kind, cents]) => `live on the badge page: ${kind} $${(cents / 100).toFixed(0)}`),
          ...Object.entries(commented).map(
            ([kind, cents]) => `inside an HTML comment (last cycle's, most likely): ${kind} $${(cents / 100).toFixed(0)}`,
          ),
        );

        const moved = Object.entries(live).filter(([kind, cents]) => BADGE_CENTS[kind as never] !== cents);
        if (moved.length) {
          return {
            status: 'fail',
            summary: `the badge page states ${moved.length} price${moved.length === 1 ? '' : 's'} that differ${moved.length === 1 ? 's' : ''} from the ${BADGE_PRICE_YEAR} card on file, with no announcement to date them`,
            details,
            repair: [
              `The page carries no year, so read it against ${PRESS_INDEX} before filing it. If these are ${planning}'s:`,
              '```',
              ...asHistoryEntry(live, planning, SOURCE),
              '```',
            ],
            instructions: INSTRUCTIONS,
          };
        }

        // Nothing new. Whether that is fine depends only on whether the year
        // being planned has been priced yet — and if it has not, the app is
        // already showing the last card with its year on it and an estimate
        // beside it, which is the designed state rather than a fault.
        if (BADGE_PRICE_YEAR < planning) {
          return {
            status: 'warn',
            summary: `${planning}'s prices are not published yet; the app shows ${BADGE_PRICE_YEAR}'s, labelled, with an estimate from ${BADGE_HISTORY.length} cards beside it`,
            details,
            instructions: [
              'Nothing to copy yet — this probe proposes the entry the day Gen Con announces it, which is usually mid-January.',
              ...INSTRUCTIONS,
            ],
          };
        }
        return {
          status: 'ok',
          summary: `the badge page matches the ${BADGE_PRICE_YEAR} card, and no later one is announced — ${held}`,
          details,
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
