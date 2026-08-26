/**
 * The budget page, judged on the claims it makes about somebody's money.
 *
 * The arithmetic is proved in `budget.test.ts` and the joins in
 * `budget-lines.test.ts`. What only exists here is whether the page tells the
 * truth about what it is showing: that a derived line cannot be edited into
 * something the next render will overwrite, that a cost with nobody named on it
 * says it is shared rather than looking unassigned, that parking says where its
 * numbers came from, and that a clash reaches the screen at all.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BudgetView } from './BudgetView';
import { useBookings } from '../hooks/useBookings';
import { useBudget } from '../hooks/useBudget';
import { usePlan } from '../hooks/usePlan';
import type { PlanEntry } from '../data/plan';

/** August 2026, so the planning year is 2027 — Wednesday 4 to Sunday 8 August. */
const NOW = Date.parse('2026-08-26T12:00:00Z');

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/** The page with its three stores, which is how the app renders it. */
function Budget({ entries = [] as PlanEntry[] }) {
  const budget = useBudget();
  const bookings = useBookings();
  const plan = usePlan();
  // The plan is seeded through its own store rather than stubbed, so what is
  // rendered has been through the same reading the app's plan goes through.
  if (plan.entries.length === 0 && entries.length > 0) entries.forEach(plan.add);
  return <BudgetView nowMs={NOW} budget={budget} bookings={bookings} plan={plan} />;
}

const page = () => screen.getByRole('region', { name: 'Budget' });
const section = (name: string) => screen.getByRole('region', { name });
const addPerson = (name: string) => {
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: name } });
  fireEvent.click(within(section('Who is going')).getByRole('button', { name: 'Add' }));
};
const addCost = (heading: string, label: string, amount: string, times = '1') => {
  const where = section(heading);
  fireEvent.click(within(where).getByRole('button', { name: /^Add a cost/ }));
  fireEvent.change(within(where).getByPlaceholderText(/Flights/), { target: { value: label } });
  fireEvent.change(within(where).getByPlaceholderText('0.00'), { target: { value: amount } });
  const boxes = within(where).getAllByRole('textbox');
  fireEvent.change(boxes[boxes.length - 1], { target: { value: times } });
  fireEvent.click(within(where).getByRole('button', { name: 'Add' }));
};

/*
 * Read off the page by their part rather than by their text.
 *
 * A heading's total and its one line's total are the same money and the same
 * string, so `getByText('$1,148.00')` finds two elements and fails — and
 * `getAllByText(...).length` would pass just as happily against a page that
 * printed the figure in the wrong place twice.
 */
const lineTotals = (heading: string) =>
  [...section(heading).querySelectorAll('.budget__line-total')].map((one) => one.textContent);
const headingTotal = (heading: string) =>
  section(heading).querySelector('.budget__category-total')!.textContent;
/** One row of the per-person table, as the strings in its cells. */
const tableRow = (name: string) => {
  const rows = [...section('Each person').querySelectorAll('tbody tr, tfoot tr')];
  const found = rows.find((one) => one.querySelector('th')?.textContent === name)!;
  return [...found.querySelectorAll('td')].map((cell) => cell.textContent);
};

describe('starting from nothing', () => {
  it('opens with a total of nothing rather than a blank', () => {
    render(<Budget />);
    expect(page().textContent).toMatch(/\$0\.00/);
    expect(page().textContent).toMatch(/Add who is going to split it between them/);
  });

  it('shows every heading, so the shape of a trip is visible before it is priced', () => {
    /*
     * A page that only listed the headings somebody had used would open empty
     * and give no hint that food and parking are the two people forget.
     */
    render(<Budget />);
    for (const name of [
      'Badges',
      'Getting there',
      'Hotels',
      'Events and tickets',
      'Food and drink',
      'Merchandise',
      'Everything else',
    ]) {
      expect(section(name)).toBeTruthy();
    }
  });

  it('has no per-person table until somebody is going', () => {
    render(<Budget />);
    expect(screen.queryByRole('region', { name: 'Each person' })).toBeNull();
  });
});

