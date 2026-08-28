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

import { EventDialog, type Detail } from './EventDialog';
import { ROOMS_BY_ID } from '../data/venues';
import type { ConEvent } from '../data/events';
import type { Plan } from '../hooks/usePlan';
import { EXHIBITORS, tagsOf } from '../data/exhibitors';
import { planEntry, stopEntry } from '../data/plan';

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
  return open({ kind: 'event', event: { ...event, ...over }, room: ROOMS_BY_ID['hall-a'] }, plan);
}

/** The four days, as the feed hands them over. */
const FEED_DAYS = ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'];

function open(
  detail: Detail,
  plan: Plan = planOf(),
  over: { feedDays?: readonly string[]; offsetMinutes?: number | null } = {},
) {
  const onClose = vi.fn();
  const onShowOnMap = vi.fn();
  const onNavigate = vi.fn();
  render(
    <EventDialog
      detail={detail}
      plan={plan}
      feedDays={over.feedDays ?? FEED_DAYS}
      offsetMinutes={over.offsetMinutes === undefined ? -240 : over.offsetMinutes}
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

  it('shows it on the map, by its room and nothing finer', () => {
    // An event is in a room and that is the whole address it has, so no
    // booth travels with it — the second argument is the exhibit hall's
    // case, not this one.
    const { onShowOnMap } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }));
    expect(onShowOnMap).toHaveBeenCalledWith('hall-a', undefined);
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

describe('a vendor rather than an event', () => {
  const truck = EXHIBITORS.find((one) => one.name === 'Arepas')!;
  const showVendor = (over: Partial<typeof truck> = {}) =>
    open({ kind: 'vendor', exhibitor: { ...truck, ...over }, room: ROOMS_BY_ID['block-party-street'] });

  it('says when they are open rather than when a session runs', () => {
    // A vendor is a place with hours, not a session with a start time.
    showVendor();
    expect(fact('Open')).toContain('Thu–Sat 9am–9pm');
    expect(screen.queryByText('When')).toBeNull();
    expect(screen.queryByText('Runs for')).toBeNull();
  });

  it('says which year the hours are, because they are last year’s', () => {
    // Gen Con has not published 2026's. Showing 2025's without saying so would
    // be telling somebody when to turn up using a different convention's times.
    showVendor();
    expect(fact('Open')).toContain('2025');
  });

  it('leaves the row out where nothing publishes hours at all', () => {
    const inTheHall = EXHIBITORS.find((one) => one.area === 'Exhibit Hall')!;
    open({ kind: 'vendor', exhibitor: inTheHall, room: ROOMS_BY_ID['hall-a'] });
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('shows a stand by its booth, not just by the hall it is in', () => {
    // The hall is four hundred metres of floor and the booth number is the
    // address that floor actually uses, so the number has to reach the map
    // — passing the room alone is what sent it to the middle of Hall A.
    const inTheHall = EXHIBITORS.find((one) => one.area === 'Exhibit Hall' && one.booth)!;
    const { onShowOnMap } = open({
      kind: 'vendor',
      exhibitor: inTheHall,
      room: ROOMS_BY_ID['hall-a'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }));
    expect(onShowOnMap).toHaveBeenCalledWith('hall-a', inTheHall.booth);
  });

  it('splits what they sell into the three questions', () => {
    showVendor();
    expect(fact('Cuisine')).toContain('Venezuelan');
    expect(fact('Serves')).toContain('Arepa');
    expect(fact('Dietary')).toContain('Vegan Options');
    // What kind of stall it is, kept but not dressed up as a food type.
    expect(fact('Also')).toContain('Food Truck');
  });

  it('does not say Block Party twice, or repeat the heading', () => {
    // The Block Party is a room called Block Party inside a venue called Block
    // Party. Printed straight through, the address reads as a stutter — and
    // "Kind: Food & Drink" under a heading that already says FOOD & DRINK is
    // the same fault in the other direction.
    showVendor();
    expect(fact('Where')).toBe('Block Party · Food Truck 12');
    expect(screen.queryByText('Kind')).toBeNull();
  });

  it('links to their own site instead of to gencon.com', () => {
    // Gen Con publishes no menus. Their own page — a Facebook one for 15 of the
    // 43 — is where a food truck actually posts what it is cooking.
    showVendor();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(truck.website);
    expect(link.textContent).toMatch(/their own site/i);
    expect(screen.queryByText(/gencon\.com/i)).toBeNull();
  });

  it('offers the same description button', () => {
    showVendor();
    expect(screen.getByRole('button', { name: /show full description/i })).toBeTruthy();
  });

  it('asks the exhibitor record for it, not the event search', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ id: truck.id, description: 'Arepas, all day.' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    showVendor();
    fireEvent.click(screen.getByRole('button', { name: /show full description/i }));
    const asked = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(asked).toContain('exhibitor_profiles');
    expect(asked).toContain(String(truck.id));
    expect(asked).not.toContain('event_search');
  });

  it('refuses a record that is not this vendor', async () => {
    // A proxy that is not there answers 200 with the app's own HTML, and a
    // shared cache can answer with the last exhibitor asked for. Neither is
    // this one, whatever description it happens to carry.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ id: (truck.id ?? 0) + 1, description: 'Somebody else entirely.' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    showVendor();
    fireEvent.click(screen.getByRole('button', { name: /show full description/i }));
    await waitFor(() => expect(screen.getByText(/couldn’t read the description/i)).toBeTruthy());
    expect(screen.queryByText('Somebody else entirely.')).toBeNull();
  });

  it('can be put on the schedule, once somebody says when', () => {
    // A session brings its own times and this panel only says yes to them. A
    // truck brings none, so "add" opens the form rather than adding on the spot.
    const plan = planOf();
    open({ kind: 'vendor', exhibitor: truck, room: ROOMS_BY_ID['block-party-street'] }, plan);
    fireEvent.click(screen.getByRole('button', { name: /add to schedule/i }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '18:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '18:30' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add to schedule$/ }));

    const entry = (plan.add as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry.kind).toBe('stop');
    expect(entry.title).toBe('Arepas');
    expect(entry.start).toBe('2026-07-30T18:00:00-04:00');
    expect(entry.roomId).toBe('block-party-street');
  });

  it('offers no form when nothing has said when the convention is', () => {
    // No feed and an empty plan: there is no day to put it on and no clock to
    // read "18:00" against, and inventing one would put it on the wrong
    // afternoon. The map and directions still work, because they always can.
    open({ kind: 'vendor', exhibitor: truck, room: ROOMS_BY_ID['block-party-street'] }, planOf(), {
      feedDays: [],
      offsetMinutes: null,
    });
    expect(screen.queryByRole('button', { name: /add to schedule/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show on map' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Directions' })).toBeTruthy();
  });

  it('says nothing about a website it does not have', () => {
    showVendor({ website: undefined });
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('something already on the schedule', () => {
  const lunch = stopEntry(
    { key: 'vendor:14179', title: 'Arepas', where: 'Food Truck 12 · Block Party', roomId: 'block-party-street' },
    { day: '2026-08-01', fromMinutes: 13 * 60, toMinutes: 13 * 60 + 25, offsetMinutes: -240 },
  );

  it('reads from the copy on the device rather than looking the event up', () => {
    // The point of a plan holding a copy: this panel has to open underground,
    // and next year, when the feed that made it is a different convention.
    open({ kind: 'planned', entry: lunch, room: ROOMS_BY_ID['block-party-street'] });
    expect(screen.getByRole('heading', { name: 'Arepas' })).toBeTruthy();
    expect(fact('When')).toContain('1:00');
    expect(fact('Where')).toBe('Food Truck 12 · Block Party');
  });

  it('is where removing happens, now that a block has no buttons', () => {
    const plan = planOf();
    const { onClose } = open({ kind: 'planned', entry: lunch }, plan);
    fireEvent.click(screen.getByRole('button', { name: /remove from schedule/i }));
    expect((plan.remove as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(lunch.id);
    // And it closes: the thing the panel was about is no longer there.
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the description it saved, with nothing fetched', () => {
    open({ kind: 'planned', entry: { ...lunch, description: 'Arepas, made to order.' } });
    expect(screen.getByText('Arepas, made to order.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /show full description/i })).toBeNull();
  });

  it('says what a planned food stop sells, the same as the vendor panel does', () => {
    // The schedule is where it is most needed: standing on South Street at one
    // o'clock deciding whether the walk is worth it, "Venezuelan · arepas ·
    // vegan options" is the answer, and it is looked up from the id in the
    // entry rather than copied into it.
    const arepas = EXHIBITORS.find((one) => one.name === 'Arepas')!;
    open({ kind: 'planned', entry: { ...lunch, id: `vendor:${arepas.id}@2026-08-01T13:00` } });
    expect(fact('Cuisine')).toBe('Venezuelan');
    expect(fact('Serves')).toBe('Arepa');
    expect(fact('Dietary')).toContain('Vegan Options');
    // And its own When rather than the truck's opening hours, which it was
    // already checked against when it was added.
    expect(fact('When')).toContain('1:00');
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('says nothing about what a room sells, having no answer', () => {
    open({ kind: 'planned', entry: { ...lunch, id: 'place:hall-a@2026-08-01T13:00' } });
    expect(screen.queryByText('Cuisine')).toBeNull();
    expect(screen.queryByText('Serves')).toBeNull();
  });

  it('links a food stop to the truck’s own page', () => {
    // The nearest thing to a menu that exists anywhere, and the schedule is
    // where somebody standing on South Street at one o'clock wants it. Looked
    // up from the bundled catalogue by the id in the entry, so it works with no
    // network — the id is `vendor:14179@…` and 14179 is Arepas.
    const arepas = EXHIBITORS.find((one) => one.name === 'Arepas')!;
    open({ kind: 'planned', entry: { ...lunch, id: `vendor:${arepas.id}@2026-08-01T13:00` } });
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(arepas.website);
    expect(link.textContent).toMatch(/their own site/i);
  });

  it('does not offer a gencon.com link for a stop that has no page', () => {
    // A stop's id ends in a clock, and the event URL is built from trailing
    // digits — so a room or an unlisted stand would link to /events/00.
    open({ kind: 'planned', entry: { ...lunch, id: 'place:hall-a@2026-08-01T13:00' } });
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('still links a planned session to its own page', () => {
    const planned = { ...planEntry(event, ROOMS_BY_ID['hall-a']), description: 'Saved.' };
    open({ kind: 'planned', entry: planned, room: ROOMS_BY_ID['hall-a'] });
    expect(screen.getByRole('link').getAttribute('href')).toContain('gencon.com/events/');
  });
});

const showVendorPanel = () =>
  open({
    kind: 'vendor',
    exhibitor: EXHIBITORS.find((one) => one.name === 'Arepas')!,
    room: ROOMS_BY_ID['block-party-street'],
  });

describe('a vendor that is not food', () => {
  const kenzer = EXHIBITORS.find((one) => tagsOf(one).length > 2 && one.kind === 'Exhibitors')!;

  it('says what Gen Con tags it with, in one row', () => {
    // The food ones are filed into cuisine, dish and dietary because somebody
    // looking for lunch is asking exactly one of those. A stand's tags are what
    // it is, what it sells, what genre and who runs it, and inventing four
    // labels Gen Con has not written would be inventing them.
    open({ kind: 'vendor', exhibitor: kenzer, room: ROOMS_BY_ID['hall-a'] });
    const shown = fact('Tags')!;
    for (const tag of tagsOf(kenzer)) expect(shown).toContain(tag);
    // Not split into the food facets, which mean nothing here.
    expect(screen.queryByText('Cuisine')).toBeNull();
    expect(screen.queryByText('Serves')).toBeNull();
  });

  it('leaves the row out for a stand Gen Con tags with nothing', () => {
    open({ kind: 'vendor', exhibitor: { ...kenzer, tags: [] }, room: ROOMS_BY_ID['hall-a'] });
    expect(screen.queryByText('Tags')).toBeNull();
  });

  it('keeps the food panel’s three rows for a food stand', () => {
    // The two paths are exclusive: a truck gets the split and nothing gets both.
    showVendorPanel();
    expect(fact('Cuisine')).toBe('Venezuelan');
    expect(screen.queryByText('Tags')).toBeNull();
  });
});
