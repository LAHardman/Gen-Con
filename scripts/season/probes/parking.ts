/**
 * Are the parking figures a convention old?
 *
 * `parking.ts` is honest that its money is second-hand — forum reports,
 * given as ranges, checked on a date it records. This probe watches that
 * date, and when the figures are due a re-check it does the first pass of
 * the legwork itself: it fetches the two pages worth asking (Gen Con's own
 * parking page, which named no rates when last checked, and the convention
 * centre's) and pulls out every dollar figure they now carry, so the person
 * updating starts from today's numbers instead of from a search box.
 */

import type { Probe } from '../lib';
import { CHECKED, GARAGES } from '../../../src/data/parking';
import { daysBetween } from '../lib';

const PAGES = [
  'https://www.gencon.com/attend/parking',
  'https://www.icclos.com/attendees/parking/',
];

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

const INSTRUCTIONS = [
  'The ranges live in `GARAGES` in `src/data/parking.ts`, in cents; update the ones that moved and set `CHECKED` to today.',
  'The honest sources are attendee reports on gencon.com/forums for convention-week prices — the pages above give the ordinary-week floor, and the convention markup is the part only the forums know.',
  'Ranges, not points: printing a single figure would invent a precision nobody has, which is the file\'s own rule.',
];

export const probe: Probe = {
  id: 'parking',
  title: 'Parking figures',
  async run(ctx) {
    const checked = new Date(`${CHECKED}T12:00:00Z`);
    const age = daysBetween(checked, ctx.now);
    if (age < 330) {
      return {
        status: 'ok',
        summary: `checked ${CHECKED}, ${age} days ago — ${GARAGES.length} garages on file`,
      };
    }

    // Due a re-check. Do the fetching half of it now.
    const repair: string[] = [];
    for (const page of PAGES) {
      try {
        const { status, body } = await ctx.text(page);
        if (status !== 200) {
          repair.push(`${page} → HTTP ${status}`);
          continue;
        }
        const figures = dollarFigures(body);
        repair.push(
          figures.length
            ? `${page} currently says: ${figures.map((f) => `"${f}"`).join('; ')}`
            : `${page} answered but names no dollar figures — same as when the file was written.`,
        );
      } catch {
        repair.push(`${page} was unreachable from here.`);
      }
    }

    return {
      status: 'warn',
      summary: `the parking figures were checked ${CHECKED} — ${age} days ago, likely a convention ago`,
      repair,
      instructions: INSTRUCTIONS,
    };
  },
};
