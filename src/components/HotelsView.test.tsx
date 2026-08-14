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

/*
 * Every hotel due east of the hall, at exactly the distance it claims.
 *
 * They all sat at 0,0 before, which made every pair of them nought metres
 * apart — so the comparison, whose whole job is to weigh distance, was being
 * tested against a world with no distance in it. Placing them on a line is
 * enough: the gap between any two is the difference of their distances, which
 * is arithmetic a reader of these tests can do in their head.
 */
const eastOf = (metres: number) => ({
  lat: 39.7657,
  lng: -86.1668 + metres / (111_320 * Math.cos((39.7657 * Math.PI) / 180)),
});

vi.mock('../data/lodging', () => ({
  WALK_METRES: 1600,
  DRIVE_METRES: 25000,
  PULLED: '2026-08-11',
  SAMPLED: true,
  LODGING: [
    { id: 'w1', name: 'JW Marriott Indianapolis', kind: 'hotel', metres: 124, ring: 'walk', ...eastOf(124) },
    { id: 'far', name: 'Airport Motel', kind: 'motel', metres: 12000, ring: 'drive', ...eastOf(12000), city: 'Plainfield' },
    { id: 'w2', name: 'The Westin Indianapolis', kind: 'hotel', metres: 280, ring: 'walk', ...eastOf(280) },
    { id: 'w6', name: 'Corner Inn', kind: 'hotel', metres: 600, ring: 'walk', ...eastOf(600) },
    { id: 'w3', name: 'Nestle Inn', kind: 'guest_house', metres: 1300, ring: 'walk', ...eastOf(1300) },
    { id: 'w5', name: 'Unasked Lodge', kind: 'hotel', metres: 1400, ring: 'walk', ...eastOf(1400) },
    // Carries the city the hall is in, which is the one city worth never saying.
    { id: 'w4', name: 'Holiday Inn Express', kind: 'hotel', metres: 1200, ring: 'walk', ...eastOf(1200), city: 'Indianapolis' },
    { id: 'd1', name: 'Motel 6 Southport', kind: 'motel', metres: 14000, ring: 'drive', ...eastOf(14000), city: 'Southport' },
    { id: 'd2', name: 'Super 8 Airport', kind: 'motel', metres: 9000, ring: 'drive', ...eastOf(9000) },
  ],
  WALKABLE: [],
}));

/*
 * A place the price search found and no survey has.
 *
 * Empty here once, and a whole CI run failed on it: a listing carries a price
 * with no `Rate` record behind it, and `priceStory` asserted one. Locally
 * `listings.ts` was still the empty placeholder, so nothing exercised the row
 * that actually shipped — 333 of them.
 */
vi.mock('../data/listings', () => ({
  FOUND: '2026-08-14',
  LISTINGS: [
    {
      id: 'serp:indy-urban-nest',
      name: 'Indy Urban Nest',
      kind: 'rental',
      // Out in the drive ring on purpose: near the hall it would win the
      // comparison against every downtown block hotel and the tests below
      // would be measuring the fixture rather than the rule.
      metres: 9500,
      ring: 'drive',
      ...eastOf(9500),
      nightly: 341,
      link: 'https://example.invalid/urban-nest',
      city: 'Indianapolis',
    },
  ],
}));

