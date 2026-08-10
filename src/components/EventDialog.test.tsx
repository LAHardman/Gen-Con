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

describe('the description that is fetched', () => {
  it('shows it when it arrives', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ records: [{ _source: { game_code: event.id, long_description: 'Bring your own sheep.', program: 'Catan Nights' } }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    show();
    await waitFor(() => expect(screen.getByText('Bring your own sheep.')).toBeTruthy());
    expect(fact('Programme')).toBe('Catan Nights');
  });

  it('does not read a description out of an error response', async () => {
    // A gateway or a rate limiter can answer 503 with a body, and a proxy that
    // is not there can answer 200 with the app's own HTML. Neither is the
    // event, whatever it happens to contain.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ records: [{ _source: { game_code: event.id, long_description: 'Not from Gen Con.' } }] }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    show();
    await waitFor(() => expect(screen.queryByText(/loading the description/i)).toBeNull());
    expect(screen.queryByText('Not from Gen Con.')).toBeNull();
  });

  it('says nothing at all when there is no way to fetch it', async () => {
    // No proxy configured, or no network. The feed drops the descriptions on
    // purpose — several megabytes across 27,467 events — so their absence is
    // the normal case and must not read as an error.
    show();
    await waitFor(() => expect(screen.queryByText(/loading the description/i)).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fact('Cost')).toBe('$6');
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
