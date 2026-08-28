/**
 * What the trip costs, and whose share of it is whose.
 *
 * WHY THIS IS A PAGE. Everything else in this app answers "where" and "when".
 * The question that decides whether four people go at all is "how much", and
 * until now it was answered in a spreadsheet somebody kept in another window —
 * one that never knew which hotel had been booked, which sessions had tickets,
 * or that two of the party had a Thursday badge and a Sunday game.
 *
 * NOTHING HERE IS TYPED TWICE. A hotel marked booked on the Hotels page and a
 * priced session on the Schedule are read straight through — see
 * `budget-lines.ts`. They cannot be edited here, because the next render would
 * read them back and overwrite the edit; the way to change one is to change the
 * thing it came from, and each says so.
 *
 * IT CHECKS THE PLAN AS WELL AS THE MONEY. This is the only page that knows
 * both who is going and what they are going to, so it is the only page that can
 * say *Anna is down for two things at two o'clock* or *Ben has a Thursday badge
 * and a Sunday game*. See `conflicts.ts`.
 *
 * EVERY NUMBER IS EDITABLE AND NONE OF THEM ARE GUESSES DRESSED AS FACTS. The
 * parking rates are a reported range and say so; badges carry no price at all,
 * because Gen Con publishes them behind a store that cannot be fetched.
 */

import { useMemo, useState } from 'react';

import { BADGE_KINDS, BADGE_NAMES, type BadgeKind } from '../data/badges';
import {
  ADMISSIONS_TAX,
  BADGE_PRICE_YEAR,
  SOURCE as BADGE_SOURCE,
  badgeCentsWithTax,
  pricesArePrevious,
} from '../data/badge-prices';
import {
  budgetFor,
  CATEGORIES,
  CATEGORY_NAMES,
  CATEGORY_NOTES,
  centsFrom,
  dollars,
  lineTotal,
  type Category,
  type Line,
  type Person,
} from '../data/budget';
import { allLines, planLineId } from '../data/budget-lines';
import { conflictsIn } from '../data/conflicts';
import { planningYear } from '../data/key-dates';
import {
  CHECKED,
  GARAGES,
  OFFICIAL_SOURCE,
  REPORTED_SOURCE,
  typicalCents,
} from '../data/parking';
import type { Bookings } from '../hooks/useBookings';
import type { BudgetStore } from '../hooks/useBudget';
import type { Plan } from '../hooks/usePlan';
import type { PlanEntry } from '../data/plan';

interface Props {
  nowMs: number;
  budget: BudgetStore;
  bookings: Bookings;
  plan: Plan;
}

/**
 * Whose a cost is, as a row of names that toggle.
 *
 * Nothing chosen is "everybody", which is both the common case and the one that
 * should not need a click. It is said in words rather than left as an empty row
 * of buttons, because an empty row reads as "nobody" and the difference between
 * nobody and everybody is the whole cost.
 */
function Whose({
  who,
  party,
  onChange,
  disabled,
}: {
  who: string[];
  party: { id: string; name: string }[];
  onChange: (who: string[]) => void;
  disabled?: boolean;
}) {
  if (party.length === 0) return <span className="budget__whose-none">Nobody on the trip yet</span>;
  return (
    <div className="budget__whose">
      {party.map((person) => {
        const on = who.includes(person.id);
        return (
          <button
            key={person.id}
            type="button"
            className={`budget__who${on ? ' budget__who--on' : ''}`}
            aria-pressed={on}
            disabled={disabled}
            onClick={() =>
              onChange(on ? who.filter((id) => id !== person.id) : [...who, person.id])
            }
          >
            {person.name}
          </button>
        );
      })}
      {who.length === 0 && <span className="budget__whose-all">split between everybody</span>}
    </div>
  );
}