vi.mock('../data/rates', () => {
  const RATES = [
    { placeId: 'd1', nightly: 71, currency: 'USD', sources: ['xotelo'], at: '2026-08-09', spread: 0 },
    { placeId: 'w1', nightly: 289, currency: 'USD', sources: ['serpapi', 'xotelo'], at: '2026-06-02', spread: 40 },
    { placeId: 'w2', nightly: 240, currency: 'USD', sources: ['serpapi'], at: '2026-08-10', spread: 0 },
    { placeId: 'w4', nightly: 165, currency: 'USD', sources: ['serpapi', 'xotelo'], at: '2026-08-10', spread: 40 },
    { placeId: 'w6', nightly: 400, currency: 'USD', sources: ['serpapi'], at: '2026-08-10', spread: 0 },
    { placeId: 'w3', nightly: 290, currency: 'USD', sources: ['serpapi'], at: '2026-06-02', spread: 0 },
    { placeId: 'far', nightly: 120, currency: 'USD', sources: ['xotelo'], at: '2026-08-08', spread: 0 },
  ];
  return {
    RATES,
    REFRESHED: '2026-08-11',
    // The stay the bought prices are for. The convention itself here, so the
    // fallback wording is exercised by its own test rather than by every one.
    STAY: {
      in: '2027-08-04',
      out: '2027-08-08',
      isConvention: true,
      conventionYear: 2027,
      conventionFrom: '2027-08-04',
    },
    WALK_FLOOR: 240,
    rateFor: (id: string) => RATES.find((one) => one.placeId === id) ?? null,
  };
});

const { HotelsView, bookingFor, stayNote } = await import('./HotelsView');

/** A stay with nothing gathered into it yet. */
const EMPTY_STAY = {
  in: '2027-08-04',
  out: '2027-08-08',
  isConvention: true,
  conventionYear: 2027,
  conventionFrom: '2027-08-04',
};

afterEach(cleanup);

const NOW = Date.parse('2026-08-11T12:00:00Z');
const page = () => screen.getByRole('region', { name: 'Hotels' });
const rows = () => screen.getAllByRole('listitem');
/*
 * Matched on the row's own heading, not on its whole text.
 *
 * A row now carries the name of the hotel it is compared against, so matching
 * on text would hand back the block hotel above whenever the comparison was
 * what was asked for.
 */
const row = (name: string) =>
  rows().find((one) => one.querySelector('h3')?.textContent?.includes(name))!;

describe('the rest of what is known about one hotel', () => {
  /*
   * These render wide, because `useWide` defaults to wide wherever `matchMedia`
   * is missing — which is jsdom. That is the honest default: showing everything
   * is a worse layout at the wrong size, hiding it behind a control that may
   * not work is a reader who cannot reach it at all.
   */
  it('has the detail in the row itself, for a screen with room for it', () => {
    // CSS decides whether it shows — jsdom does no layout, so what is checked
    // here is that it is in the document to be shown at all.
    render(<HotelsView nowMs={NOW} />);
    expect(row('JW Marriott').querySelector('.hotels__detail')).toBeTruthy();
  });

  it('says which nights the price covers, and whose they are', () => {
    render(<HotelsView nowMs={NOW} />);
    // A block hotel's rate is Gen Con's, so it is the convention by definition.
    expect(row('JW Marriott').querySelector('.hotels__detail')!.textContent).toMatch(
      /Gen Con’s block rate, for the convention itself/,
    );
    // A bought one is for whichever stay was gathered, named.
    expect(row('Holiday Inn Express').querySelector('.hotels__detail')!.textContent).toMatch(
      /2027-08-04 to 2027-08-08/,
    );
  });

  it('describes where it is in words, not only in metres', () => {
    render(<HotelsView nowMs={NOW} />);
    expect(row('JW Marriott').querySelector('.hotels__detail')!.textContent).toMatch(
      /124 m from the convention centre.*on the skywalk, so the walk is indoors/s,
    );
    // A rental says it is not a hotel, which is the distinction that matters.
    expect(row('Indy Urban Nest').querySelector('.hotels__detail')!.textContent).toMatch(
      /Let by the night rather than a hotel/,
    );
  });

  it('points a block hotel at Gen Con rather than at its own front desk', () => {
    // Being in the block *means* booking through Gen Con. A link to the hotel
    // would be a link to somewhere that cannot sell the rate on the row above.
    render(<HotelsView nowMs={NOW} />);
    const link = within(row('JW Marriott')).getByRole('link', { name: /Gen Con’s housing/ });
    expect(link.getAttribute('href')).toBe('https://example.invalid/hotelmap');
  });

  it('says there is no booking link rather than inventing one', () => {
    /*
     * Nothing captured a link before 2026-08, so for most rows the truthful
     * answer is that there is not one. A search URL dressed up as a booking
     * would look like an answer and be a guess.
     */
    render(<HotelsView nowMs={NOW} />);
    const detail = row('Holiday Inn Express').querySelector('.hotels__detail')!;
    expect(detail.textContent).toMatch(/No booking link gathered for this one/);
    expect(within(row('Holiday Inn Express')).queryByRole('link')).toBeNull();
  });

  it('uses the listing’s own link when the search gave one', () => {
    render(<HotelsView nowMs={NOW} />);
    const link = within(row('Indy Urban Nest')).getByRole('link', { name: /listed/ });
    expect(link.getAttribute('href')).toBe('https://example.invalid/urban-nest');
    // Somebody else's site, opened as somebody else's site.
    expect(link.getAttribute('rel')).toMatch(/noreferrer/);
  });
});

