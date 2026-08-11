/**
 * The panel that stands between finding a session and committing to it.
 *
 * The reason it exists is the reason to test it: adding used to happen on a
 * title and a room, and every fact that would stop somebody adding — forty
 * dollars, 21+, no tickets left, six hours long — was in the feed and off the
 * screen. So what is asserted here is that those facts reach it, that an
 * absent one is left out rather than printed empty, and that the three things
 * you can do from it do what they say.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventDialog } from './EventDialog';
import { ROOMS_BY_ID } from '../data/venues';
import type { ConEvent } from '../data/events';
import type { Plan } from '../hooks/usePlan';

const event: ConEvent = {
  id: 'BGM26ND306429',
  title: 'Catan: Cities & Knights',
  type: 'BGM',
  gameSystem: 'Catan',
  locationText: 'ICC',
  roomText: 'Hall A',
  tableText: '42',
  start: '2026-08-01T14:00:00-04:00',
  end: '2026-08-01T18:00:00-04:00',
  durationMinutes: 240,
  cost: 6,
  ticketsAvailable: 3,
  ageRequirement: 'Everyone (6+)',
  roomId: 'hall-a',
};

const planOf = (ids: string[] = []) => ({
  entries: [],
  planned: (id: string) => ids.includes(id),
  add: vi.fn(),
  remove: vi.fn(),
  toggle: vi.fn(),
  describe: vi.fn(),
});

function show(over: Partial<ConEvent> = {}, plan: Plan = planOf()) {
  const onClose = vi.fn();
  const onShowOnMap = vi.fn();
  const onNavigate = vi.fn();
  render(
    <EventDialog
      event={{ ...event, ...over }}
      room={ROOMS_BY_ID['hall-a']}
      plan={plan}
      onClose={onClose}
      onShowOnMap={onShowOnMap}
      onNavigate={onNavigate}
    />,
  );
  return { onClose, onShowOnMap, onNavigate, plan };
}

/** The value beside a label in the facts list. */
const fact = (label: string) => screen.queryByText(label)?.nextElementSibling?.textContent ?? null;

beforeEach(() => {
  // No proxy in a test environment: the description simply never arrives, which
  // is one of the states this has to survive.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('what it says', () => {
  it('carries every reason somebody might not add it', () => {
    show();
    expect(screen.getByRole('heading', { name: /Catan: Cities/ })).toBeTruthy();
    expect(fact('Cost')).toBe('$6');
    expect(fact('Tickets')).toBe('3 left');
    expect(fact('Age')).toBe('Everyone (6+)');
    expect(fact('Runs for')).toBe('4 h');
    expect(fact('Type')).toBe('Board Game');
    expect(fact('System')).toBe('Catan');
  });

  it('says where, down to the table', () => {
    expect(show().onClose).toBeTruthy();
    expect(fact('Where')).toContain('Hall A');
    expect(fact('Where')).toContain('Convention Center');
    expect(fact('Where')).toContain('Table 42');
  });

  it('says Free rather than $0, and None left rather than 0 left', () => {
    show({ cost: 0, ticketsAvailable: 0 });
    expect(fact('Cost')).toBe('Free');
    expect(fact('Tickets')).toBe('None left');
  });

  it('leaves a row out rather than printing it empty', () => {
    // "Cost: —" is noise. A row's absence is already the honest statement that
    // the source did not say.
    show({ cost: undefined, gameSystem: undefined, ticketsAvailable: undefined, ageRequirement: undefined });
    expect(screen.queryByText('Cost')).toBeNull();
    expect(screen.queryByText('System')).toBeNull();
    expect(screen.queryByText('Tickets')).toBeNull();
    expect(screen.queryByText('Age')).toBeNull();
    // The ones that are always known stay.
    expect(fact('When')).toContain('Sat');
  });

  it('links out to the full listing', () => {
    show();
    const link = screen.getByRole('link', { name: /gencon\.com/i });
    expect(link.getAttribute('href')).toContain('306429');
  });
});