describe('who is going', () => {
  it('adds a person and gives them a column of their own', () => {
    render(<Budget />);
    addPerson('Anna');
    expect(within(section('Who is going')).getByDisplayValue('Anna')).toBeTruthy();
    addCost('Badges', '4-day badge', '130');
    expect(within(section('Each person')).getByRole('columnheader', { name: 'Anna' })).toBeTruthy();
  });

  it('splits a shared cost between them, to the cent', () => {
    // $100 between three is 34/33/33 — the odd cent is spread, not dropped.
    render(<Budget />);
    for (const name of ['Anna', 'Ben', 'Chi']) addPerson(name);
    addCost('Getting there', 'Hire car', '100');
    // $100.00 is 10,000 cents; a third of it is 3,333⅓ and the odd cent goes to
    // the first column. Anna, Ben, Chi, then the whole.
    expect(tableRow('Getting there')).toEqual(['$33.34', '$33.33', '$33.33', '$100.00']);
    expect(tableRow('Total')).toEqual(['$33.34', '$33.33', '$33.33', '$100.00']);
  });

  it('bills only the person a cost is pinned to', () => {
    render(<Budget />);
    addPerson('Anna');
    addPerson('Ben');
    addCost('Badges', 'Badge', '130');
    // Pin it to Ben by pressing his name on the line.
    fireEvent.click(within(section('Badges')).getByRole('button', { name: 'Ben' }));
    expect(tableRow('Badges')).toEqual(['$0.00', '$130.00', '$130.00']);
  });

  it('says a cost with nobody named on it is shared, rather than leaving it blank', () => {
    /*
     * The difference between nobody and everybody is the whole cost, and a row
     * of unpressed buttons reads as nobody.
     */
    render(<Budget />);
    addPerson('Anna');
    addCost('Food and drink', 'Dinner', '40');
    expect(within(section('Food and drink')).getByText('split between everybody')).toBeTruthy();
  });

  it('takes a departing person off the lines they were on', () => {
    // Otherwise their share is stranded on a line belonging to nobody.
    render(<Budget />);
    addPerson('Anna');
    addPerson('Ben');
    addCost('Badges', 'Badge', '130');
    fireEvent.click(within(section('Badges')).getByRole('button', { name: 'Ben' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ben' }));
    // Anna is now the only one on the trip, and the badge falls to her rather
    // than staying pinned to somebody who has gone.
    expect(tableRow('Badges')).toEqual(['$130.00', '$130.00']);
  });
});

describe('costs somebody types', () => {
  it('keeps "each" and "how many" apart so the arithmetic can be checked', () => {
    // "$45 × 4" is a number a reader can verify. "$180" is one they must trust.
    render(<Budget />);
    addPerson('Anna');
    addCost('Food and drink', 'Meals', '45', '4');
    const food = within(section('Food and drink'));
    expect(food.getByDisplayValue('45.00')).toBeTruthy();
    expect(food.getByDisplayValue('4')).toBeTruthy();
    expect(lineTotals('Food and drink')).toEqual(['$180.00']);
  });

  it('keeps a half-typed number rather than reading it as zero', () => {
    /*
     * Everybody edits a number by selecting it and retyping. If the empty box
     * were read back as zero, the amount would be gone before the first digit.
     */
    render(<Budget />);
    addCost('Merchandise', 'Dice', '40');
    const box = within(section('Merchandise')).getByDisplayValue('40.00');
    fireEvent.change(box, { target: { value: '' } });
    expect((box as HTMLInputElement).value).toBe('');
    expect(section('Merchandise').textContent).toMatch(/\$40\.00/);
    fireEvent.change(box, { target: { value: '55' } });
    expect(section('Merchandise').textContent).toMatch(/\$55\.00/);
  });

  it('drops a cost when it is dropped', () => {
    render(<Budget />);
    addCost('Everything else', 'Parking ticket', '40');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Parking ticket' }));
    expect(section('Everything else').textContent).not.toMatch(/Parking ticket/);
  });

  it('refuses a cost with no name on it rather than adding a blank row', () => {
    render(<Budget />);
    const where = section('Merchandise');
    fireEvent.click(within(where).getByRole('button', { name: /^Add a cost/ }));
    fireEvent.change(within(where).getByPlaceholderText('0.00'), { target: { value: '40' } });
    fireEvent.click(within(where).getByRole('button', { name: 'Add' }));
    expect(page().textContent).toMatch(/\$0\.00/);
  });
});

describe('a hotel booked on the hotels page', () => {
  const bookIt = () => {
    window.localStorage.setItem(
      'genCon.bookings',
      JSON.stringify({
        version: 1,
        bookings: [
          {
            placeId: 'w1',
            name: 'JW Marriott Indianapolis',
            nightlyCents: 28_700,
            in: '2027-08-04',
            out: '2027-08-08',
            who: [],
            block: true,
          },
        ],
      }),
    );
  };

  it('appears under hotels without being typed', () => {
    bookIt();
    render(<Budget />);
    const hotels = within(section('Hotels'));
    expect(hotels.getByText('JW Marriott Indianapolis')).toBeTruthy();
    expect(hotels.getByText(/4 nights, 2027-08-04 to 2027-08-08/)).toBeTruthy();
    expect(hotels.getByText(/Gen Con block rate/)).toBeTruthy();
    // $287 a night for four nights, and the heading agrees with the line.
    expect(hotels.getByText('$287.00 × 4')).toBeTruthy();
    expect(lineTotals('Hotels')).toEqual(['$1,148.00']);
    expect(headingTotal('Hotels')).toBe('$1,148.00');
  });

  it('will not be edited here, and says where to change it', () => {
    /*
     * The next render reads it back from the booking, so an edit here would be
     * undone without warning. Refusing it and saying where to go is the honest
     * version of that.
     */
    bookIt();
    render(<Budget />);
    const hotels = within(section('Hotels'));
    expect(hotels.getByText(/change it on the Hotels page/)).toBeTruthy();
    expect(hotels.queryByDisplayValue('287.00')).toBeNull();
    expect(hotels.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('can still be assigned to whoever is sleeping in it', () => {
    bookIt();
    render(<Budget />);
    addPerson('Anna');
    addPerson('Ben');
    fireEvent.click(within(section('Hotels')).getByRole('button', { name: 'Anna' }));
    expect(tableRow('Hotels')).toEqual(['$1,148.00', '$0.00', '$1,148.00']);
  });
});

describe('a priced session on the schedule', () => {
  const ticket: PlanEntry = {
    id: 'RPG27ND1',
    title: 'Curse of Strahd',
    start: '2027-08-06T14:00:00-04:00',
    durationMinutes: 240,
    where: 'ICC : Rm 120',
    cost: 6,
  };

  it('appears under events without being typed', () => {
    render(<Budget entries={[ticket]} />);
    const events = within(section('Events and tickets'));
    expect(events.getByText('Curse of Strahd')).toBeTruthy();
    expect(lineTotals('Events and tickets')).toEqual(['$6.00']);
    expect(events.getByText(/change it on the Schedule page/)).toBeTruthy();
    // The day and time it is on, in the convention's own clock rather than the
    // reader's — this suite runs in UTC, where 2pm Eastern is 6pm.
    expect(events.getByText(/Fri 2:00 pm/)).toBeTruthy();
  });

  it('lists a session nobody priced without pricing it at nothing', () => {
    /*
     * It has to be listed, or it could never be assigned to a person — and an
     * unassignable session clashes for everybody, for ever. But it must not
     * carry $0.00, which reads as "this is free" where the truth is usually
     * "nobody said".
     */
    render(<Budget entries={[{ ...ticket, cost: undefined }]} />);
    const events = within(section('Events and tickets'));
    expect(events.getByText('Curse of Strahd')).toBeTruthy();
    expect(events.getByText('no ticket price')).toBeTruthy();
    // No line carrying $0.00. The heading may well total nothing — nothing is
    // what the priced sessions come to — but no *session* claims to be free.
    expect(lineTotals('Events and tickets')).toEqual(['no ticket price']);
    expect(headingTotal('Events and tickets')).toBe('$0.00');
  });
});

describe('parking', () => {
  it('says Gen Con neither sells nor prices it', () => {
    /*
     * The provenance is the point. These are forum reports, not a rate card,
     * and a page that printed one figure would be inventing a precision that
     * does not exist.
     */
    render(<Budget />);
    fireEvent.click(within(section('Getting there')).getByRole('button', { name: 'Add parking' }));
    const where = section('Getting there');
    expect(where.textContent).toMatch(/Gen Con runs no car park and publishes no rates/);
    expect(where.textContent).toMatch(/a range rather than a price/);
  });

  it('shows a range and how far the garage is from the hall', () => {
    render(<Budget />);
    fireEvent.click(within(section('Getting there')).getByRole('button', { name: 'Add parking' }));
    const where = section('Getting there');
    expect(where.textContent).toMatch(/\$36\.00–\$38\.00 a day/);
    expect(where.textContent).toMatch(/from the ICC/);
    expect(within(where).getAllByText('skywalk').length).toBeGreaterThan(0);
  });

  it('adds a line for the days asked for, at the middle of the range', () => {
    // Circle Centre is reported at $36–38, so the middle is $37 a day.
    render(<Budget />);
    const where = section('Getting there');
    fireEvent.click(within(where).getByRole('button', { name: 'Add parking' }));
    fireEvent.change(within(where).getByLabelText('Days'), { target: { value: '4' } });
    fireEvent.click(within(where).getByRole('button', { name: /Circle Centre Mall/ }));
    expect(within(where).getByText('Parking · Circle Centre Mall')).toBeTruthy();
    expect(within(where).getByDisplayValue('37.00')).toBeTruthy();
    expect(lineTotals('Getting there')).toEqual(['$148.00']);
  });

  it('lets the seeded rate be typed over, because the ticket is the truth', () => {
    render(<Budget />);
    const where = section('Getting there');
    fireEvent.click(within(where).getByRole('button', { name: 'Add parking' }));
    fireEvent.click(within(where).getByRole('button', { name: /Circle Centre Mall/ }));
    const box = within(where).getByDisplayValue('37.00');
    fireEvent.change(box, { target: { value: '52' } });
    expect(lineTotals('Getting there')).toEqual(['$208.00']);
  });
});

describe('what cannot both be true', () => {
  const at = (clock: string, over: Partial<PlanEntry> = {}): PlanEntry => ({
    id: `e-${clock}-${over.id ?? ''}`,
    title: 'A game',
    start: `2027-08-07T${clock}:00:00-04:00`,
    durationMinutes: 120,
    where: 'ICC : Rm 120',
    ...over,
  });

  it('says nothing at all when the plan is fine', () => {
    // A page that opened with a warnings box would train people to ignore it.
    render(<Budget entries={[at('14')]} />);
    expect(screen.queryByRole('region', { name: 'Clashes' })).toBeNull();
  });

  it('catches one person down for two things at once', () => {
    render(<Budget entries={[at('14', { id: 'a', title: 'Strahd' }), at('15', { id: 'b', title: 'Clocktower' })]} />);
    addPerson('Anna');
    const clashes = section('Clashes');
    expect(clashes.textContent).toMatch(/Anna is down for two things at 2:00 pm on Saturday/);
    expect(clashes.textContent).toMatch(/Strahd and Clocktower/);
    expect(within(clashes).getByText('Two at once')).toBeTruthy();
  });

  it('catches an event on a day the badge does not cover', () => {
    render(<Budget entries={[at('10', { id: 'sun', title: 'Ticket to Ride', start: '2027-08-08T10:00:00-04:00' })]} />);
    addPerson('Anna');
    // Anna starts with no badge, which is itself the warning.
    expect(section('Clashes').textContent).toMatch(
      /Anna has no badge yet, and Ticket to Ride is on the Sunday/,
    );
    // Give her a Sunday badge and it goes away.
    fireEvent.change(screen.getByLabelText('Badge for Anna'), { target: { value: 'sunday' } });
    expect(screen.queryByRole('region', { name: 'Clashes' })).toBeNull();
  });

  it('does not clash two people who have split up for the afternoon', () => {
    /*
     * The whole reason the check is per person. A party at two different games
     * at two o'clock is a party doing what parties do.
     */
    render(<Budget entries={[at('14', { id: 'a' }), at('14', { id: 'b' })]} />);
    addPerson('Anna');
    addPerson('Ben');
    fireEvent.change(screen.getByLabelText('Badge for Anna'), { target: { value: 'four-day' } });
    fireEvent.change(screen.getByLabelText('Badge for Ben'), { target: { value: 'four-day' } });
    expect(screen.getByRole('region', { name: 'Clashes' })).toBeTruthy();

    /*
     * Assign one to each and the clash goes. This is why the heading lists the
     * free sessions too: with nothing to press, two people who had split up
     * would clash against each other for ever.
     */
    const rows = [...section('Events and tickets').querySelectorAll('.budget__line')];
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: 'Anna' }));
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: 'Ben' }));
    expect(screen.queryByRole('region', { name: 'Clashes' })).toBeNull();
  });
});
