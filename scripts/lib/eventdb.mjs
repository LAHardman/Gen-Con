/**
 * Reading gencon.eventdb.us's hour pages into this app's events.
 *
 * A community site that mirrors Gen Con's catalogue and keeps the last
 * convention up after Gen Con's own API has rolled over to the next year.
 * Each `dayTime.php?StartDate=...` page lists every session starting that
 * hour, grouped by event type, then game system, then title. It does not list
 * rooms or descriptions, so events from here have no location; everything
 * else the schedule, budget and conflict checks need is present.
 *
 * The page is HTML written for people, so the parser is strict about what it
 * recognises and the caller checks the totals against the site's own counts:
 * a layout change must fail loudly rather than produce a short schedule.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Gen Con is held in July, in Indianapolis: Eastern Daylight Time. */
const OFFSET = '-04:00';

const decode = (text) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();

/** "10:00 am" on a given date, as ISO 8601 in Eastern time. */
function clock(date, text) {
  const match = /^(\d{1,2}):(\d{2}) ([ap])m$/.exec(text);
  if (!match) throw new Error(`unreadable time: "${text}"`);
  let hour = Number(match[1]) % 12;
  if (match[3] === 'p') hour += 12;
  return `${date}T${String(hour).padStart(2, '0')}:${match[2]}:00${OFFSET}`;
}

/** The date `days` after a YYYY-MM-DD one. */
function addDays(date, days) {
  const moved = new Date(`${date}T12:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/**
 * Where the hour pages are, and how many sessions the site says each holds.
 * Read from `dayTimeList.php`.
 */
export function parseHourList(html) {
  const hours = [];
  const pattern =
    /<div class='pull-right'>(\d+)<\/div>\s*<a href='dayTime\.php\?StartDate=(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})'>/g;
  for (const match of html.matchAll(pattern)) {
    hours.push({ start: `${match[2]} ${match[3]}`, expected: Number(match[1]) });
  }
  return hours;
}

/** Every session on one hour page. `start` is that page's StartDate. */
export function parseHourPage(html, start) {
  const day = start.slice(0, 10);
  const events = [];
  let type = '';
  let system = '';
  let title = '';

  const token =
    /<div class='indentXS[^']*' id='([A-Z0-9]+)'><h3>(.*?)<\/h3>|<div class='indentS[^']*'><strong>(.*?)<\/strong>|<div class='indentM[^']*'><strong>(.*?)<\/strong>|GameCode=([A-Z0-9]+)'><i class='icon-time'><\/i>([A-Za-z]{3}) (\d{1,2}:\d{2} [ap]m) - ([A-Za-z]{3}) (\d{1,2}:\d{2} [ap]m)<\/a>\s*<a [^>]*><i class='icon-ticket'><\/i>(\d+)\/(\d+)<\/a>\s*<i class='icon-usd'><\/i>([\d.]+)/g;

  for (const m of html.matchAll(token)) {
    if (m[1]) {
      type = m[1];
      system = '';
      title = '';
    } else if (m[3] !== undefined) {
      system = decode(m[3]);
    } else if (m[4] !== undefined) {
      title = decode(m[4]);
    } else {
      const startDay = DAYS.indexOf(m[6]);
      const endDay = DAYS.indexOf(m[8]);
      if (startDay < 0 || endDay < 0) throw new Error(`unreadable day in ${m[5]}`);
      const endDate = addDays(day, (endDay - startDay + 7) % 7);
      const begins = clock(day, m[7]);
      const ends = clock(endDate, m[9]);
      const minutes = Math.round((Date.parse(ends) - Date.parse(begins)) / 60000);
      events.push({
        id: m[5],
        title,
        type: type || undefined,
        gameSystem: system || undefined,
        locationText: '',
        start: begins,
        end: ends,
        durationMinutes: minutes > 0 ? minutes : undefined,
        cost: Number(m[12]),
        ticketsAvailable: Number(m[10]),
      });
    }
  }
  return events;
}
