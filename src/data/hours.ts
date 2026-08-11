/**
 * When somewhere is open, and whether it is open now.
 *
 * TWO SOURCES, ONE SHAPE. Gen Con's Block Party hours are three lines of prose
 * on a web page, written down by hand in `food.ts`; a restaurant's are an
 * `opening_hours` string from OpenStreetMap. Both become the same `Opening`, so
 * everything that asks "are they open at half past eight" asks it once.
 *
 * THE PARSER READS THE COMMON FORMS AND ADMITS THE REST. `opening_hours` is a
 * real specification with public holidays, sunsets, week numbers, "Sa[1]" for
 * the first Saturday of the month and comments in quotes. Across the 38 rows
 * that carry hours downtown, what actually appears is day ranges, day lists,
 * one or two time spans, and `off`. So that is what this reads — and anything
 * else returns null rather than a guess, and the app prints the string as
 * written. A parser that half-understood "Sa[1] 09:00-12:00" would tell
 * somebody a place was open on the wrong three Saturdays, which is worse than
 * showing them the line and letting them read it.
 *
 * NOTHING HERE READS THE VIEWER'S CLOCK. Every question is asked at the
 * convention's own offset, so "open now" means open in Indianapolis for
 * somebody planning from California.
 */

/** A span of days and a time range within them. */
export interface OpenHours {
  /** Weekday numbers as `Date.getUTCDay` writes them: Sunday 0, Thursday 4. */
  days: number[];
  /** Minutes past midnight. */
  from: number;
  to: number;
}

