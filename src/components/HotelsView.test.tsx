/**
 * The hotels page, judged on how it handles the numbers it is least sure of.
 *
 * The gathering rules are tested in `scripts/lib/rates` and the arithmetic there
 * is exact. What only exists here is whether the least reliable data in this app
 * reaches a screen honestly: a price with no date on it, a two-service
 * disagreement quietly averaged away, a column of blanks where "we have not
 * asked yet" was the truth, or — the one that would actually cost somebody money
 * — a table that lets itself be read as the Gen Con block rate.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const BLOCK: Record<string, unknown> = {
  w1: { placeId: 'w1', blockName: 'JW Marriott Indianapolis', low: 287, high: 620, region: 'downtown', skywalk: true, distance: 'Skywalk' },
  w2: { placeId: 'w2', blockName: 'The Westin Indianapolis', low: 276, high: 346, region: 'downtown', skywalk: true, distance: 'Skywalk' },
};

vi.mock('../data/partners', () => ({
  BLOCK_YEAR: 2025,
  BLOCK_GROWTH: 0.028,
  CAVEAT: 'Starting rates that vary by room type, and before local taxes.',
  SOURCE: 'https://example.invalid/hotelmap',
  HISTORY_SOURCE: 'https://example.invalid/thread',
  PARTNERS: Object.values(BLOCK),
  CHEAPEST: { blockName: 'LaQuinta Airport', low: 109, distance: '7.2 Miles', region: 'airport' },
  SUSPECTED_IN_BLOCK: new Set<string>(),
  isPartner: (id: string) => id in BLOCK,
  partnerFor: (id: string) => BLOCK[id] ?? null,
}));

vi.mock('../data/lodging', () => ({
  WALK_METRES: 1600,
  DRIVE_METRES: 25000,
  PULLED: '2026-08-11',
  SAMPLED: true,
  LODGING: [
    { id: 'w1', name: 'JW Marriott Indianapolis', kind: 'hotel', metres: 124, ring: 'walk', lat: 0, lng: 0 },
    { id: 'far', name: 'Airport Motel', kind: 'motel', metres: 12000, ring: 'drive', lat: 0, lng: 0, city: 'Plainfield' },
    { id: 'w2', name: 'The Westin Indianapolis', kind: 'hotel', metres: 280, ring: 'walk', lat: 0, lng: 0 },
    { id: 'w3', name: 'Nestle Inn', kind: 'guest_house', metres: 900, ring: 'walk', lat: 0, lng: 0 },
    { id: 'w5', name: 'Unasked Lodge', kind: 'hotel', metres: 1400, ring: 'walk', lat: 0, lng: 0 },
    { id: 'w4', name: 'Holiday Inn Express', kind: 'hotel', metres: 1200, ring: 'walk', lat: 0, lng: 0 },
    { id: 'd1', name: 'Motel 6 Southport', kind: 'motel', metres: 14000, ring: 'drive', lat: 0, lng: 0, city: 'Southport' },
    { id: 'd2', name: 'Super 8 Airport', kind: 'motel', metres: 9000, ring: 'drive', lat: 0, lng: 0 },
  ],
  WALKABLE: [],
}));

vi.mock('../data/rates', () => {
  const RATES = [
    { placeId: 'd1', nightly: 71, currency: 'USD', sources: ['xotelo'], at: '2026-08-09', spread: 0 },
    { placeId: 'w1', nightly: 289, currency: 'USD', sources: ['serpapi', 'xotelo'], at: '2026-06-02', spread: 40 },
    { placeId: 'w2', nightly: 240, currency: 'USD', sources: ['serpapi'], at: '2026-08-10', spread: 0 },
    { placeId: 'w4', nightly: 165, currency: 'USD', sources: ['serpapi', 'xotelo'], at: '2026-08-10', spread: 40 },
    { placeId: 'w3', nightly: 200, currency: 'USD', sources: ['serpapi'], at: '2026-06-02', spread: 0 },
    { placeId: 'far', nightly: 120, currency: 'USD', sources: ['xotelo'], at: '2026-08-08', spread: 0 },
  ];
  return {
    RATES,
    REFRESHED: '2026-08-11',
    WALK_FLOOR: 240,
    rateFor: (id: string) => RATES.find((one) => one.placeId === id) ?? null,
  };
});

const { HotelsView } = await import('./HotelsView');

afterEach(cleanup);

const NOW = Date.parse('2026-08-11T12:00:00Z');
const page = () => screen.getByRole('region', { name: 'Hotels' });
const rows = () => screen.getAllByRole('listitem');
const row = (name: string) => rows().find((one) => one.textContent?.includes(name))!;

describe('what it refuses to be mistaken for', () => {
  /*
   * Each price says what kind of number it is, on the number itself.
   *
   * This used to be a box above the list explaining all three kinds at once,
   * which is a thing a reader passes on the way to the prices and never looks
   * at again. The distinction is what decides how far to trust a row, so it
   * lives on the row.
   */
  const told = (name: string) => within(row(name)).getByRole('button');

  it('calls a published block rate what it is', () => {
    render(<HotelsView nowMs={NOW} />);
    // 2027 planning year, so the JW's is carried forward and says so.
    expect(told('JW Marriott').getAttribute('aria-label')).toMatch(
      /An estimate\. Gen Con’s real 2025 block rate of \$287 the room, carried forward 2 years/,
    );
  });

  it('calls a bought price an indication rather than a quote', () => {
    render(<HotelsView nowMs={NOW} />);
    const say = told('Holiday Inn Express').getAttribute('aria-label')!;
    expect(say).toMatch(/A market rate, not a quote/);
    expect(say).toMatch(/serpapi and xotelo/);
    expect(say).toMatch(/gathered yesterday/);
    expect(say).toMatch(/they differ by \$40/);
  });

  it('says a missing price is a gap in the asking, not a verdict on the hotel', () => {
    render(<HotelsView nowMs={NOW} />);
    expect(told('Unasked Lodge').getAttribute('aria-label')).toMatch(
      /Nobody has gathered a market rate for this one yet/,
    );
  });

  it('opens the blurb on hover and shuts it when the pointer leaves', () => {
    render(<HotelsView nowMs={NOW} />);
    const price = told('JW Marriott');
    expect(page().querySelector('.hotels__bubble')).toBeNull();

    fireEvent.mouseEnter(price);
    expect(page().querySelector('.hotels__bubble')!.textContent).toMatch(/An estimate/);

    fireEvent.mouseLeave(price);
    expect(page().querySelector('.hotels__bubble')).toBeNull();
  });

  it('opens it on a tap too, and shuts it on a tap elsewhere', () => {
    // A phone has no hover, so a tooltip that only hovers is a tooltip half the
    // readers never see.
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(told('JW Marriott'));
    expect(page().querySelector('.hotels__bubble')).toBeTruthy();

    fireEvent.pointerDown(page().querySelector('.hotels__head')!);
    expect(page().querySelector('.hotels__bubble')).toBeNull();
  });

  it('does not close on a click that follows its own hover', () => {
    // With a mouse the hover has already opened it; a click that toggled would
    // read as the page snatching the answer back.
    render(<HotelsView nowMs={NOW} />);
    const price = told('JW Marriott');
    fireEvent.mouseEnter(price);
    fireEvent.click(price);
    expect(page().querySelector('.hotels__bubble')).toBeTruthy();
  });

  it('shuts it on Escape', () => {
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(told('JW Marriott'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(page().querySelector('.hotels__bubble')).toBeNull();
  });

  it('says the hotel list is a sample rather than every hotel there is', () => {
    render(<HotelsView nowMs={NOW} />);
    expect(page().textContent).toMatch(/sample rather than a complete list/i);
  });
});

