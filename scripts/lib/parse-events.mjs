/**
 * Turns Gen Con event-database HTML into structured events.
 *
 * The source site (https://gencon.eventdb.us/) publishes each event in two
 * places, and the importer reads both:
 *
 *  - **Catalogue pages** (`categoryAll.php?EventType=…`) list every event in a
 *    category as nested `<div>`s — one per game system, title and session.
 *    They carry the title, code, day and time, cost and ticket counts, but no
 *    location. One request covers a whole category, so this is the bulk pass.
 *  - **Event pages** (`event.php?GameCode=…`) carry the full record as a
 *    two-column `<table>` of label/value rows: `Title`, `Start Date`,
 *    `Location`, `Room`, `Table` and so on. This is the only place the location
 *    appears.
 *
 * Fields are mapped by matching those row labels, not by column position or
 * DOM path, so a cosmetic redesign of the source does not break the import —
 * only renaming the labels themselves would. `FIELD_PATTERNS` is the list to
 * adjust if that ever happens; `npm run fetch:events -- --inspect` prints the
 * labels the site is actually using.
 */

import { parse } from 'node-html-parser';

/**
 * Label patterns per field, in priority order. The first pattern that matches
 * a row's label claims that row.
 *
 * The comment after each entry is the label the live site uses today, as
 * reported by `--inspect`. The patterns stay broader than those exact strings
 * so that near-miss renames still resolve.
 */
