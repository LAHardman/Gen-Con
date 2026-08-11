/**
 * The schedule page, driven the way somebody builds one.
 *
 * `plan.ts` covers the arithmetic — which four days, which walk, whether it
 * fits. What only shows up here is whether any of that reaches the screen: a
 * travel block drawn on top of its event instead of before it, a ruler printed
 * in the wrong time zone, a now-line on the wrong column, a Wednesday session
 * that can be added and then has nowhere to appear. Each of those leaves a page
 * that looks entirely correct and says something false.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlanView } from './PlanView';
import { planEntry, type PlanEntry } from '../data/plan';
import type { ConEvent } from '../data/events';
import type { EventSearchIndex } from '../data/search';
import type { Plan } from '../hooks/usePlan';
import { ROOMS_BY_ID } from '../data/venues';
import { filterChoices } from '../data/filters';

const THURSDAY = '2026-07-30';
const SATURDAY = '2026-08-01';
/** Half past two on the Saturday afternoon, in Indianapolis. */
const SATURDAY_AFTERNOON = Date.parse(`${SATURDAY}T14:30:00-04:00`);

const FEED_DAYS = ['2026-07-29', THURSDAY, '2026-07-31', SATURDAY, '2026-08-02'];

const session = (over: Partial<ConEvent> & { id: string; start: string }): ConEvent => ({
  title: 'A session',
  locationText: 'ICC',
  ...over,
});

/** A plan holding exactly these, with the calls recorded. */
function planOf(entries: PlanEntry[]): Plan & { toggle: ReturnType<typeof vi.fn> } {
  const toggle = vi.fn();
  return {
    entries,
    planned: (id: string) => entries.some((held) => held.id === id),
    add: vi.fn(),
    remove: vi.fn(),
    toggle,
    describe: vi.fn(),
  };
}

/** An index over a handful of sessions, in the shape `searchSessions` reads. */
const indexOf = (sessions: ConEvent[], roomId = 'hall-a'): EventSearchIndex => ({
  entries: sessions.map((event) => ({
    room: ROOMS_BY_ID[roomId],
    event,
    title: event.title.toLowerCase(),
  })),
});

const opened = vi.fn();

const show = (plan: Plan, events: EventSearchIndex = indexOf([]), nowMs = SATURDAY_AFTERNOON) =>
  render(
    <PlanView
      plan={plan}
      feedDays={FEED_DAYS}
      events={events}
      choices={filterChoices(events.entries.map((entry) => entry.event))}
      nowMs={nowMs}
      onShowRoom={vi.fn()}
      onOpenEvent={opened}
    />,
  );

const morning = planEntry(
  session({ id: 'morning', title: 'Morning game', start: `${SATURDAY}T09:00:00-04:00`, end: `${SATURDAY}T13:00:00-04:00` }),
  { id: 'hall-a' },
);
const afternoon = planEntry(
  session({ id: 'afternoon', title: 'Afternoon seminar', start: `${SATURDAY}T15:00:00-04:00`, end: `${SATURDAY}T16:00:00-04:00` }),
  { id: 'westin-grand-ballroom' },
);

afterEach(() => {
  cleanup();
  opened.mockClear();
});