describe('the description, on request', () => {
  const answers = (body: object, status = 200) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
    );
  const record = (over: object = {}) => ({
    records: [{ _source: { game_code: event.id, long_description: 'Bring your own sheep.', ...over } }],
  });
  const expand = () => fireEvent.click(screen.getByRole('button', { name: /show full description/i }));

  it('asks for nothing until the button is pressed', async () => {
    // Opening this on a phone in an exhibit hall should not spend a request on
    // a paragraph nobody has asked to read.
    answers(record());
    show();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText('Bring your own sheep.')).toBeNull();

    expand();
    await waitFor(() => expect(screen.getByText('Bring your own sheep.')).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks for that one event and nothing else', () => {
    answers(record());
    show();
    expand();
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(event.id);
  });

  it('brings the programme back with it', async () => {
    answers(record({ program: 'Catan Nights' }));
    show();
    expand();
    await waitFor(() => expect(fact('Programme')).toBe('Catan Nights'));
  });

  it('does not read a description out of an error response', async () => {
    // A gateway or a rate limiter can answer 503 with a body, and a proxy that
    // is not there can answer 200 with the app's own HTML. Neither is the
    // event, whatever it happens to contain.
    answers({ records: [{ _source: { game_code: event.id, long_description: 'Not from Gen Con.' } }] }, 503);
    show();
    expand();
    await waitFor(() => expect(screen.getByText(/couldn’t read the description/i)).toBeTruthy());
    expect(screen.queryByText('Not from Gen Con.')).toBeNull();
  });

  it('does not even try when the browser says there is no network', () => {
    // A button that says why beats a spinner that times out after thirty
    // seconds, which is what an exhibit hall gives you.
    answers(record());
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    show();
    expand();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/no connection/i)).toBeTruthy();
  });

  it('says it could not read one rather than showing a blank', async () => {
    answers({ records: [] });
    show();
    expand();
    await waitFor(() => expect(screen.getByText(/couldn’t read the description/i)).toBeTruthy());
  });
});

describe('a description already saved', () => {
  const withSaved = (description: string) => ({
    ...planOf([event.id]),
    entries: [{ id: event.id, title: event.title, start: event.start, where: 'Hall A', description }],
  });

  it('shows it at once and asks the network for nothing', () => {
    // The whole point of keeping it: this is what happens in an exhibit hall
    // with no signal, on the events somebody actually committed to.
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    show({}, withSaved('Saved for the show floor.') as unknown as Plan);
    expect(screen.getByText('Saved for the show floor.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /show full description/i })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('knows the difference between having none and not having asked', () => {
    // An empty saved description means the source was asked and had nothing.
    // Offering the button again would spend a request to learn the same thing.
    show({}, withSaved('') as unknown as Plan);
    expect(screen.getByText(/has no description/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /show full description/i })).toBeNull();
  });
});

describe('the three things you can do', () => {
  it('adds it, and offers to take it off again once it is on', () => {
    const plan = planOf();
    show({}, plan);
    fireEvent.click(screen.getByRole('button', { name: 'Add to schedule' }));
    expect(plan.toggle).toHaveBeenCalledTimes(1);
    expect(plan.toggle.mock.calls[0][0]).toMatchObject({ id: event.id, roomId: 'hall-a' });

    cleanup();
    show({}, planOf([event.id]));
    expect(screen.getByRole('button', { name: 'Remove from schedule' })).toBeTruthy();
  });

  it('shows it on the map', () => {
    const { onShowOnMap } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }));
    expect(onShowOnMap).toHaveBeenCalledWith('hall-a');
  });

  it('starts directions to it', () => {
    const { onNavigate } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Directions' }));
    expect(onNavigate.mock.calls[0][0]?.id).toBe('hall-a');
  });

  it('closes on Escape and on the backdrop', () => {
    const { onClose } = show();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // The backdrop is how it is dismissed on a phone, and the panel itself must
    // not close when a fact inside it is pressed.
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.querySelector('.dialog__backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
