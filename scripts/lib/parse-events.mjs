/**
 * Turns event-listing HTML into structured events.
 *
 * Deliberately generic: it locates the widest table on a page, reads its header
 * row, and maps columns onto fields by matching the header text. Nothing here
 * depends on a particular class name or DOM path, so a cosmetic redesign of the
 * source site does not break the import — only a change to the column headings
 * themselves would.
 */

import { parse } from 'node-html-parser';

/**
 * Header text patterns per field, in priority order. The first pattern that
 * matches a column header claims that column.
 */
const COLUMN_PATTERNS = [
  ['id', [/^(event\s*)?(id|code|number|#)$/, /game\s*id/]],
  ['title', [/^(event\s*)?(title|name)$/, /^event$/, /^description$/]],
  ['type', [/^(event\s*)?(type|category|track)$/]],
  ['gameSystem', [/system/, /^game$/, /rules\s*edition/]],
  ['start', [/^(start|begin)/, /^date\s*(&|and)?\s*time/, /^when$/, /^day\s*\/?\s*time/, /^time$/, /^date$/]],
  ['end', [/^end/, /finish/]],
  ['duration', [/duration/, /length/, /^hours?$/]],
  ['location', [/location/, /^room$/, /^where$/, /^venue$/, /^place$/, /hall/]],
  ['table', [/^table/, /^space/, /^seat/]],
  ['cost', [/^cost/, /^price/, /^fee/, /\$/]],
  ['tickets', [/tickets?\s*(available|remaining|left)?/, /^avail/, /^seats?\s*(available|left)/]],
  ['age', [/^age/, /audience/]],
];

const normalise = (text) => text.replace(/\s+/g, ' ').trim();
const headerKey = (text) => normalise(text).toLowerCase().replace(/[^a-z0-9$&/ #]/g, '');

/** Maps each column index to a field name, based on the header row's text. */
export function mapColumns(headers) {
  const mapping = {};
  const claimed = new Set();

  for (const [field, patterns] of COLUMN_PATTERNS) {
    for (let index = 0; index < headers.length; index += 1) {
      if (claimed.has(index)) continue;
      const key = headerKey(headers[index]);
      if (!key) continue;
      if (patterns.some((pattern) => pattern.test(key))) {
        mapping[field] = index;
        claimed.add(index);
        break;
      }
    }
  }
  return mapping;
}

/* ------------------------------------------------------------------- values */

/** Indianapolis is on Eastern Daylight Time during Gen Con, i.e. UTC-04:00. */
export const CONVENTION_UTC_OFFSET = '-04:00';

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Parses the many shapes a listing can use for a start time into an ISO string
 * in convention local time. Returns null when nothing usable is found, so the
 * caller can report the row rather than invent a timestamp.
 *
 * `context.dayDates` maps weekday names to YYYY-MM-DD, letting rows that say
 * only "Thursday 10:00 AM" resolve to a real date.
 */
export function parseStart(raw, context = {}) {
  if (!raw) return null;
  const text = normalise(raw);

  // Already ISO-ish: 2026-08-01 10:00 / 2026-08-01T10:00:00
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
  if (iso) {
    const [, y, m, d, hh, mm] = iso;
    return `${y}-${m}-${d}T${hh.padStart(2, '0')}:${mm}:00${CONVENTION_UTC_OFFSET}`;
  }

  const time = parseClock(text);

  // US style with a month name: "Thu Aug 1, 2026 10:00 AM" / "August 1 10:00 AM"
  const named = text.match(/([a-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
  if (named && MONTHS[named[1].slice(0, 3).toLowerCase()]) {
    const month = MONTHS[named[1].slice(0, 3).toLowerCase()];
    const day = Number(named[2]);
    const year = Number(named[3] ?? context.year ?? new Date().getFullYear());
    if (time) return buildIso(year, month, day, time.hour, time.minute);
  }

  // Numeric date: 08/01/2026 10:00 AM
  const numeric = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (numeric && time) {
    const year = Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]);
    return buildIso(year, Number(numeric[1]), Number(numeric[2]), time.hour, time.minute);
  }

  // Weekday only: "Thursday 10:00 AM", resolved against the convention's dates.
  const weekday = WEEKDAYS.find((name) => new RegExp(`\\b${name.slice(0, 3)}`, 'i').test(text));
  if (weekday && time && context.dayDates?.[weekday]) {
    const [y, m, d] = context.dayDates[weekday].split('-').map(Number);
    return buildIso(y, m, d, time.hour, time.minute);
  }

  return null;
}

function buildIso(year, month, day, hour, minute) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${CONVENTION_UTC_OFFSET}`;
}

function parseClock(text) {
  const match = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function parseDurationMinutes(raw) {
  if (!raw) return undefined;
  const text = normalise(raw).toLowerCase();

  const hoursAndMinutes = text.match(/(\d+)\s*h(?:ours?|rs?)?\s*(\d+)?\s*m?/);
  if (hoursAndMinutes) {
    return Number(hoursAndMinutes[1]) * 60 + Number(hoursAndMinutes[2] ?? 0);
  }
  const minutesOnly = text.match(/(\d+)\s*m(?:in|inutes?)?\b/);
  if (minutesOnly) return Number(minutesOnly[1]);

  const bare = text.match(/^(\d+(?:\.\d+)?)$/);
  // A bare number in a duration column is conventionally hours.
  if (bare) return Math.round(Number(bare[1]) * 60);
  return undefined;
}

export function parseMoney(raw) {
  if (!raw) return undefined;
  const match = normalise(raw).match(/(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : undefined;
}

export function parseCount(raw) {
  if (!raw) return undefined;
  const match = normalise(raw).match(/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

/* -------------------------------------------------------------------- table */

/** Returns the table on the page with the most data rows. */
export function findLargestTable(root) {
  const tables = root.querySelectorAll('table');
  let best = null;
  for (const table of tables) {
    const rows = table.querySelectorAll('tr').length;
    if (!best || rows > best.rows) best = { table, rows };
  }
  return best?.table ?? null;
}

export function readHeaders(table) {
  const headerRow =
    table.querySelector('thead tr') ??
    table.querySelectorAll('tr').find((row) => row.querySelectorAll('th').length > 0);
  if (!headerRow) return [];
  return headerRow.querySelectorAll('th, td').map((cell) => normalise(cell.text));
}

/**
 * Extracts events from a listing page.
 * Returns the events plus diagnostics, so a caller can explain what happened
 * when a page yields nothing.
 */
export function parseListingPage(html, context = {}) {
  const root = parse(html);
  const table = findLargestTable(root);
  if (!table) {
    return { events: [], diagnostics: { reason: 'no <table> found', headers: [], rows: 0 } };
  }

  const headers = readHeaders(table);
  const columns = mapColumns(headers);
  const rows = table.querySelectorAll('tr').filter((row) => row.querySelectorAll('td').length > 0);

  const events = [];
  let unparsedStart = 0;

  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    const cellText = (field) => {
      const index = columns[field];
      return index === undefined ? undefined : normalise(cells[index]?.text ?? '') || undefined;
    };

    const title = cellText('title');
    if (!title) continue;

    const start = parseStart(cellText('start'), context);
    if (!start) unparsedStart += 1;

    const link =
      row.querySelector('a[href*="event"]') ?? row.querySelector('a[href]');
    const href = link?.getAttribute('href');

    events.push({
      id: cellText('id') ?? `${title}-${start ?? 'unscheduled'}`,
      title,
      type: cellText('type'),
      gameSystem: cellText('gameSystem'),
      locationText: cellText('location') ?? '',
      tableText: cellText('table'),
      start,
      durationMinutes: parseDurationMinutes(cellText('duration')),
      cost: parseMoney(cellText('cost')),
      ticketsAvailable: parseCount(cellText('tickets')),
      ageRequirement: cellText('age'),
      url: href && context.baseUrl ? new URL(href, context.baseUrl).toString() : href,
    });
  }

  return {
    events,
    diagnostics: {
      reason: events.length ? 'ok' : 'table found but no rows yielded a title',
      headers,
      columns,
      rows: rows.length,
      unparsedStart,
    },
  };
}