/** A money box that keeps what is being typed until it is a number. */
function Money({
  cents,
  onChange,
  label,
}: {
  cents: number;
  onChange: (cents: number) => void;
  label: string;
}) {
  /*
   * Held as text while it is being typed.
   *
   * Reading the box back as cents on every keystroke means selecting all and
   * typing "1" gives 1 cent, then "12" gives 12 — and the moment somebody
   * clears the box to start again it reads as zero and the old number is gone.
   * The text is what they typed; the cents are written out only when it parses.
   */
  const [typing, setTyping] = useState<string | null>(null);
  const shown = typing ?? (cents / 100).toFixed(2);
  return (
    <label className="budget__money">
      <span className="budget__money-label">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        onChange={(event) => {
          setTyping(event.target.value);
          const read = centsFrom(event.target.value);
          if (read !== null) onChange(read);
        }}
        onBlur={() => setTyping(null)}
      />
    </label>
  );
}

export function BudgetView({ nowMs, budget, bookings, plan }: Props) {
  const year = planningYear(nowMs);
  const { party, lines: typed, assigned, badges } = budget;

  const lines = useMemo(
    () => allLines(typed, bookings.all, plan.entries, assigned),
    [typed, bookings.all, plan.entries, assigned],
  );
  const totals = useMemo(() => budgetFor(lines, party), [lines, party]);
  const conflicts = useMemo(
    () => conflictsIn(plan.entries, party, assigned, badges, year),
    [plan.entries, party, assigned, badges, year],
  );

  /**
   * Everybody whose badge has a published price — which is everybody who has
   * chosen one, since `none` is the absence of a badge rather than a free one.
   * Kept as a list rather than a count so the button can add the lines it
   * counted, and cannot drift from them.
   */
  const priceable = useMemo(
    () =>
      party
        .map((person) => ({ person, price: badgeCentsWithTax(budget.badgeOf(person.id)) }))
        .filter((one): one is { person: Person; price: number } => one.price !== null),
    [party, badges, budget],
  );

  const [naming, setNaming] = useState('');
  /** The heading whose "add a cost" form is open, if any. */
  const [adding, setAdding] = useState<Category | null>(null);
  const [draft, setDraft] = useState({ label: '', amount: '', times: '1' });

  const addTo = (category: Category) => {
    const cents = centsFrom(draft.amount);
    const times = Number(draft.times);
    if (cents === null || !Number.isFinite(times) || times <= 0 || !draft.label.trim()) return;
    budget.addLine({ category, label: draft.label.trim(), cents, times, who: [] });
    setDraft({ label: '', amount: '', times: '1' });
    setAdding(null);
  };

  return (
    <section className="budget" aria-label="Budget">
      <header className="budget__head">
        <h2>Gen Con {year}</h2>
        <p className="budget__total">
          <span className="budget__total-money">{dollars(totals.total)}</span>
          <span className="budget__total-note">
            {party.length === 0
              ? 'for the trip. Add who is going to split it between them.'
              : `for the trip · ${dollars(Math.round(totals.total / party.length))} a head on average, across ${party.length} ${party.length === 1 ? 'person' : 'people'}`}
          </span>
        </p>
        {totals.unassigned > 0 && (
          /* Only ever with an empty party, and it is said rather than swallowed:
             the flight still costs what it costs before anybody is named. */
          <p className="budget__waiting">
            {dollars(totals.unassigned)} is waiting on somebody to carry it.
          </p>
        )}
      </header>

      {/* ------------------------------------------------------- who is going */}
      <section className="budget__party" aria-label="Who is going">
        <h3>Who is going</h3>
        <ul className="budget__people">
          {party.map((person) => {
            const column = totals.people.find((one) => one.person.id === person.id);
            return (
              <li key={person.id} className="budget__person">
                <input
                  className="budget__person-name"
                  value={person.name}
                  aria-label={`Name of ${person.name}`}
                  onChange={(event) => budget.renamePerson(person.id, event.target.value)}
                />
                <label className="budget__badge">
                  <span>Badge</span>
                  <select
                    value={budget.badgeOf(person.id)}
                    aria-label={`Badge for ${person.name}`}
                    onChange={(event) =>
                      budget.setBadge(person.id, event.target.value as BadgeKind)
                    }
                  >
                    {BADGE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {BADGE_NAMES[kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="budget__badge-price">
                  {(() => {
                    const price = badgeCentsWithTax(budget.badgeOf(person.id));
                    return price === null ? '' : `${dollars(price)} with tax`;
                  })()}
                </span>
                <span className="budget__person-total">{dollars(column?.total ?? 0)}</span>
                <button
                  type="button"
                  className="budget__drop"
                  aria-label={`Remove ${person.name}`}
                  onClick={() => budget.removePerson(person.id)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
        <form
          className="budget__add-person"
          onSubmit={(event) => {
            event.preventDefault();
            budget.addPerson(naming);
            setNaming('');
          }}
        >
          <label>
            <span className="budget__field-label">Add somebody</span>
            <input
              value={naming}
              placeholder="Name"
              onChange={(event) => setNaming(event.target.value)}
            />
          </label>
          <button type="submit">Add</button>
        </form>
        <button
          type="button"
          className="budget__open-add"
          disabled={!priceable.length}
          onClick={() => {
            for (const { person, price } of priceable) {
              budget.addLine({
                category: 'badge',
                label: `${BADGE_NAMES[budget.badgeOf(person.id)]} · ${person.name}`,
                cents: price,
                times: 1,
                who: [person.id],
              });
            }
          }}
        >
          {priceable.length
            ? `Add ${priceable.length} badge${priceable.length === 1 ? '' : 's'} to the budget`
            : 'Nobody has a badge to price yet'}
        </button>
        <p className="budget__note">
          A badge decides which days somebody can be in the hall, and that is checked against the
          schedule below. The prices are Gen Con&rsquo;s own, off its badge page, with Marion
          County&rsquo;s {Math.round(ADMISSIONS_TAX * 100)}% admissions tax added — the tax is not in
          their table and is charged on every badge type.{' '}
          {pricesArePrevious(year)
            ? `These are ${BADGE_PRICE_YEAR}'s prices; Gen Con has not published ${year}'s yet, and they usually move by a few dollars. `
            : `These are ${BADGE_PRICE_YEAR}'s prices. `}
          Every line stays editable, so type over it with what you actually paid.{' '}
          <a href={BADGE_SOURCE} target="_blank" rel="noreferrer noopener">
            Gen Con&rsquo;s badge page ↗
          </a>
        </p>
      </section>

      {/* ------------------------------------------------- what does not add up */}
      {conflicts.length > 0 && (
        <section className="budget__conflicts" aria-label="Clashes">
          <h3>
            {conflicts.length} thing{conflicts.length === 1 ? '' : 's'} that cannot both be true
          </h3>
          <ul>
            {conflicts.map((conflict, i) => (
              <li
                key={`${conflict.kind}-${conflict.person.id}-${conflict.entries.map((one) => one.id).join('-')}-${i}`}
                className={`budget__conflict budget__conflict--${conflict.kind}`}
              >
                <span className="budget__conflict-tag">
                  {conflict.kind === 'clash' ? 'Two at once' : 'No badge for that day'}
                </span>
                {conflict.says}
              </li>
            ))}
          </ul>
          <p className="budget__note">
            Drawn from the schedule and the badges above. An event with nobody assigned to it counts
            as everybody’s — assign it under Events and tickets to say otherwise.
          </p>
        </section>
      )}

      {/* --------------------------------------------------------- the headings */}
      {CATEGORIES.map((category) => {
        const mine = totals.lines.filter((line) => line.category === category);
        return (
          <section
            key={category}
            className="budget__category"
            aria-label={CATEGORY_NAMES[category]}
          >
            <h3>
              {CATEGORY_NAMES[category]}
              <span className="budget__category-total">{dollars(totals.byCategory[category])}</span>
            </h3>
            <p className="budget__note">{CATEGORY_NOTES[category]}</p>

            {/*
              Events are listed from the schedule rather than from the lines.
              --------------------------------------------------------------
              Most of a Gen Con schedule is free, and a free session has no
              cost line — `linesFromPlan` leaves it out on purpose, because a
              $0.00 row reads as "this is free" where the truth is often
              "nobody has priced it". But whose a session is has to be sayable
              whether or not it costs anything: the clash check above is per
              person, and a session nobody can be assigned to is one that
              clashes for everybody, for ever.

              So this heading lists the whole schedule and carries the money
              where there is money. Every other heading lists its lines.
            */}
            {category === 'event' ? (
              plan.entries.length > 0 && (
                <ul className="budget__lines">
                  {[...plan.entries]
                    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
                    .map((entry) => (
                      <SessionRow
                        key={entry.id}
                        entry={entry}
                        line={mine.find((one) => one.id === planLineId(entry.id)) ?? null}
                        party={party}
                        who={assigned[entry.id] ?? []}
                        onAssign={(who) => budget.assignEvent(entry.id, who)}
                      />
                    ))}
                </ul>
              )
            ) : (
              mine.length > 0 && (
                <ul className="budget__lines">
                  {mine.map((line) => (
                    <LineRow
                      key={line.id}
                      line={line}
                      party={party}
                      budget={budget}
                      bookings={bookings}
                    />
                  ))}
                </ul>
              )
            )}

            {category === 'travel' && (
              <ParkingPicker
                onPick={(label, cents, nights) =>
                  budget.addLine({ category: 'travel', label, cents, times: nights, who: [] })
                }
              />
            )}

            {adding === category ? (
              <form
                className="budget__add-line"
                onSubmit={(event) => {
                  event.preventDefault();
                  addTo(category);
                }}
              >
                <label>
                  <span className="budget__field-label">What</span>
                  <input
                    value={draft.label}
                    placeholder="Flights, dice, the second suitcase"
                    onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                  />
                </label>
                <label>
                  <span className="budget__field-label">Each</span>
                  <input
                    value={draft.amount}
                    inputMode="decimal"
                    placeholder="0.00"
                    onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                  />
                </label>
                <label>
                  <span className="budget__field-label">How many</span>
                  <input
                    value={draft.times}
                    inputMode="numeric"
                    onChange={(event) => setDraft({ ...draft, times: event.target.value })}
                  />
                </label>
                <button type="submit">Add</button>
                <button type="button" onClick={() => setAdding(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="budget__open-add"
                onClick={() => {
                  setDraft({ label: '', amount: '', times: '1' });
                  setAdding(category);
                }}
              >
                Add a cost to {CATEGORY_NAMES[category].toLowerCase()}
              </button>
            )}
          </section>
        );
      })}

      {/* ------------------------------------------------------ down the columns */}
      {party.length > 0 && (
        <section className="budget__columns" aria-label="Each person">
          <h3>Each person</h3>
          <div className="budget__table-scroll">
            <table className="budget__table">
              <thead>
                <tr>
                  <th scope="col">Heading</th>
                  {party.map((person) => (
                    <th scope="col" key={person.id}>
                      {person.name}
                    </th>
                  ))}
                  <th scope="col">All</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.filter((category) => totals.byCategory[category] !== 0).map(
                  (category) => (
                    <tr key={category}>
                      <th scope="row">{CATEGORY_NAMES[category]}</th>
                      {party.map((person) => (
                        <td key={person.id}>
                          {dollars(
                            totals.people.find((one) => one.person.id === person.id)?.byCategory[
                              category
                            ] ?? 0,
                          )}
                        </td>
                      ))}
                      <td>{dollars(totals.byCategory[category])}</td>
                    </tr>
                  ),
                )}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  {party.map((person) => (
                    <td key={person.id}>
                      {dollars(totals.people.find((one) => one.person.id === person.id)?.total ?? 0)}
                    </td>
                  ))}
                  <td>{dollars(totals.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="budget__note">
            Every column and the total are the same money to the cent — a cost that does not divide
            evenly has its odd cents spread rather than dropped.
          </p>
        </section>
      )}

      <p className="budget__note budget__note--foot">
        Kept on this device only. There is no account and nothing is sent anywhere, which also means
        clearing your browser’s data for this site clears this.
      </p>
    </section>
  );
}

/** One cost, with the parts of it that can be changed. */
function LineRow({
  line,
  party,
  budget,
  bookings,
}: {
  line: Line;
  party: { id: string; name: string }[];
  budget: BudgetStore;
  bookings: Bookings;
}) {
  const derived = !!line.from;
  return (
    <li className={`budget__line${derived ? ' budget__line--derived' : ''}`}>
      <div className="budget__line-what">
        <span className="budget__line-label">{line.label}</span>
        {line.note && <span className="budget__line-note">{line.note}</span>}
        {derived && (
          <span className="budget__from">
            {line.from === 'booking'
              ? 'From the hotel you booked — change it on the Hotels page'
              : 'From your schedule — change it on the Schedule page'}
          </span>
        )}
      </div>

      <div className="budget__line-money">
        {derived ? (
          <span className="budget__line-each">
            {dollars(line.cents)}
            {line.times > 1 ? ` × ${line.times}` : ''}
          </span>
        ) : (
          <>
            <Money
              cents={line.cents}
              label="Each"
              onChange={(cents) => budget.changeLine(line.id, { cents })}
            />
            <label className="budget__times">
              <span className="budget__money-label">How many</span>
              <input
                inputMode="numeric"
                value={String(line.times)}
                onChange={(event) => {
                  const times = Number(event.target.value);
                  if (Number.isFinite(times) && times >= 0) budget.changeLine(line.id, { times });
                }}
              />
            </label>
          </>
        )}
        <span className="budget__line-total">{dollars(lineTotal(line))}</span>
      </div>

      <Whose
        who={line.who}
        party={party}
        onChange={(who) => {
          // Three stores, one control. A booking keeps its own answer, a
          // planned session's lives in the assignment map, and a typed line
          // carries it directly — see `budget-lines.ts` for why they differ.
          if (line.from === 'booking') bookings.change(line.id.replace(/^hotel:/, ''), { who });
          else if (line.from === 'plan') budget.assignEvent(line.id.replace(/^event:/, ''), who);
          else budget.changeLine(line.id, { who });
        }}
      />

      {!derived && (
        <button
          type="button"
          className="budget__drop"
          aria-label={`Remove ${line.label}`}
          onClick={() => budget.removeLine(line.id)}
        >
          ✕
        </button>
      )}
    </li>
  );
}

/**
 * One session on the schedule, priced or not.
 *
 * The money is read-only here for the same reason a booked hotel's is: it comes
 * from the feed, and the next render would read it back. Whose it is, though,
 * is this page's own answer and is set here — it is what the clash check runs
 * on, and it has to be sayable for the free sessions as much as the paid ones.
 */
function SessionRow({
  entry,
  line,
  party,
  who,
  onAssign,
}: {
  entry: PlanEntry;
  line: Line | null;
  party: { id: string; name: string }[];
  who: string[];
  onAssign: (who: string[]) => void;
}) {
  return (
    <li className="budget__line budget__line--derived">
      <div className="budget__line-what">
        <span className="budget__line-label">{entry.title}</span>
        <span className="budget__line-note">
          {whenOf(entry)} · {entry.where}
        </span>
        <span className="budget__from">From your schedule — change it on the Schedule page</span>
      </div>

      <div className="budget__line-money">
        <span className="budget__line-total">
          {line ? (
            dollars(lineTotal(line))
          ) : (
            /* Not "$0.00". The feed prices most sessions at nothing and prices
               some not at all, and this page cannot tell those apart — saying
               "free" where it means "nobody said" would be inventing an answer. */
            <span className="budget__free">no ticket price</span>
          )}
        </span>
      </div>

      <Whose who={who} party={party} onChange={onAssign} />
    </li>
  );
}

/** "Sat 2:00 pm", in the convention's own clock — see `conflicts.ts`. */
function whenOf(entry: PlanEntry): string {
  const day = new Date(`${entry.start.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  });
  const hour = Number(entry.start.slice(11, 13));
  const minutes = entry.start.slice(14, 16);
  if (!Number.isFinite(hour)) return day;
  const oClock = hour % 12 === 0 ? 12 : hour % 12;
  return `${day} ${oClock}:${minutes} ${hour < 12 ? 'am' : 'pm'}`;
}

/**
 * Where to leave a car, at two levels of confidence.
 *
 * Gen Con's own partner is first and says so; the rest are downtown garages
 * whose rates are a range attendees report rather than a rate card — see
 * `parking.ts`. So the control adds a line at the middle of the range, the
 * range it came from is printed beside it rather than hidden behind a single
 * figure, and every line stays editable.
 *
 * A garage with no published price still gets a row. It is the official one,
 * and knowing the option exists is most of what this list is for — pressing
 * it opens the booking rather than adding a line, because seeding a line at
 * zero would read as free parking and understate the trip.
 */
function ParkingPicker({
  onPick,
}: {
  onPick: (label: string, cents: number, days: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState('4');

  if (!open) {
    return (
      <button type="button" className="budget__open-add" onClick={() => setOpen(true)}>
        Add parking
      </button>
    );
  }

  const nights = Math.max(1, Number(days) || 1);
  return (
    <div className="budget__parking">
      <label className="budget__parking-days">
        <span className="budget__field-label">Days</span>
        <input inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} />
      </label>
      <ul className="budget__garages">
        {GARAGES.map((garage) => {
          const seed = typicalCents(garage);
          const far =
            garage.metres < 1000
              ? `${garage.metres} m`
              : `${(garage.metres / 1000).toFixed(1)} km`;
          const body = (
            <>
              <span className="budget__garage-name">
                {garage.name}
                {garage.official && <span className="budget__official">Gen Con’s own</span>}
                {garage.skywalk && <span className="budget__skywalk">skywalk</span>}
                {garage.shuttle && <span className="budget__skywalk">free shuttle</span>}
              </span>
              <span className="budget__garage-meta">
                {seed === null
                  ? 'priced when booking opens'
                  : garage.rate === 'published'
                    ? `${dollars(seed)} a day`
                    : `${dollars(garage.lowCents as number)}–${dollars(garage.highCents as number)} a day`}{' '}
                · {far} from the ICC
              </span>
              <span className="budget__garage-note">{garage.note}</span>
            </>
          );
          return (
            <li key={garage.id}>
              {seed === null && garage.reserveUrl ? (
                // No price to seed a line with, so the row is the link rather
                // than a button that would add nothing.
                <a
                  className="budget__garage"
                  href={garage.reserveUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {body}
                </a>
              ) : (
                <button
                  type="button"
                  className="budget__garage"
                  disabled={seed === null}
                  onClick={() => {
                    if (seed === null) return;
                    onPick(`Parking · ${garage.name}`, seed, nights);
                    setOpen(false);
                  }}
                >
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="budget__note">
        Gen Con has had an official parking partner since 2025 — iPark’s lots by Lucas Oil, with a
        free shuttle to the hall — and it prices them per convention, so there is a figure here only
        while booking is open.{' '}
        <a href={OFFICIAL_SOURCE} target="_blank" rel="noreferrer noopener">
          Gen Con on parking ↗
        </a>{' '}
        The rest are downtown garages, and their rates are what attendees report on Gen Con’s
        forums, read {CHECKED} — a range rather than a price. A line is added at the middle of it
        and you can type over it.{' '}
        <a href={REPORTED_SOURCE} target="_blank" rel="noreferrer noopener">
          The forums ↗
        </a>
      </p>
      <button type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}