describe('deciding where a hotel can be booked', () => {
  const rate = (link?: string | null) =>
    ({ placeId: 'x', nightly: 100, currency: 'USD', sources: ['serpapi'], at: '2026-08-14', spread: 0, link }) as never;

  it('sends the block to Gen Con whatever else it knows', () => {
    // Even with a hotel's own link to hand: that page cannot sell the block.
    const at = bookingFor({ block: { low: 200 } as never, rate: rate('https://hotel.example'), listing: null });
    expect(at).toMatchObject({ href: 'https://example.invalid/hotelmap' });
  });

  it('prefers the listing’s link to the rate’s, since the listing is the thing', () => {
    const at = bookingFor({
      block: null,
      rate: rate('https://from-the-rate.example'),
      listing: { link: 'https://from-the-listing.example' },
    });
    expect(at?.href).toBe('https://from-the-listing.example');
  });

  it('has nothing to offer when nobody gave a link', () => {
    expect(bookingFor({ block: null, rate: rate(null), listing: null })).toBeNull();
    expect(bookingFor({ block: null, rate: null, listing: { link: null } })).toBeNull();
  });
});

describe('which nights the bought prices are for', () => {
  it('says so when they are the convention’s own', () => {
    render(<HotelsView nowMs={NOW} />);
    expect(page().textContent).toMatch(
      /Bought prices are for the convention itself, 2027-08-04 to 2027-08-08/,
    );
  });

  it('says plainly when they are a stand-in, and that the real thing costs more', () => {
    /*
     * The claim that could actually mislead somebody into budgeting short.
     *
     * Hotels open their calendars about a year out, so for most of the year the
     * next Gen Con cannot be priced at all — measured against the live service,
     * asking for 2027 returned twenty properties and two prices where a night
     * six weeks out returned two hundred and thirty. A quiet week's rate is
     * real, useful and *cheaper than* the convention, and printing it without
     * saying which week would make it a convention price, which it is not.
     */
    const said = stayNote({
      in: '2026-10-07',
      out: '2026-10-11',
      isConvention: false,
      conventionYear: 2027,
      conventionFrom: '2027-08-04',
    });
    expect(said).toMatch(/Gen Con 2027 is not on sale yet/);
    expect(said).toMatch(/2026-10-07 to 2026-10-11/);
    expect(said).toMatch(/Expect convention week to cost more/);
    // And never the word that would make it a convention rate.
    expect(said).not.toMatch(/for the convention itself/);
  });

  it('says nothing at all when no stay has been gathered', () => {
    // The starting state, and the state if every free tier withdraws. A blank
    // date printed as a date is worse than no sentence.
    expect(stayNote({ ...EMPTY_STAY, in: '', out: '' })).toBe('');
  });
});