describe('the four days', () => {
  it('shows Thursday to Sunday and no Wednesday', () => {
    show(planOf([]));
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toMatch(/^Thursday/);
    expect(tabs[3]).toMatch(/^Sunday/);
    expect(tabs.join(' ')).not.toContain('Wednesday');
  });

  it('marks the day it actually is, and opens on it', () => {
    show(planOf([morning]));
    const saturday = screen.getByRole('tab', { name: /^Saturday/ });
    expect(saturday.className).toContain('plan__day--today');
    expect(saturday.getAttribute('aria-selected')).toBe('true');
    // In the accessible name rather than the visible text: the chip is a
    // quarter of a phone wide and "today" truncated to "to…" in it, so the dot
    // carries it on screen and the label carries it for a screen reader.
    expect(saturday.getAttribute('aria-label')).toContain('today');
    expect(screen.getByRole('tab', { name: /^Thursday/ }).className).not.toContain('--today');
  });

  it('marks no day as today outside the convention', () => {
    // A fortnight before. Nothing should be highlighted, and the page should
    // still open on a day rather than on nothing.
    show(planOf([morning]), indexOf([]), Date.parse('2026-07-16T10:00:00-04:00'));
    for (const tab of screen.getAllByRole('tab')) expect(tab.className).not.toContain('--today');
    expect(screen.getByRole('tab', { name: /^Thursday/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('switches to a day when its tab is pressed', () => {
    show(planOf([morning]));
    fireEvent.click(screen.getByRole('tab', { name: /^Thursday/ }));
    expect(screen.getByRole('tab', { name: /^Thursday/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /^Saturday/ }).getAttribute('aria-selected')).toBe('false');
    // Still the day it is, even while another is being read.
    expect(screen.getByRole('tab', { name: /^Saturday/ }).className).toContain('--today');
  });

  it('counts what is on each day', () => {
    show(planOf([morning, afternoon, planEntry(session({ id: 't', start: `${THURSDAY}T10:00:00-04:00` }), { id: 'hall-a' })]));
    expect(screen.getByRole('tab', { name: /^Saturday/ }).textContent).toContain('2 events');
    expect(screen.getByRole('tab', { name: /^Thursday/ }).textContent).toContain('1 event');
    expect(screen.getByRole('tab', { name: /^Sunday/ }).textContent).toContain('nothing yet');
  });
});

describe('the day drawn to scale', () => {
  const saturday = () => document.querySelector('.plan__column--shown')!;
  const px = (element: Element | null) => Number(/top:\s*([\d.-]+)px/.exec((element as HTMLElement)?.style.cssText ?? '')?.[1]);

  it('draws each event, its place and its time', () => {
    show(planOf([morning, afternoon]));
    const blocks = saturday().querySelectorAll('.plan__block');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].textContent).toContain('Morning game');
    expect(blocks[0].textContent).toContain('Hall A');
    expect(blocks[0].textContent).toContain('9:00');
    expect(blocks[1].textContent).toContain('Grand Ballroom');
  });

  it('puts the walk before the event rather than over it', () => {
    // The whole point of drawing it: the travel block occupies the minutes you
    // would be walking, which are the minutes *before* the event starts.
    show(planOf([morning, afternoon]));
    const travel = saturday().querySelector('.plan__travel')!;
    const blocks = saturday().querySelectorAll('.plan__block');
    // The band is the picture and carries no text; the block says the number.
    expect(blocks[1].textContent).toMatch(/\d+ min walk/);
    expect(px(travel)).toBeLessThan(px(blocks[1]));
    expect(px(travel)).toBeGreaterThan(px(blocks[0]));
  });

  it('gives the first event of the day no walk, because there is nothing before it', () => {
    show(planOf([morning]));
    expect(saturday().querySelectorAll('.plan__travel')).toHaveLength(0);
    expect(saturday().querySelectorAll('.plan__block')).toHaveLength(1);
  });

  it('says when the walk does not fit', () => {
    // Morning game runs to one o'clock; this starts at one, in another
    // building. Two tidy rows on a list; visibly impossible here.
    const impossible = planEntry(
      session({ id: 'clash', title: 'Straight after', start: `${SATURDAY}T13:00:00-04:00`, end: `${SATURDAY}T14:00:00-04:00` }),
      { id: 'westin-grand-ballroom' },
    );
    show(planOf([morning, impossible]));
    expect(saturday().querySelector('.plan__travel--clash')).toBeTruthy();
    const clashed = saturday().querySelectorAll('.plan__block--clash');
    expect(clashed).toHaveLength(1);
    // Readable whatever the band's height: a five-minute walk is five pixels,
    // and the walk that most needs reading is always the tightest one. The
    // whole sentence is in the title, because a column can be a quarter of a
    // phone wide and it would be truncated on screen.
    expect(clashed[0].textContent).toContain('tight');
    expect(clashed[0].getAttribute('title')).toContain('still running');
  });

  it('says how long the walk is on the block it is a walk to', () => {
    show(planOf([morning, afternoon]));
    const blocks = saturday().querySelectorAll('.plan__block');
    expect(blocks[0].textContent).not.toMatch(/min walk/);
    expect(blocks[1].textContent).toMatch(/· \d+ min walk/);
  });

  it('rules the day in the convention’s own clock', () => {
    // The bug this is for: building the ruler from milliseconds and formatting
    // them through `toISOString()` puts a Z on them, and every hour label reads
    // four hours out — on a page whose entire purpose is when things are.
    show(planOf([morning, afternoon]));
    // One ruler for all four days, so the labels live above the columns rather
    // than inside any one of them.
    const labels = [...document.querySelectorAll('.plan__hour-label')].map((tick) => tick.textContent);
    // The morning game starts at nine and the axis opens half an hour before.
    expect(labels[0]).toMatch(/^8[:\s]/);
    expect(labels.some((label) => label?.startsWith('9'))).toBe(true);
  });
});

describe('the mark for now', () => {
  it('draws it on today, at the time it is', () => {
    show(planOf([morning, afternoon]));
    const line = document.querySelector('.plan__column--today .plan__now')!;
    expect(line).toBeTruthy();
    expect(line.textContent).toMatch(/2:30/);
  });

  it('draws it on no other day', () => {
    show(planOf([morning, planEntry(session({ id: 't', start: `${THURSDAY}T10:00:00-04:00` }), { id: 'hall-a' })]));
    fireEvent.click(screen.getByRole('tab', { name: /^Thursday/ }));
    expect(document.querySelector('.plan__column--shown .plan__now')).toBeNull();
  });

  it('draws it outside the planned hours too', () => {
    // A Saturday whose only entry was this morning still has to show where in
    // the day you are. Without the axis stretching, the line has nowhere to go.
    show(planOf([morning]), indexOf([]), Date.parse(`${SATURDAY}T22:00:00-04:00`));
    expect(document.querySelector('.plan__column--today .plan__now')).toBeTruthy();
  });
});

describe('adding a session', () => {
  const sessions = [
    session({ id: 'thu', title: 'Painting workshop', start: `${THURSDAY}T10:00:00-04:00`, end: `${THURSDAY}T12:00:00-04:00` }),
    session({ id: 'sat', title: 'Painting workshop', start: `${SATURDAY}T10:00:00-04:00`, end: `${SATURDAY}T12:00:00-04:00` }),
    session({ id: 'wed', title: 'Painting workshop', start: `2026-07-29T10:00:00-04:00`, end: `2026-07-29T12:00:00-04:00` }),
  ];
  const type = (text: string) =>
    fireEvent.change(screen.getByLabelText('Search events to add to your schedule'), {
      target: { value: text },
    });

  it('offers each showing separately, because that is the choice being made', () => {
    // A game running eight times is eight different commitments and only one is
    // the one at two o'clock on the Saturday. The header's search collapses
    // them on purpose; this must not.
    show(planOf([]), indexOf(sessions));
    type('painting');
    const offered = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(offered).toHaveLength(2);
    expect(offered[0]).toContain('Thursday');
    expect(offered[1]).toContain('Saturday');
  });

  it('does not offer a day it cannot show', () => {
    // Trade Day is in the feed and matches the same search. Adding one would
    // put an event in the plan that no column could then draw.
    show(planOf([]), indexOf(sessions));
    type('painting');
    expect(screen.queryByText(/Wednesday/)).toBeNull();
  });

  it('opens the showing that was pressed rather than adding it blind', () => {
    // A title and a room is not enough to decide by: the cost, the age limit
    // and whether any tickets are left are all reasons not to add it, and none
    // of them fit on a result row.
    const plan = planOf([]);
    show(plan, indexOf(sessions));
    type('painting');
    fireEvent.click(screen.getAllByRole('button', { name: /Saturday/ })[0]);
    expect(plan.toggle).not.toHaveBeenCalled();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0][0].event.id).toBe('sat');
  });

  it('shows what is already on the plan', () => {
    const plan = planOf([planEntry(sessions[1], { id: 'hall-a' })]);
    show(plan, indexOf(sessions));
    type('painting');
    const held = screen.getAllByRole('button', { name: /Saturday/ })[0];
    expect(held.getAttribute('aria-pressed')).toBe('true');
  });

  it('says so rather than showing an empty box', () => {
    show(planOf([]), indexOf(sessions));
    type('zzzzzz');
    expect(screen.getByText(/nothing matches/i)).toBeTruthy();
  });

  it('answers a filter with no words in it at all', () => {
    // "Everything on Saturday" is a real question and has nothing to type.
    show(planOf([]), indexOf(sessions));
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    // The chips carry their result count now, so the name is "Saturday1".
    fireEvent.click(within(screen.getByRole('group', { name: 'Day' })).getByRole('button', { name: /^Saturday/ }));
    const offered = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(offered).toHaveLength(1);
    expect(offered[0]).toContain('Saturday');
  });
});

describe('an empty plan', () => {
  it('still shows the four days, and says what to do', () => {
    show(planOf([]));
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    // No ruler at all with nothing to rule: one empty state rather than four.
    expect(document.querySelector('.plan__grid')).toBeNull();
    expect(screen.getByText(/nothing planned yet/i)).toBeTruthy();
  });
});
