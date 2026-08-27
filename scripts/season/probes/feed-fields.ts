/**
 * Does the event feed still carry every field `shape()` reads?
 *
 * The importer's real failure is not an error, it is a field quietly renamed:
 * `shape()` reads `undefined`, 27,467 events lose their room, and the run
 * still reports success. So this asks the live endpoint for one page and
 * checks the source field names — and when one is missing, it *looks for the
 * rename* among the fields that did arrive, because `start_date` → `startDate`
 * is a five-minute fix once it is named and an afternoon once it is not.
 */

import type { Probe } from '../lib';
import { missingFields, withNetwork } from '../lib';

const API = 'https://www.gencon.com/api/event_search';

/** Every source field `shape()` in scripts/fetch-events.mjs reads. */
export const EXPECTED = [
  'game_code',
  'id',
  'title',
  'event_type',
  'game_system',
  'location',
  'room_name',
  'table_number',
  'start_date',
  'end_date',
  'event_duration',
  'event_cost',
  'tickets_available',
  'age_requirement_short',
] as const;

const INSTRUCTIONS = [
  'The fields `shape()` reads live in `scripts/fetch-events.mjs`; change the source names there to the renames reported above.',
  'Then run `npm run fetch:events -- --limit 100` and open a few rows of `public/events.json` — the fields must be populated, not merely absent of errors.',
  '`npm run check` runs the import tests, which read recorded pages and will say if the shape moved further than a rename.',
];

export const probe: Probe = {
  id: 'feed-fields',
  title: 'Event feed fields',
  run: (ctx) =>
    withNetwork(
      async () => {
        const { status, body } = await ctx.json(`${API}?page=1`);
        if (status !== 200) {
          return {
            status: 'fail',
            summary: `event_search answered HTTP ${status}`,
            details: [`GET ${API}?page=1 → ${status}`],
            instructions: [
              'The endpoint may have moved. Open https://www.gencon.com/events in a browser with the network tab up and note what the page itself now calls — that URL replaces `API` in `scripts/fetch-events.mjs`.',
              ...INSTRUCTIONS,
            ],
          };
        }
        // The endpoint answers in an Elasticsearch envelope: the event itself
        // is each record's `_source`, which is also the only part `shape()` reads.
        const records: unknown[] = Array.isArray((body as { records?: unknown[] })?.records)
          ? (body as { records: unknown[] }).records
          : Array.isArray(body)
            ? body
            : [];
        const first = records
          .map((r) => (r && typeof r === 'object' && '_source' in (r as object) ? (r as { _source: unknown })._source : r))
          .find((r) => r && typeof r === 'object') as Record<string, unknown> | undefined;
        if (!first) {
          return {
            status: 'fail',
            summary: 'event_search answered 200 but no event records were recognised in the response',
            details: [`Top-level shape: ${Array.isArray(body) ? 'array (empty)' : typeof body}`],
            instructions: INSTRUCTIONS,
          };
        }
        const present = Object.keys(first);
        const missing = missingFields(EXPECTED, present);
        if (!missing.length) {
          return {
            status: 'ok',
            summary: `all ${EXPECTED.length} fields the importer reads are on the feed`,
          };
        }
        return {
          status: 'fail',
          summary: `${missing.length} field${missing.length === 1 ? '' : 's'} the importer reads are gone from the feed`,
          details: [`Fields the feed does carry: ${present.join(', ')}`],
          repair: missing.map(({ field, probably }) =>
            probably
              ? `\`${field}\` is gone; the feed now carries \`${probably}\`, which is almost certainly its new name.`
              : `\`${field}\` is gone, and nothing on the feed resembles it — that column may genuinely no longer exist.`,
          ),
          instructions: INSTRUCTIONS,
        };
      },
      {
        summary: 'gencon.com was unreachable from here',
        instructions: ['Re-run `npm run season:check` somewhere with network access to gencon.com.'],
      },
    ),
};
