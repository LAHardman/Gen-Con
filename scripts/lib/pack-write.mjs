/**
 * The one way pack tables are written to disk.
 *
 * Every pack table is JSON with two writers that must never disagree: the
 * generator that refreshes it on a schedule, and anything that rebuilds it
 * from data already in hand. `refresh.yml` leans on the output being
 * byte-identical when the source is unchanged — that is what lets it stop
 * instead of opening an empty pull request — so the serialisation lives
 * here once: canonical key order, absent rather than null for a field with
 * nothing to say, one record per line so a diff reads as the rows that
 * moved.
 */

/** An object with exactly these keys, in this order, skipping the empty. */
function pick(row, keys) {
  const out = {};
  for (const key of keys) {
    const value = row[key];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (Number.isNaN(value)) continue;
    out[key] = value;
  }
  return out;
}

/** `{"a":1}` rows, one per line, inside a named field. */
const rowsField = (name, rows, indent) =>
  `${indent}"${name}": [\n${rows.map((row) => `${indent}  ${JSON.stringify(row)}`).join(',\n')}\n${indent}]`;

/**
 * `src/data/exhibitors.json`: the tag vocabulary and one row per location.
 *
 * Tag indices stay indices — the vocabulary repeats across 845 rows and
 * 47.8 KB of strings becomes 12.3 KB of numbers, which matters in a file a
 * phone will one day download as part of a pack.
 */
export function exhibitorsJson(vocabulary, rows) {
  const KEYS = ['name', 'kind', 'area', 'spot', 'booth', 'level', 'id', 'tags', 'website'];
  return [
    '{',
    `  "tags": [\n${vocabulary.map((tag) => `    ${JSON.stringify(tag)}`).join(',\n')}\n  ],`,
    rowsField('exhibitors', rows.map((row) => pick(row, KEYS)), '  '),
    '}',
    '',
  ].join('\n');
}

/** `src/data/partners.json`: the block's year, growth, rates and suspects. */
export function partnersJson({ year, growth, partners, suspected }) {
  // Every field on every row, with `placeId: null` and `high: null` kept:
  // they are answers here rather than absences — "no unambiguous building"
  // and "a single rate, not a range" — and the reader relies on seeing them.
  const row = (one) => ({
    blockName: one.blockName,
    placeId: one.placeId ?? null,
    low: one.low,
    high: one.high ?? null,
    region: one.region,
    skywalk: one.skywalk,
    distance: one.distance,
  });
  return [
    '{',
    `  "year": ${year},`,
    `  "growth": ${growth === null ? 'null' : Number(growth.toFixed(4))},`,
    `${rowsField('partners', partners.map(row), '  ')},`,
    `  "suspected": ${JSON.stringify(suspected)}`,
    '}',
    '',
  ].join('\n');
}
