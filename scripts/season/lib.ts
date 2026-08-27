/**
 * The season check's shared parts: what a probe is, how it reaches the
 * network, and the pure readings (hour prose, name similarity, deadlines)
 * that the tests can hold still.
 *
 * THE CONTRACT EVERY PROBE KEEPS. A probe answers one question about one
 * thing that can go stale, and its answer always has the same three layers:
 *
 *   status + summary   what is true right now, in one line
 *   repair             what the probe found *by looking for itself* — the
 *                      current value read off the live page, the working
 *                      substitute, the ready-to-paste lines
 *   instructions       exactly what a person does about it, as commands and
 *                      file locations, never as "update the data"
 *
 * A probe that cannot reach the network reports `skip`, with its
 * instructions intact — the person reading the report may be somewhere the
 * network works. A probe never throws out of `run`; the runner treats an
 * escape as a bug in the probe and says so.
 */

import { execFileSync } from 'node:child_process';

export type ProbeStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface ProbeResult {
  status: ProbeStatus;
  /** One line: what is true. */
  summary: string;
  /** What was seen, for the reader who wants the evidence. */
  details?: string[];
  /** What self-repair found or proposes — current values read off live pages, paste-ready lines. */
  repair?: string[];
  /** The exact steps for a person. Present whenever status is not `ok`. */
  instructions?: string[];
}

export interface Probe {
  id: string;
  title: string;
  run(ctx: ProbeContext): Promise<ProbeResult>;
}

export interface ProbeContext {
  /** `--fix`: probes may run their own repair scripts and write files. */
  fix: boolean;
  now: Date;
  root: string;
  /** Fetch a page as text. Throws `Unreachable` when the network refuses. */
  text(url: string): Promise<{ status: number; body: string; contentType: string }>;
  /** Fetch and parse JSON. Throws `Unreachable` when the network refuses. */
  json(url: string, headers?: Record<string, string>): Promise<{ status: number; body: unknown }>;
  /** HEAD-ish probe: status and content-type only, body discarded. */
  head(url: string): Promise<{ status: number; contentType: string }>;
}

/** Their servers. Node's default user-agent is refused by some of them. */
export const AGENT = 'gen-con-trip/0.1 season check (personal trip planner; contact via repository)';

/** A network that would not answer at all — distinct from a page that answered badly. */
export class Unreachable extends Error {
  constructor(url: string, cause: unknown) {
    super(`unreachable: ${url} (${cause instanceof Error ? cause.message : String(cause)})`);
    this.name = 'Unreachable';
  }
}

const TIMEOUT_MS = 20_000;

async function request(url: string, headers: Record<string, string> = {}) {
  try {
    return await fetch(url, {
      headers: { 'User-Agent': AGENT, ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });
  } catch (cause) {
    throw new Unreachable(url, cause);
  }
}

export function makeContext(overrides: Partial<ProbeContext> = {}): ProbeContext {
  return {
    fix: false,
    now: new Date(),
    root: process.cwd(),
    async text(url) {
      const response = await request(url);
      return {
        status: response.status,
        body: await response.text(),
        contentType: response.headers.get('content-type') ?? '',
      };
    },
    async json(url, headers = {}) {
      const response = await request(url, { Accept: 'application/json', ...headers });
      const raw = await response.text();
      let body: unknown = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      return { status: response.status, body };
    },
    async head(url) {
      const response = await request(url);
      // Read and discard so the connection is reusable; tiles are small.
      await response.arrayBuffer().catch(() => undefined);
      return { status: response.status, contentType: response.headers.get('content-type') ?? '' };
    },
    ...overrides,
  };
}

/** A probe body wrapped so a refused network reads as `skip`, not a crash. */
export async function withNetwork(
  attempt: () => Promise<ProbeResult>,
  offline: Omit<ProbeResult, 'status'>,
): Promise<ProbeResult> {
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof Unreachable) {
      return {
        status: 'skip',
        ...offline,
        details: [...(offline.details ?? []), error.message],
      };
    }
    throw error;
  }
}

/* ------------------------------------------------------------- dates */

export const DAY_MS = 24 * 60 * 60 * 1000;