describe('putting the list in an order', () => {
  const listed = () =>
    [...page().querySelectorAll('.hotels__list .hotels__row h3')].map(
      (one) => one.firstChild!.textContent,
    );
  const by = (which: string) => fireEvent.click(screen.getByRole('button', { name: which }));

  it('starts on distance, the one number this app is sure of', () => {
    render(<HotelsView nowMs={NOW} />);
    expect(screen.getByRole('button', { name: 'Distance' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(listed()[0]).toBe('JW Marriott Indianapolis');
  });

  it('sorts by price with the unpriced last, not first', () => {
    // "Cheapest first" with a blank at the top would answer a question about
    // money with the one row there is no money for.
    render(<HotelsView nowMs={NOW} />);
    by('Price');
    expect(listed()).toEqual([
      'Motel 6 Southport',
      'Airport Motel',
      'Holiday Inn Express',
      'Nestle Inn',
      'The Westin Indianapolis',
      'JW Marriott Indianapolis',
      'Unasked Lodge',
      'Super 8 Airport',
    ]);
  });

  it('sorts by rating on the chain each name belongs to, and says so', () => {
    /*
     * There is no rating. OpenStreetMap has a `stars` tag and nothing near the
     * hall fills it in, and no reviews have been gathered — so this orders on
     * the brand, and the page has to admit that rather than let a reader take
     * it for a score.
     */
    render(<HotelsView nowMs={NOW} />);
    by('Rating');
    expect(listed()).toEqual([
      'JW Marriott Indianapolis', // luxury
      'The Westin Indianapolis', // upper upscale
      'Nestle Inn', // nothing in the name, so the middle
      'Unasked Lodge',
      'Holiday Inn Express', // midscale
      'Super 8 Airport', // economy, nearest first among equals
      'Airport Motel',
      'Motel 6 Southport',
    ]);
    expect(page().textContent).toMatch(/orders by the chain each name belongs to/i);
    // And the band it landed in shows on the row, so the order is legible.
    expect(within(row('JW Marriott')).getByText(/luxury/)).toBeTruthy();
  });

  it('says nothing about chains when it is not sorting by them', () => {
    render(<HotelsView nowMs={NOW} />);
    expect(page().textContent).not.toMatch(/orders by the chain/i);
    expect(row('JW Marriott').textContent).not.toMatch(/luxury/);
  });
});

describe('how old a price is', () => {
  it('puts an age on every bought one', () => {
    render(<HotelsView nowMs={NOW} />);
    expect(within(row('Holiday Inn Express')).getByText(/yesterday/)).toBeTruthy();
    // Ten weeks old, and it has to look it rather than sitting beside a fresh
    // one in the same typeface with no date.
    expect(within(row('Nestle Inn')).getByText(/months? ago|weeks ago/)).toBeTruthy();
  });

  it('shows a gap as a gap, not as a zero', () => {
    render(<HotelsView nowMs={NOW} />);
    // Nobody has asked about this one, and a blank must read as a blank.
    const lodge = row('Unasked Lodge');
    expect(within(lodge).getByText('no price')).toBeTruthy();
    expect(lodge.textContent).not.toMatch(/\$0/);
  });
});

describe('when two services disagree', () => {
  it('says by how much rather than hiding it', () => {
    // The honest width of "about $289". Averaging it away would make one number
    // look surer than the two that produced it.
    render(<HotelsView nowMs={NOW} />);
    expect(within(row('Holiday Inn Express')).getByText(/they differ by 40/)).toBeTruthy();
    expect(within(row('Holiday Inn Express')).getByText(/serpapi, xotelo/)).toBeTruthy();
  });

  it('names the single source when only one answered', () => {
    render(<HotelsView nowMs={NOW} />);
    const nestle = row('Nestle Inn');
    expect(within(nestle).getByText('serpapi')).toBeTruthy();
    expect(nestle.textContent).not.toMatch(/they differ/);
  });
});

describe('filters that can all be off at once', () => {
  const listed = () =>
    [...page().querySelectorAll('.hotels__list .hotels__row h3')].map(
      (one) => one.firstChild!.textContent,
    );
  const chip = (name: string) => screen.getByRole('button', { name });
  const slide = (label: string, value: number) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } });
  /** Click the reading, type a number, press Enter — the other way in. */
  const type = (label: string, text: string) => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label} limit`) }));
    const field = screen.getByLabelText(new RegExp(`^${label} limit in`));
    fireEvent.change(field, { target: { value: text } });
    fireEvent.keyDown(field, { key: 'Enter' });
  };

  const fold = () => screen.getByRole('button', { name: /Filters and sorting/ });

  it('folds the controls away and brings them back', () => {
    /*
     * Seven rows of controls is most of a phone screen. A reader who has set
     * them is done with them and wants the hotels — but must be able to get
     * them back without scrolling to the top of two hundred rows, which is why
     * the bar stays put rather than scrolling away with them.
     */
    const panel = () => page().querySelector('.hotels__panel')!;
    render(<HotelsView nowMs={NOW} />);
    expect(fold().getAttribute('aria-expanded')).toBe('true');
    expect(panel().hasAttribute('hidden')).toBe(false);

    fireEvent.click(fold());
    expect(fold().getAttribute('aria-expanded')).toBe('false');
    expect(panel().hasAttribute('hidden')).toBe(true);
    // The list is untouched by folding — this hides controls, not hotels.
    expect(listed()).toHaveLength(8);

    fireEvent.click(fold());
    expect(panel().hasAttribute('hidden')).toBe(false);
  });

  it('keeps saying what is on while it is folded', () => {
    // A list quietly filtered by controls that are out of sight is a list that
    // looks wrong, and the reader has no way to find out why.
    render(<HotelsView nowMs={NOW} />);
    expect(fold().textContent).toMatch(/none on · by distance/);

    fireEvent.click(chip('Walking distance'));
    fireEvent.click(chip('Gen Con block'));
    fireEvent.click(screen.getByRole('button', { name: 'Price' }));
    fireEvent.click(fold());
    expect(fold().textContent).toMatch(/2 on · by price/);
  });

  it('opens showing everything, nearest first', () => {
    /*
     * There used to be three tabs and one of them was always chosen, so there
     * was no way to see the whole list. Distance is the number this app is sure
     * of, so with nothing chosen it decides the order.
     */
    render(<HotelsView nowMs={NOW} />);
    expect(listed()).toEqual([
      'JW Marriott Indianapolis',
      'The Westin Indianapolis',
      'Nestle Inn',
      'Holiday Inn Express',
      'Unasked Lodge',
      'Super 8 Airport',
      'Airport Motel',
      'Motel 6 Southport',
    ]);
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();
  });

  it('turns any filter off by pressing it again', () => {
    // The whole point of dropping the "All" chip: the way back is the way in,
    // and it has to be true of every group rather than the first one.
    render(<HotelsView nowMs={NOW} />);
    for (const name of [
      'Walking distance',
      'Gen Con block',
      'Driving distance',
      'Third party',
      'Skywalk to the ICC',
    ]) {
      fireEvent.click(chip(name));
      expect(chip(name).getAttribute('aria-pressed')).toBe('true');
      expect(listed().length).toBeLessThan(8);

      fireEvent.click(chip(name));
      expect(chip(name).getAttribute('aria-pressed')).toBe('false');
      expect(listed()).toHaveLength(8);
    }
  });

  it('filters to the hotels Gen Con says are on a skywalk', () => {
    /*
     * Only Gen Con records this, and only for its own block — so a hotel
     * outside the block is absent from this list rather than claimed to have
     * no skywalk, which would be this app inventing a fact.
     */
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(chip('Skywalk to the ICC'));
    expect(listed()).toEqual(['JW Marriott Indianapolis', 'The Westin Indianapolis']);
  });

  it('lets a distance filter and a source filter both apply', () => {
    /*
     * The old tabs made "Gen Con block" a distance, so a block hotel could not
     * also be a drive away — and plenty of Gen Con's block is out by the airport.
     */
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(chip('Walking distance'));
    fireEvent.click(chip('Gen Con block'));
    expect(listed()).toEqual(['JW Marriott Indianapolis', 'The Westin Indianapolis']);
  });

  it('keeps an unpriced hotel on the list until somebody asks about price', () => {
    // A blank is honest — "nobody has asked" — and only a budget makes it
    // irrelevant, because a hotel with no price cannot be shown to fit one.
    render(<HotelsView nowMs={NOW} />);
    expect(row('Unasked Lodge')).toBeTruthy();
    slide('Price', 200);
    expect(listed()).not.toContain('Unasked Lodge');
  });

  it('reads the distance slider in kilometres, and says "any" until it is moved', () => {
    render(<HotelsView nowMs={NOW} />);
    expect(page().querySelector('#hotels-within-out')!.textContent).toBe('any');
    slide('Distance', 1);
    expect(page().querySelector('#hotels-within-out')!.textContent).toBe('1 km');
    expect(listed()).toEqual(['JW Marriott Indianapolis', 'The Westin Indianapolis', 'Nestle Inn']);
  });

  it('takes a number typed straight in, exactly, past the slider’s own step', () => {
    /*
     * The range's step is half a kilometre, so handing it 1.2 gets 1 back. A
     * number somebody typed on purpose must survive being shown on a coarse
     * control — the thumb rounds, the answer does not.
     */
    render(<HotelsView nowMs={NOW} />);
    type('Distance', '1.3');
    expect(page().querySelector('#hotels-within-out')!.textContent).toBe('1.3 km');
    expect(listed()).toEqual(['JW Marriott Indianapolis', 'The Westin Indianapolis', 'Nestle Inn', 'Holiday Inn Express']);
  });

  it('reads an emptied field as "no limit" rather than as zero', () => {
    // Clearing the box is undoing the filter. Reading it as "under $0" would
    // empty the page in answer to a gesture that meant the opposite.
    render(<HotelsView nowMs={NOW} />);
    type('Price', '150');
    expect(listed().length).toBeLessThan(8);
    type('Price', '');
    expect(page().querySelector('#hotels-upto-out')!.textContent).toBe('any');
    expect(listed()).toHaveLength(8);
  });

  it('takes the clear-all button off the page until there is a mess to clear', () => {
    // One filter comes off by pressing it again, so a button for it would only
    // repeat a chip that is already on screen and already says what it does.
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(chip('Driving distance'));
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();

    slide('Distance', 10);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(listed()).toHaveLength(8);
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();
  });

  it('says which hotels are missing rather than showing an empty page', () => {
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(chip('Driving distance'));
    slide('Distance', 1);
    expect(page().querySelector('.hotels__empty')!.textContent).toBe(
      'No hotel is a drive away, within 1 km of the hall.',
    );
  });

  it('gives a drive time out there rather than a walk, and marks it as arithmetic', () => {
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(chip('Driving distance'));
    expect(within(row('Airport Motel')).getByText(/about \d+ min drive\*/)).toBeTruthy();
    expect(page().textContent).toMatch(/rather than a routed drive/i);
  });
});


describe('the Gen Con block, estimated', () => {
  // No longer behind a tab: the comparison sits under the list wherever block
  // hotels are in view, which is everywhere except "Third party".
  const openBlock = () => render(<HotelsView nowMs={NOW} />);
  // The only one left on the page: the list's prices each explain themselves,
  // so the comparison is the one thing that still needs reading first.
  const blockCaution = () => page().querySelector('.hotels__caution')!;

  it('says these are Gen Con’s own rates, and links to the page they are on', () => {
    // They are published prices, not estimates, and underselling them as
    // guesses would be as wrong as overselling a guess as a price.
    openBlock();
    expect(blockCaution().textContent).toMatch(
      /Gen Con’s real 2025 block rates|published 2025 block rates/,
    );
    expect(within(blockCaution() as HTMLElement).getByRole('link')).toBeTruthy();
  });

  it('goes away when the reader has asked for third-party prices only', () => {
    // It is a statement about the block; with the block filtered out it is an
    // answer to a question nobody asked.
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Third party' }));
    expect(page().querySelector('.hotels__pair')).toBeNull();
  });

  it('repeats Gen Con’s own caveat about tax and room type', () => {
    // A rate that excludes tax and varies by room is not the number somebody
    // will be charged, and the page has to say so where the number is.
    openBlock();
    expect(blockCaution().textContent).toMatch(/before local taxes/i);
  });

  it('shows both ends of a published range', () => {
    // Only the low end would make the block look cheaper than anybody pays.
    openBlock();
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    const pair = [...page().querySelectorAll('.hotels__pair')].find((one) =>
      one.textContent?.includes('JW Marriott'),
    )!;
    const shown = pair.querySelector('.hotels__money')!.textContent!;
    // 2027 planning year, so both ends are carried forward two years.
    expect(shown).toMatch(/^\$\d+–\$\d+$/);
    const [low, high] = shown.split('–').map((one) => Number(one.replace(/\D/g, '')));
    expect(low).toBeGreaterThanOrEqual(287);
    expect(high).toBeGreaterThanOrEqual(620);
  });

  it('says when a figure is carried forward, and from which year', () => {
    openBlock();
    const text = page().textContent ?? '';
    expect(text).toMatch(/carried forward/i);
    expect(text).toMatch(/real 2025 block rates/);
    expect(page().querySelector('.hotels__label')!.textContent).toMatch(/projected/i);
  });

  it('surfaces the block’s own cheapest room, wherever it is', () => {
    // It is a real published price that cost no API quota, and it is usually
    // nowhere near the hall.
    openBlock();
    expect(page().textContent).toMatch(/cheapest room anywhere is/i);
    expect(page().textContent).toMatch(/\$109/);
  });

  it('draws a projected figure differently from a published one', () => {
    // Same rule as the key dates page: a projection never sits in a column of
    // facts looking like one.
    openBlock();
    expect(page().querySelector('.hotels__money--guess')).toBeTruthy();
  });

  it('pairs each block hotel with a different alternative', () => {
    // The reason this is a matching and not a lookup.
    openBlock();
    const alternatives = [...page().querySelectorAll('.hotels__pair')].map(
      (pair) => pair.querySelectorAll('.hotels__side h3')[1]?.textContent,
    );
    expect(new Set(alternatives.filter(Boolean)).size).toBe(alternatives.filter(Boolean).length);
  });

  it('says how far apart a pair is', () => {
    openBlock();
    expect(page().textContent).toMatch(/\d+ m from it/);
  });

  it('says nothing about sharing when nothing is shared', () => {
    // The mock has two block hotels and two alternatives, so each gets its own,
    // and a label that is true of nothing is a label the eye learns to skip.
    openBlock();
    expect(page().textContent).not.toMatch(/stands in for others/);
    expect(page().textContent).not.toMatch(/lean on an alternative/);
  });

  it('calls the saving a direction rather than a sum', () => {
    // It subtracts an estimate from a quote. Printing that as a firm figure
    // would be the most confident wrong number on the page.
    openBlock();
    expect(page().textContent).toMatch(/treat it as a direction, not a sum/i);
  });

  it('says the block list is partial rather than implying it is whole', () => {
    openBlock();
    expect(page().textContent).toMatch(/left\s+out rather than guessed at/i);
  });
});


describe('the four facts on every row', () => {
  it('calls out a skywalk as its own thing, not as a short walk', () => {
    // Indoors and air-conditioned is the whole difference between two hotels
    // the same distance apart in an Indianapolis August.
    render(<HotelsView nowMs={NOW} />);
    expect(within(row('JW Marriott')).getByText('skywalk')).toBeTruthy();
    // And a hotel with no skywalk claims nothing either way.
    expect(within(row('Nestle Inn')).queryByText('skywalk')).toBeNull();
  });

  it('gives a walk time near the hall and a drive time far from it', () => {
    render(<HotelsView nowMs={NOW} />);
    expect(within(row('Nestle Inn')).getByText(/min walk/)).toBeTruthy();
    expect(within(row('Airport Motel')).getByText(/min drive/)).toBeTruthy();
  });

  it('puts the distance from the ICC on every row', () => {
    render(<HotelsView nowMs={NOW} />);
    expect(within(row('JW Marriott')).getByText(/124 m from the ICC/)).toBeTruthy();
    expect(within(row('Nestle Inn')).getByText(/900 m from the ICC/)).toBeTruthy();
  });
});

describe('splitting the bill', () => {
  it('divides the room between the people in it, and shows both numbers', () => {
    // "$74" beside a hotel is a very different claim from "$296 between four",
    // so the room total is never hidden.
    render(<HotelsView nowMs={NOW} />);
    const westin = row('The Westin');
    // Gen Con's 276 carried two years at 2.8%, then halved.
    const each = Number(within(westin).getByText(/^\$\d+$/).textContent!.replace(/\D/g, ''));
    expect(each).toBeGreaterThanOrEqual(138);
    expect(westin.textContent).toMatch(/\$\d+ the room/);
  });

  it('changes the answer when the party changes', () => {
    render(<HotelsView nowMs={NOW} />);
    const each = () =>
      Number(within(row('The Westin')).getByText(/^\$\d+$/).textContent!.replace(/\D/g, ''));
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    const alone = each();
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    expect(each()).toBe(Math.round(alone / 4));
  });

  it('says nothing about a room total when nobody is sharing', () => {
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(row('The Westin').textContent).not.toMatch(/the room/);
  });
});

describe('published beats bought', () => {
  it('shows Gen Con’s own rate where there is one, and says so', () => {
    // A bought price sitting where a published one exists would be worse data
    // presented with more confidence.
    render(<HotelsView nowMs={NOW} />);
    const jw = row('JW Marriott');
    expect(within(jw).getByText('in the block')).toBeTruthy();
    expect(within(jw).getByText(/Gen Con’s own/)).toBeTruthy();
  });

  it('falls back to a bought price only outside the block', () => {
    render(<HotelsView nowMs={NOW} />);
    const holiday = row('Holiday Inn Express');
    expect(within(holiday).queryByText('in the block')).toBeNull();
    expect(within(holiday).getByText('serpapi, xotelo')).toBeTruthy();
  });
});
