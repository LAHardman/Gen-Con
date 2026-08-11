/**
 * The dates that decide whether you get to go.
 *
 * WHY THIS IS A PAGE. The convention is four days and the rest of the year is a
 * queue. Badges sell out of the hotels attached to them; the events people
 * actually want are gone in the first ten minutes of registration. Missing one
 * of these by a day costs more than any wrong turn inside the building, and
 * none of them are in the event feed — they come from `key-dates.ts`, which
 * derives them from a rule checked against Gen Con's own API.
 *
 * IT COUNTS DOWN RATHER THAN LISTING. "17 May" is a fact; "in 78 days" is the
 * thing somebody wants to know, and the one that decides whether to act now.
 * The next one still to come is marked, because on a page of six dates the only
 * question is which is next.
 *
 * WHAT HAS NO DATE SAYS SO. Gen Con publishes none for VIG rebooking or
 * housing, so those two rows carry what *is* known — the ordering, and where
 * the date is actually announced — instead of a plausible date nobody checked.
 * That is the whole reason to trust the other four.
 */

import { keyDates, planningYear, type DatedMilestone } from '../data/key-dates';

interface Props {
  nowMs: number;
}

/** "Sun 17 May 2026", in the reader's own language. */
const longDate = (at: Date) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(at.getTime() + easternShift(at)));

/**
 * Eastern noon, printed as Eastern noon.
 *
 * The date is formatted in UTC after shifting by Gen Con's offset, for the same
 * reason the schedule's ruler is: formatting in the reader's zone would move a
 * midday deadline onto the day before for anybody west of it.
 */
function easternShift(at: Date): number {
  // Recovered from the instant rather than passed in: `milestoneAt` already
  // applied the right offset for the month, and this only has to undo it.
  const summer = at.getUTCMonth() > 2 && at.getUTCMonth() < 10;
  return (summer ? -240 : -300) * 60_000;
}

const clock = (at: Date) =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(at.getTime() + easternShift(at)),
  );

/** "in 78 days", "tomorrow", "today", "gone". */
function away(row: DatedMilestone): string {
  if (row.daysAway === null) return '';
  if (row.past) return row.daysAway === 0 ? 'today' : 'gone';
  if (row.daysAway === 0) return 'today';
  if (row.daysAway === 1) return 'tomorrow';
  return `in ${row.daysAway} days`;
}

export function DatesView({ nowMs }: Props) {
  const year = planningYear(nowMs);
  const rows = keyDates(year, nowMs);
  // The one to act on. Undated rows can never be it, because there is nothing
  // to be next about.
  const next = rows.find((row) => row.at && !row.past);

  return (
    <section className="dates" aria-label="Key dates">
      <header className="dates__head">
        <h2>Gen Con {year}</h2>
        <p>
          Every date below is {' '}
          <strong>a fixed number of days before the convention’s Wednesday</strong>, which is why
          they land on the same weekday every year and a week later when the show does. Checked
          against Gen Con’s own API for 2024–2027.
        </p>
      </header>

      <ol className="dates__list">
        {rows.map((row) => {
          const { milestone, at, past } = row;
          const isNext = row === next;
          return (
            <li
              key={milestone.id}
              className={`dates__row${past ? ' dates__row--past' : ''}${
                isNext ? ' dates__row--next' : ''
              }`}
            >
              <div className="dates__when">
                {at ? (
                  <>
                    <span className="dates__date">{longDate(at)}</span>
                    <span className="dates__clock">{clock(at)} Eastern</span>
                  </>
                ) : (
                  <span className="dates__date dates__date--none">No date published</span>
                )}
              </div>

              <div className="dates__what">
                <h3>
                  {milestone.name}
                  {isNext && <span className="dates__next-tag">next</span>}
                </h3>
                <p>{milestone.what}</p>
                {milestone.instead && <p className="dates__instead">{milestone.instead}</p>}
                {milestone.href && (
                  <a href={milestone.href} target="_blank" rel="noreferrer noopener">
                    Gen Con’s own page ↗
                  </a>
                )}
              </div>

              <div className="dates__away" aria-hidden={!at}>
                {away(row)}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="dates__note">
        Derived rather than fetched, so this page works with no network and answers for any year.
        Gen Con has published show dates through 2030 and the rule matches all of them.
      </p>
    </section>
  );
}