export interface Opening {
  /**
   * The year these hours were published for, where that matters.
   *
   * Gen Con's are last year's and the app says so. A restaurant's are whenever
   * OpenStreetMap was last read, which is `PULLED` in `eateries.ts`; those
   * carry no year because the year is not the doubt — the doubt is that they
   * are volunteers' and a restaurant changes its hours without telling anybody.
   */
  year?: number;
  hours: OpenHours[];
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Thu–Sat 9am–9pm · Sun 9am–4pm", as somebody would read it off a sign. */
export function formatOpening(opening: Opening): string {
  return opening.hours
    .map((span) => `${spanDays(span.days)} ${clock(span.from)}–${clock(span.to)}`)
    .join(' · ');
}

function spanDays(days: number[]): string {
  const names = days.map((day) => DAY_NAMES[day].slice(0, 3));
  if (names.length === 1) return names[0];
  if (names.length === 7) return 'Every day';
  // Runs of consecutive weekdays read as a range; anything else is a list.
  const consecutive = days.every((day, at) => at === 0 || day === days[at - 1] + 1);
  return consecutive ? `${names[0]}–${names[names.length - 1]}` : names.join(', ');
}

function clock(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const rest = minutes % 60;
  const suffix = hour < 12 ? 'am' : 'pm';
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return rest ? `${shown}:${String(rest).padStart(2, '0')}${suffix}` : `${shown}${suffix}`;
}

/** Whether a moment falls inside them, at the convention's own offset. */
export function openAt(opening: Opening, atMs: number, offsetMinutes: number): boolean {
  const local = new Date(atMs + offsetMinutes * 60_000);
  const day = local.getUTCDay();
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  return opening.hours.some((span) => {
    if (!span.days.includes(day)) {
      // A span running past midnight is still open in the small hours of the
      // *next* day: "Fr 17:00-26:00" covers two in the morning on the Saturday.
      const before = (day + 6) % 7;
      return span.to > 1440 && span.days.includes(before) && minute + 1440 < span.to;
    }
    return minute >= span.from && minute < span.to;
  });
}

/** How much of a span they are open for. */
export type Coverage = 'open' | 'partly' | 'shut';

/**
 * Whether they are open for the *whole* of a planned stop, part of it, or none.
 *
 * The whole of it, because the failure this is for is not turning up to a
 * locked door — that one is obvious — but planning to eat from half past eight
 * to half past nine at a truck that shuts at nine. A check on the start time
 * alone calls that fine.
 *
 * Measured in minutes from the start of the day the stop begins on, so a stop
 * running past midnight compares against the next day's hours rather than
 * wrapping round to that morning's.
 */
export function openThrough(
  opening: Opening,
  day: string,
  fromMinutes: number,
  toMinutes: number,
): Coverage {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const open: Array<[number, number]> = [];
  // Today's hours, and tomorrow's shifted a day along — a stop is at most a day
  // long, so those two are all it can reach.
  for (const shift of [0, 1]) {
    const on = (weekday + shift) % 7;
    for (const span of opening.hours) {
      if (span.days.includes(on)) open.push([span.from + shift * 1440, span.to + shift * 1440]);
    }
  }

  // Merged before they are added up, so a span past midnight and the next day's
  // own opening cannot count their overlap twice and call a stop covered that
  // is not.
  open.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let reached = fromMinutes;
  for (const [from, to] of open) {
    const start = Math.max(from, reached);
    covered += Math.max(0, Math.min(to, toMinutes) - Math.max(start, fromMinutes));
    reached = Math.max(reached, to);
  }
  if (covered <= 0) return 'shut';
  return covered >= toMinutes - fromMinutes ? 'open' : 'partly';
}

/* -------------------------------------------------- reading OpenStreetMap */

const WEEKDAYS: Record<string, number> = {
  su: 0,
  mo: 1,
  tu: 2,
  we: 3,
  th: 4,
  fr: 5,
  sa: 6,
};

const minutesOf = (text: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  // 24:00 and beyond are legal and mean "past midnight" — `26:00` is two in the
  // morning. Anything past that is not a clock.
  return minutes <= 48 * 60 ? minutes : null;
};

/**
 * An `opening_hours` string as spans, or null where it is not one of the forms
 * this understands.
 *
 * Reads: `24/7`; a bare time range with no days (`10:00-24:00`, meaning every
 * day); day ranges (`Mo-Sa`), day lists (`Fr,Sa`) and single days; one or more
 * comma-separated time ranges per rule (`11:00-14:30,17:00-22:00`); `off` and
 * `closed`; and rules separated by `;`.
 *
 * Refuses, by returning null: public holidays, months, week numbers, nth-weekday
 * brackets, sunrise/sunset, open-ended ranges and anything else. Null is not a
 * failure — it is this saying it did not understand, and the caller shows the
 * line as written.
 */
export function parseOpeningHours(text: string): Opening | null {
  const raw = text.trim();
  if (!raw) return null;
  if (/^24\/7$/i.test(raw)) return { hours: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 1440 }] };
  // Anything with syntax outside the subset. Checked up front so a rule that is
  // half-understood cannot contribute half its meaning.
  const BEYOND =
    /\b(PH|SH|easter|sunrise|sunset|dawn|dusk|week|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|[[\]"]|\+/i;
  if (BEYOND.test(raw)) return null;

  const spans: OpenHours[] = [];
  for (const rule of raw.split(';')) {
    const line = rule.trim();
    if (!line) continue;

    // The days, then the times. Either half may be missing: "10:00-24:00" is
    // every day, and "Su off" is a day with no times at all.
    const match = /^([A-Za-z,\- ]*?)\s*((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*,?\s*)+|off|closed)$/i.exec(
      line,
    );
    if (!match) return null;

    const [, dayText, timeText] = match;
    const days: number[] = [];
    if (dayText.trim()) {
      for (const part of dayText.split(',')) {
        const piece = part.trim().toLowerCase();
        if (!piece) continue;
        const range = /^([a-z]{2})\s*-\s*([a-z]{2})$/.exec(piece);
        if (range) {
          const from = WEEKDAYS[range[1]];
          const to = WEEKDAYS[range[2]];
          if (from === undefined || to === undefined) return null;
          // Wrapping is legal and common: `Fr-Mo` is Friday to Monday.
          for (let day = from; ; day = (day + 1) % 7) {
            days.push(day);
            if (day === to) break;
          }
          continue;
        }
        const one = WEEKDAYS[piece];
        if (one === undefined) return null;
        days.push(one);
      }
    } else {
      days.push(0, 1, 2, 3, 4, 5, 6);
    }

    if (/^(off|closed)$/i.test(timeText.trim())) {
      // A later rule overrides an earlier one for the days it names, which is
      // what `Mo-Sa 08:00-21:00; Su off` means. Handled by dropping those days
      // from everything already collected.
      for (const span of spans) span.days = span.days.filter((day) => !days.includes(day));
      continue;
    }

    const ranges: OpenHours[] = [];
    for (const range of timeText.split(',')) {
      const times = /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(range);
      if (!times) return null;
      const from = minutesOf(times[1]);
      const to = minutesOf(times[2]);
      if (from === null || to === null) return null;
      // `18:00-02:00` means past midnight, which the spec writes as 26:00 and
      // mappers often write as a wrap. Both mean the same thing here.
      ranges.push({ days: [...days], from, to: to > from ? to : to + 1440 });
    }
    // A later rule overrides an earlier one on the days it names — and it is
    // the *rule* that overrides, not each of its ranges, or the second half of
    // "11:00-14:30,17:00-22:00" would delete the first half.
    for (const span of spans) span.days = span.days.filter((day) => !days.includes(day));
    spans.push(...ranges);
  }

  const kept = spans.filter((span) => span.days.length);
  return kept.length ? { hours: kept } : null;
}