describe('what it refuses to be mistaken for', () => {
  /*
   * Each price says what kind of number it is, on the number itself.
   *
   * This used to be a box above the list explaining all three kinds at once,
   * which is a thing a reader passes on the way to the prices and never looks
   * at again. The distinction is what decides how far to trust a row, so it
   * lives on the row.
   */
  const told = (name: string) => row(name).querySelector('.hotels__told') as HTMLElement;

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

    fireEvent.pointerDown(page().querySelector('.hotels__note')!);
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
      'Nestle Inn', // $290, a shade under the Westin's projected block rate
      'The Westin Indianapolis',
      'JW Marriott Indianapolis',
      'Indy Urban Nest', // $341 the flat, so $171 each — more than the block hotels
      'Corner Inn',
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
      'Corner Inn', // nothing in the name, so the middle — nearest of those
      'Nestle Inn',
      'Unasked Lodge',
      'Indy Urban Nest',
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
    expect(listed()).toHaveLength(10);

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
      'Corner Inn',
      'Holiday Inn Express',
      'Nestle Inn',
      'Unasked Lodge',
      'Super 8 Airport',
      // A flat let by the night, from the price search rather than the survey.
      'Indy Urban Nest',
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
      expect(listed().length).toBeLessThan(9);

      fireEvent.click(chip(name));
      expect(chip(name).getAttribute('aria-pressed')).toBe('false');
      expect(listed()).toHaveLength(10);
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
    expect(listed()).toEqual(['JW Marriott Indianapolis', 'The Westin Indianapolis', 'Corner Inn']);
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
    expect(listed()).toEqual([
      'JW Marriott Indianapolis',
      'The Westin Indianapolis',
      'Corner Inn',
      'Holiday Inn Express',
      'Nestle Inn',
    ]);
  });

  it('reads an emptied field as "no limit" rather than as zero', () => {
    // Clearing the box is undoing the filter. Reading it as "under $0" would
    // empty the page in answer to a gesture that meant the opposite.
    render(<HotelsView nowMs={NOW} />);
    type('Price', '150');
    expect(listed().length).toBeLessThan(9);
    type('Price', '');
    expect(page().querySelector('#hotels-upto-out')!.textContent).toBe('any');
    expect(listed()).toHaveLength(10);
  });

  it('takes the clear-all button off the page until there is a mess to clear', () => {
    // One filter comes off by pressing it again, so a button for it would only
    // repeat a chip that is already on screen and already says what it does.
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(chip('Driving distance'));
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();

    slide('Distance', 10);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(listed()).toHaveLength(10);
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


describe('the comparison, on the row it is about', () => {
  const beside = (name: string) => row(name).querySelector('.hotels__beside');

  it('puts a hotel outside the block on the row of one inside it', () => {
    /*
     * It used to be a section under the whole list, which put the answer a
     * screen and a half from the question: the row said "$152" and the thing
     * that gives $152 a meaning was somewhere else entirely.
     */
    render(<HotelsView nowMs={NOW} />);
    const said = beside('JW Marriott')!.textContent!;
    expect(said).toMatch(/Nearby, outside the block/);
    expect(said).toMatch(/Corner Inn/);
    expect(said).toMatch(/\d+ m away/);
  });

  it('puts none on a hotel outside the block', () => {
    // The comparison is a thing said about the block, so a hotel that is not
    // in it has nothing to be compared against.
    render(<HotelsView nowMs={NOW} />);
    expect(beside('Holiday Inn Express')).toBeNull();
  });

  it('leaves a block hotel alone when nothing is near it or at its price', () => {
    /*
     * The finding rather than a gap. With everything but the airport filtered
     * away, the nearest hotel outside the block is twelve kilometres off and
     * nothing is within a quarter of the block rate — so there is no
     * comparison, and reaching for one would be inventing it.
     */
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Walking distance' }));
    fireEvent.change(screen.getByLabelText('Distance'), { target: { value: '0.3' } });
    expect(row('JW Marriott')).toBeTruthy();
    expect(beside('JW Marriott')).toBeNull();
  });

  it('draws only on hotels the reader has not filtered away', () => {
    // A hotel they have excluded is not an answer to what they asked.
    render(<HotelsView nowMs={NOW} />);
    fireEvent.change(screen.getByLabelText('Distance'), { target: { value: '1' } });
    const said = beside('JW Marriott')?.textContent ?? '';
    expect(said).not.toMatch(/Unasked Lodge/); // 1.4 km out, filtered away
  });

  it('still finds one when the source filter has hidden every third party', () => {
    /*
     * The one filter it must ignore. With "Gen Con block" chosen there is
     * nothing outside the block in view, and a comparison drawn from what is in
     * view would then be no comparison at all.
     */
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gen Con block' }));
    expect(beside('JW Marriott')).toBeTruthy();
  });

  it('says which kind of comparison it is', () => {
    /*
     * "Round the corner" and "about the same money" are different answers to
     * different questions, and a row that does not say which is guesswork. The
     * JW has the Corner Inn 476 m away; the Westin has nothing within 800 m
     * outside the block once the Corner Inn is spoken for — the Nestle Inn is
     * a kilometre off — and takes it on money instead, $290 against its own
     * projected $292.
     */
    render(<HotelsView nowMs={NOW} />);
    expect(beside('JW Marriott')!.textContent).toMatch(/^Nearby, outside the block/);
    expect(beside('The Westin')!.textContent).toMatch(/^Similar money, outside the block/);
  });

  it('spreads itself down the page rather than naming one hotel every time', () => {
    // Two rows naming the same hotel are one finding printed twice.
    render(<HotelsView nowMs={NOW} />);
    const named = [...page().querySelectorAll('.hotels__beside-name')].map((one) => one.textContent);
    expect(named.length).toBeGreaterThan(1);
    expect(new Set(named).size).toBe(named.length);
  });

  it('says the saving where both have a price, and which way it runs', () => {
    /*
     * Both directions, because "cheaper" is the answer people expect and
     * "dearer" is the one worth printing: the Corner Inn is round the corner
     * from the JW and $97 a room more, and a comparison that only ever reads
     * as a saving is a comparison selling something.
     */
    render(<HotelsView nowMs={NOW} />);
    expect(beside('The Westin')!.textContent).toMatch(/\$1 a night each cheaper/);
    expect(beside('JW Marriott')!.textContent).toMatch(/\$48 a night each more/);
  });

  it('has no section of its own left under the list', () => {
    render(<HotelsView nowMs={NOW} />);
    expect(page().querySelector('.hotels__pair')).toBeNull();
    expect(page().textContent).not.toMatch(/Beside the nearest alternative/);
  });
});

/**
 * The pop-up, which is how one hotel gets read on a phone.
 *
 * The detail used to unfold inside the row, which pushed everything under it
 * down the page and left the reader scrolling to find what they had just
 * opened. A pop-up puts the whole hotel — the price and the rest — in one place
 * over the list, and closes back to where they were.
 */
describe('opening one hotel', () => {
  const dialog = () => screen.getByRole('dialog');
  const beside = (name: string) => row(name).querySelector('.hotels__beside') as HTMLElement;

  it('opens from anywhere on the pill, not only from the name', () => {
    // "Tap the hotel" is what somebody will try, and the name is a small
    // target on a phone. The distance line is part of the hotel too.
    render(<HotelsView nowMs={NOW} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(within(row('JW Marriott')).getByText(/124 m from the ICC/));
    expect(within(dialog()).getByRole('heading', { name: 'JW Marriott Indianapolis' })).toBeTruthy();
  });

  it('opens from the name by keyboard, which a pill cannot be', () => {
    // A row is not focusable, so a hotel that only opens on a pointer is a
    // hotel half the readers cannot open at all.
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(within(row('The Westin')).getByRole('button', { name: /The Westin/ }));
    expect(within(dialog()).getByRole('heading', { name: 'The Westin Indianapolis' })).toBeTruthy();
  });

  it('leaves the price bubble to say its own piece', () => {
    /*
     * The price carries its own explanation on a press, and swallowing that
     * into "open the hotel" would take away the one control on the row that
     * answers the question the number raises.
     */
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(row('JW Marriott').querySelector('.hotels__told') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says the price and the rest in one display, without a second press', () => {
    /*
     * The whole reason it is a pop-up rather than a fold: everything known
     * about the hotel at once, so there is nothing left to go looking for.
     */
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(row('Holiday Inn Express'));
    const said = dialog().textContent!;
    expect(said).toMatch(/Holiday Inn Express/);
    expect(said).toMatch(/per person, per night/); // the number, as on the row
    expect(said).toMatch(/Which nights/);
    expect(said).toMatch(/2027-08-04 to 2027-08-08/);
    expect(said).toMatch(/Getting to the hall/);
    expect(said).toMatch(/1.2 km from the convention centre/);
    // And no "It is in Indianapolis" under a hotel a mile from the hall.
    expect(said).not.toMatch(/It is in Indianapolis/);
    expect(said).toMatch(/How to book/);
    expect(said).toMatch(/Where the price came from/);
  });

  it('names the town for somewhere that is not in it', () => {
    // The city is the whole answer for a motel out by the airport, and noise
    // for a hotel across the road from the hall.
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Driving distance' }));
    fireEvent.click(row('Airport Motel'));
    expect(dialog().textContent).toMatch(/It is in Plainfield/);
  });

  it('is a dialog the screen reader is told about, focused on the way out', () => {
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(row('JW Marriott'));
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().getAttribute('aria-labelledby')).toBe('hotel-dialog-title');
    expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Close' }));
  });

  it('closes on Escape and on the close button', () => {
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(row('JW Marriott'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(row('JW Marriott'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the comparison hotel, not the row it is printed on', () => {
    /*
     * The name beside a block hotel used to be the end of the road — a name and
     * one number, with no way to find out anything else about it. Pressing it
     * is the obvious thing to try, and what it should give is that hotel.
     */
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(beside('JW Marriott'));
    expect(within(dialog()).getByRole('heading', { name: 'Corner Inn' })).toBeTruthy();
    expect(within(dialog()).queryByRole('heading', { name: /JW Marriott/ })).toBeNull();
  });

  it('opens a comparison the filters have hidden from the list', () => {
    /*
     * The comparison ignores the source filter on purpose — with "Gen Con
     * block" chosen the hotel it names is deliberately not in the list. It
     * still has to open, or the row is naming somewhere unreachable.
     */
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gen Con block' }));
    // Matched on the headings, because the JW's row *names* the Corner Inn —
    // that naming is the whole point, and it is not the same as listing it.
    expect(rows().map((one) => one.querySelector('h3')?.textContent)).not.toContain('Corner Inn');

    fireEvent.click(beside('JW Marriott'));
    expect(within(dialog()).getByRole('heading', { name: 'Corner Inn' })).toBeTruthy();
  });

  it('follows the comparison from inside the pop-up', () => {
    // Without this the reader has to close it, find the other row and open
    // that — which is the scrolling the pop-up was meant to end.
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(row('JW Marriott'));
    fireEvent.click(within(dialog()).getByRole('button', { name: /Corner Inn/ }));
    expect(within(dialog()).getByRole('heading', { name: 'Corner Inn' })).toBeTruthy();
  });

  it('shows nothing but the hotel it was opened for', () => {
    // One at a time, or the list under it is a stack of dialogs.
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(row('JW Marriott'));
    fireEvent.click(row('The Westin'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
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
    expect(within(row('Nestle Inn')).getByText(/1.3 km from the ICC/)).toBeTruthy();
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
    expect(within(jw).getByText('Block')).toBeTruthy();
    expect(within(jw).getByText(/Gen Con’s own/)).toBeTruthy();
  });

  it('falls back to a bought price only outside the block', () => {
    render(<HotelsView nowMs={NOW} />);
    const holiday = row('Holiday Inn Express');
    expect(within(holiday).queryByText('in the block')).toBeNull();
    expect(within(holiday).getByText('serpapi, xotelo')).toBeTruthy();
  });
});