export const FIELD_PATTERNS = [
  ['id', [/^game\s*code$/, /^(event\s*)?(id|code|number|#)$/]], //        Game Code
  ['title', [/^(event\s*)?(title|name)$/, /^event$/]], //                 Title
  ['type', [/^event\s*type$/, /^(type|category|track)$/]], //             Event Type
  ['gameSystem', [/^game\s*system$/, /system/, /^game$/]], //             Game System
  ['rulesEdition', [/^rules\s*edition$/, /edition/]], //                  Rules Edition
  ['start', [/^start\s*(date|time)?$/, /^begin/, /^date\s*(&|and)?\s*time/, /^when$/, /^date$/]], // Start Date
  ['end', [/^end\s*(date|time)?$/, /finish/]], //                         End Date
  ['duration', [/duration/, /length/, /^hours?$/]], //                    (not present today)
  ['location', [/^location$/, /^venue$/, /^where$/, /^place$/]], //       Location
  ['room', [/^room(\s*name)?$/, /hall/]], //                              Room
  ['table', [/^table/, /^space/, /^seat$/]], //                           Table
  ['cost', [/^cost/, /^price/, /^fee/, /\$/]], //                         Cost
  ['tickets', [/^tickets?\s*(available|remaining|left)?$/, /^avail/, /^seats?\s*(available|left)/]], // Tickets Available
  ['age', [/^age\s*(required|requirement)?$/, /audience/]], //            Age Required
  ['description', [/^short\s*description$/, /^description$/]], //        Short Description
  ['group', [/^group\s*\/?\s*company$/, /^company$/, /^organi[sz]er$/]], // Group/Company
];

const normalise = (text) => text.replace(/\s+/g, ' ').trim();
const labelKey = (text) => normalise(text).toLowerCase().replace(/[^a-z0-9$&/ #]/g, '');

/**
 * Anchors under `root` whose href contains `needle`.
 *
 * A plain filter rather than an attribute selector, so the parsing here leans
 * only on tag selectors — the part of a selector engine that never surprises.
 */
function linksContaining(root, needle) {
  return root
    .querySelectorAll('a')
    .filter((link) => (link.getAttribute('href') ?? '').includes(needle));
}

/**
 * Maps each of a record's labels to a field name.
 * Takes the labels in document order and returns `{ field: label }`.
 */
export function mapFields(labels) {
  const mapping = {};
  const claimed = new Set();

  for (const [field, patterns] of FIELD_PATTERNS) {
    for (const label of labels) {
      if (claimed.has(label)) continue;
      const key = labelKey(label);
      if (!key) continue;
      if (patterns.some((pattern) => pattern.test(key))) {
        mapping[field] = label;
        claimed.add(label);
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
 * Parses the shapes the source uses for a timestamp into an ISO string in
 * convention local time. Returns null when nothing usable is found, so the
 * caller can report the row rather than invent a time.
 *
 * The event pages give a full date — "Saturday August 01, 2026 - 10:00 am" —
 * while the catalogue pages abbreviate to a weekday, "Sat 10:00 am".
 * `context.dayDates` maps weekday names to YYYY-MM-DD so the latter resolve;
 * `npm run fetch:events` builds it from the site's own day/time index.
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

  // US style with a month name: "Saturday August 01, 2026 - 10:00 am".
  // Skipping any leading weekday matters: "Saturday August 01" must read the
  // month from "August", not from "Saturday"'s first three letters.
  const named = text.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/gi) ?? [];
  for (const candidate of named) {
    const parts = candidate.match(/([a-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
    const month = MONTHS[parts[1].slice(0, 3).toLowerCase()];
    if (!month) continue;
    const day = Number(parts[2]);
    const year = Number(parts[3] ?? context.year ?? new Date().getFullYear());
    if (time) return buildIso(year, month, day, time.hour, time.minute);
  }

  // Numeric date: 08/01/2026 10:00 AM
  const numeric = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (numeric && time) {
    const year = Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]);
    return buildIso(year, Number(numeric[1]), Number(numeric[2]), time.hour, time.minute);
  }

  // Weekday only: "Sat 10:00 am", resolved against the convention's dates.
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

/**
 * Reads a ticket count. The source writes "162/180" for 162 of 180 still
 * available, and goes negative when a wait list has formed ("-18/180"), so the
 * leading sign has to survive.
 */
export function parseCount(raw) {
  if (!raw) return undefined;
  const match = normalise(raw).match(/(-?\d+)/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Strips the source's code prefix from an event type: "FLM - Film Festival"
 * is stored as its code, which is what the rest of the app treats as the type.
 */
export function parseEventType(raw) {
  if (!raw) return undefined;
  const match = normalise(raw).match(/^([A-Z]{2,4})\s*-\s*(.+)$/);
  return match ? match[1] : normalise(raw) || undefined;
}

/* ------------------------------------------------------------- event pages */

/**
 * The value a label's cell holds, up to the first `<br>`.
 *
 * The source appends action links to some values — the title cell is followed
 * by "Purchase / Wish List" and "Google", each on its own line — and taking the
 * whole cell would fold those into the title. Everything the importer reads
 * sits on the cell's first line.
 */
function cellValue(cell) {
  const parts = [];
  for (const node of cell.childNodes) {
    if (node.nodeType === 1 && node.rawTagName?.toLowerCase() === 'br') break;
    parts.push(node.text);
  }
  return normalise(parts.join(''));
}

/**
 * Reads the label/value table on an `event.php` page into `{ label: value }`.
 * Rows whose value cell is empty are kept, so `--inspect` can report every
 * label the page offers rather than only the populated ones.
 */
export function readFieldTable(table) {
  const fields = {};
  for (const row of table.querySelectorAll('tr')) {
    const cells = row.querySelectorAll('td, th');
    if (cells.length < 2) continue;
    const label = normalise(cells[0].text);
    if (!label) continue;
    fields[label] = cellValue(cells[1]);
  }
  return fields;
}

/** Returns the table on the page with the most rows. */
export function findLargestTable(root) {
  let best = null;
  for (const table of root.querySelectorAll('table')) {
    const rows = table.querySelectorAll('tr').length;
    if (!best || rows > best.rows) best = { table, rows };
  }
  return best?.table ?? null;
}

/**
 * Extracts one event from an `event.php` page.
 * Returns the event plus diagnostics, so a caller can explain what happened
 * when a page yields nothing.
 */
export function parseEventPage(html, context = {}) {
  const root = parse(html);
  const table = findLargestTable(root);
  if (!table) {
    return { event: null, diagnostics: { reason: 'no <table> found', labels: [] } };
  }

  const fields = readFieldTable(table);
  const labels = Object.keys(fields);
  const map = mapFields(labels);
  const value = (field) => {
    const label = map[field];
    return label === undefined ? undefined : fields[label] || undefined;
  };

  const title = value('title');
  if (!title) {
    return { event: null, diagnostics: { reason: 'no title row', labels, fields: map } };
  }

  const start = parseStart(value('start'), context);
  const [link] = linksContaining(root, 'gencon.com/events');

  return {
    event: {
      id: value('id') ?? `${title}-${start ?? 'unscheduled'}`,
      title,
      type: parseEventType(value('type')),
      gameSystem: value('gameSystem'),
      locationText: value('location') ?? '',
      roomText: value('room'),
      tableText: value('table'),
      start,
      end: parseStart(value('end'), context),
      durationMinutes: parseDurationMinutes(value('duration')),
      cost: parseMoney(value('cost')),
      ticketsAvailable: parseCount(value('tickets')),
      ageRequirement: value('age'),
      url: link?.getAttribute('href'),
    },
    diagnostics: { reason: 'ok', labels, fields: map, unparsedStart: start ? 0 : 1 },
  };
}

/* --------------------------------------------------------- catalogue pages */

/**
 * Extracts every session listed on a `categoryAll.php` page.
 *
 * The page is a flat run of `<div>`s whose indent class carries the nesting:
 * `indentXS` opens a category, `indentS` a game system, `indentM` a title, and
 * each `indentL` is one session of the title above it. Reading them in
 * document order and remembering the last heading of each level reconstructs
 * that tree without depending on the divs actually being nested.
 *
 * These pages have no location — `fetch-events.mjs` fills that in afterwards.
 */
export function parseCataloguePage(html, context = {}) {
  const root = parse(html);
  const events = [];
  let gameSystem;
  let title;
  let unparsedStart = 0;
  let sessions = 0;

  for (const div of root.querySelectorAll('div')) {
    const classes = (div.getAttribute('class') ?? '').split(/\s+/);
    if (classes.includes('indentS')) {
      gameSystem = normalise(div.text) || undefined;
      continue;
    }
    if (classes.includes('indentM')) {
      title = normalise(div.text) || undefined;
      continue;
    }
    if (!classes.includes('indentL') || !title) continue;

    sessions += 1;
    const [codeLink] = linksContaining(div, 'GameCode=');
    const code = codeLink?.getAttribute('href')?.match(/GameCode=([^&]+)/)?.[1];
    if (!code) continue;

    // "Sat 10:00 am - Sat 10:30 am" — the halves are separated by an en/em
    // dash or a hyphen, and each half names its own day.
    const when = normalise(codeLink.text);
    const [startText, endText] = when.split(/\s+[-–—]\s+/);

    const [ticketLink] = linksContaining(div, 'gencon.com/events');
    // Cost trails the session line after a currency icon, e.g. "… 8.00".
    const cost = normalise(div.text).match(/(\d+\.\d{2})\s*$/)?.[1];

    const start = parseStart(startText, context);
    if (!start) unparsedStart += 1;

    events.push({
      id: code,
      title,
      type: context.eventType,
      gameSystem,
      locationText: '',
      start,
      end: parseStart(endText, context),
      cost: parseMoney(cost),
      ticketsAvailable: parseCount(ticketLink?.text),
      url: ticketLink?.getAttribute('href'),
    });
  }

  return {
    events,
    diagnostics: {
      reason: events.length ? 'ok' : 'no session rows found',
      sessions,
      unparsedStart,
    },
  };
}

/**
 * Reads the site's day/time index (`dayTimeList.php`) into a weekday →
 * YYYY-MM-DD map, so the catalogue's "Sat 10:00 am" can be given a real date.
 *
 * Each entry links to `dayTime.php?StartDate=2026-08-01 10:00:00` and is
 * labelled "Sat 10:00 am", which pairs the weekday with its date directly —
 * no assumption about which dates the convention runs.
 */
export function parseDayIndex(html) {
  const root = parse(html);
  const dayDates = {};

  for (const link of linksContaining(root, 'StartDate=')) {
    const href = link.getAttribute('href') ?? '';
    const date = decodeURIComponent(href).match(/StartDate=(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!date) continue;
    const label = normalise(link.text).toLowerCase();
    const weekday = WEEKDAYS.find((name) => label.startsWith(name.slice(0, 3)));
    if (weekday && !dayDates[weekday]) dayDates[weekday] = date;
  }
  return dayDates;
}

/** Collects the `event.php` game codes linked from any listing page. */
export function readGameCodes(html) {
  const root = parse(html);
  const codes = [];
  for (const link of linksContaining(root, 'GameCode=')) {
    const code = link.getAttribute('href')?.match(/GameCode=([^&]+)/)?.[1];
    if (code) codes.push(code);
  }
  return [...new Set(codes)];
}

/** Collects the event-type codes the landing page links to. */
export function readEventTypes(html) {
  const root = parse(html);
  const types = [];
  for (const link of linksContaining(root, 'EventType=')) {
    const type = link.getAttribute('href')?.match(/EventType=([A-Za-z0-9]+)/)?.[1];
    if (type) types.push(type);
  }
  return [...new Set(types)];
}