export const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY_MS);

/** `2026-W35` — stable within a week, so a re-run is idempotent. */
export function weekStamp(date: Date): string {
  // ISO week: Thursday of the same week decides the year.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The date of a file's last commit, `YYYY-MM-DD`, or null outside a checkout. */
export function lastCommitDate(root: string, file: string): string | null {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------- name similarity */

/**
 * How alike two names are, for suggesting rather than deciding.
 *
 * Token overlap, with numbers weighted the way the campus actually collides:
 * `104` names a room in two buildings, so a shared number is a strong signal
 * and a shared word like "room" is nearly none. This ranks candidates a
 * person chooses between; it never assigns anything on its own — the rate
 * matcher's history (`Tru ... Downtown` priced as `Tru ... Lawrence`) is the
 * warning this heeds.
 */
export function similarity(a: string, b: string): number {
  const tokens = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(Boolean);
  const NOISE = new Set(['room', 'hall', 'the', 'of', 'and', 'a', 'an']);
  const weigh = (t: string) => (/\d/.test(t) ? 3 : NOISE.has(t) ? 0.25 : 1);
  const A = tokens(a);
  const B = new Set(tokens(b));
  if (!A.length || !B.size) return 0;
  let shared = 0;
  let total = 0;
  for (const t of A) {
    total += weigh(t);
    if (B.has(t)) shared += weigh(t);
  }
  return total === 0 ? 0 : shared / total;
}

/** The `count` best-scoring candidates for `target`, best first, zeros dropped. */
export function closest<T>(
  target: string,
  candidates: readonly T[],
  nameOf: (candidate: T) => string[],
  count = 3,
): Array<{ candidate: T; score: number }> {
  return candidates
    .map((candidate) => ({
      candidate,
      score: Math.max(0, ...nameOf(candidate).map((name) => similarity(target, name))),
    }))
    .filter((entry) => entry.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, count);
}

/* ------------------------------------------------------ hour prose */

export interface ProseHours {
  days: number[];
  from: number;
  to: number;
}

const DAY_NAMES: ReadonlyArray<[number, RegExp]> = [
  [0, /\bsun(day)?s?\b/i],
  [1, /\bmon(day)?s?\b/i],
  [2, /\btue(s|sday)?s?\b/i],
  [3, /\bwed(nesday)?s?\b/i],
  [4, /\bthu(r|rs|rsday)?s?\b/i],
  [5, /\bfri(day)?s?\b/i],
  [6, /\bsat(urday)?s?\b/i],
];

function dayOf(word: string): number | null {
  for (const [day, pattern] of DAY_NAMES) if (pattern.test(word)) return day;
  return null;
}

/** `9am` → 540, `noon` → 720, `5:30pm` → 1050. Null rather than a guess. */
export function minutesOf(word: string): number | null {
  const clean = word.trim().toLowerCase();
  if (clean === 'noon') return 12 * 60;
  if (clean === 'midnight') return 0;
  const match = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  if (hour > 23 || minute > 59) return null;
  if (match[3] === 'pm' && hour < 12) hour += 12;
  if (match[3] === 'am' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

/**
 * Gen Con's hour prose, read the way `food.ts` was written by hand from it.
 *
 * `"Thursday - Saturday, 9am - 9pm / Sunday, 9am - 4pm"` and
 * `"Wed tapping 5-10pm / Thu-Sat, noon - 10pm"` are the two shapes ever
 * observed; this reads day ranges, day lists and one time span per clause,
 * and returns null for anything else rather than shipping a misreading —
 * the same refusal `hours.ts` makes of an `opening_hours` form it has not
 * seen. A span like `5-10pm` borrows the meridiem for both ends.
 */
export function parseHourProse(prose: string): ProseHours[] | null {
  const clauses = prose
    .split(/[\/;]|(?:\band\b)/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (!clauses.length) return null;

  const spans: ProseHours[] = [];
  for (const clause of clauses) {
    const time = clause.match(
      /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight)/i,
    );
    if (!time) return null;

    let fromWord = time[1];
    const toWord = time[2];
    // `5-10pm`: the first number has no meridiem of its own; take the second's.
    const meridiem = toWord.match(/am|pm/i)?.[0];
    if (meridiem && !/am|pm|noon|midnight/i.test(fromWord)) fromWord = `${fromWord}${meridiem}`;
    const from = minutesOf(fromWord);
    const to = minutesOf(toWord);
    if (from === null || to === null) return null;

    const daysPart = clause.slice(0, time.index ?? 0);
    const words = daysPart.split(/[^a-z]+/i).filter(Boolean);
    const named = words.map(dayOf).filter((day): day is number => day !== null);
    if (!named.length) return null;

    // `Thursday - Saturday` / `Thu-Sat`: exactly two names joined by a dash
    // spanning them is a range; anything else is the list as written.
    const ranged = named.length === 2 && /[a-z]\s*[-–—]\s*[a-z]/i.test(daysPart);
    let days: number[];
    if (ranged) {
      days = [];
      for (let day = named[0]; ; day = (day + 1) % 7) {
        days.push(day);
        if (day === named[1]) break;
        if (days.length > 7) return null;
      }
    } else {
      days = [...new Set(named)];
    }
    spans.push({ days, from, to });
  }
  return spans;
}

/** `540` → `at(9)`, `1050` → `at(17, 30)` — the form `food.ts` writes. */
export function asAtCall(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return minute === 0 ? `at(${hour})` : `at(${hour}, ${minute})`;
}

/** A `ProseHours[]` as the lines `food.ts` holds, for pasting whole. */
export function asOpeningLines(year: number, spans: ProseHours[]): string[] {
  return [
    `  year: ${year},`,
    '  hours: [',
    ...spans.map(
      (span) =>
        `    { days: [${span.days.join(', ')}], from: ${asAtCall(span.from)}, to: ${asAtCall(span.to)} },`,
    ),
    '  ],',
  ];
}

/* -------------------------------------------------------- deadlines */

export interface Deadline {
  what: string;
  /** `YYYY-MM-DD`, or null for "not filled in yet". */
  due: string | null;
  note?: string;
}

export function readDeadline(deadline: Deadline, now: Date): ProbeResult {
  const file = 'scripts/season/store-dates.json';
  if (!deadline.due) {
    return {
      status: 'warn',
      summary: `${deadline.what}: no date on file`,
      instructions: [
        `Put the real date into \`${file}\` as \`"due": "YYYY-MM-DD"\` on the "${deadline.what}" row.`,
        ...(deadline.note ? [deadline.note] : []),
      ],
    };
  }
  const due = new Date(`${deadline.due}T12:00:00Z`);
  const days = daysBetween(now, due);
  const renew = [
    `When it is dealt with, move \`due\` forward a year in \`${file}\` — the probe goes quiet on its own.`,
    ...(deadline.note ? [deadline.note] : []),
  ];
  if (days < 0) {
    return {
      status: 'fail',
      summary: `${deadline.what}: due date passed ${-days} day${days === -1 ? '' : 's'} ago (${deadline.due})`,
      instructions: renew,
    };
  }
  if (days <= 60) {
    return {
      status: 'warn',
      summary: `${deadline.what}: due in ${days} day${days === 1 ? '' : 's'} (${deadline.due})`,
      instructions: renew,
    };
  }
  return { status: 'ok', summary: `${deadline.what}: due ${deadline.due}, ${days} days out` };
}

/* -------------------------------------------------- field renames */

/**
 * Which of `expected` are missing from `present`, each with its likeliest
 * rename — `start_date` gone but `startDate` arrived is a rename, not a
 * removal, and saying so is the difference between a five-minute fix and an
 * afternoon of diffing responses.
 */
export function missingFields(
  expected: readonly string[],
  present: readonly string[],
): Array<{ field: string; probably: string | null }> {
  const have = new Set(present);
  const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return expected
    .filter((field) => !have.has(field))
    .map((field) => {
      const wanted = bare(field);
      const candidate =
        present.find((p) => bare(p) === wanted) ??
        present.find((p) => bare(p).includes(wanted) || wanted.includes(bare(p))) ??
        null;
      return { field, probably: candidate };
    });
}
