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

vi.mock('../data/partners', () => ({
  BASE_YEAR: 2019,
  SOURCE: 'https://example.invalid/thread',
  PARTNERS: [
    { placeId: 'w1', blockName: 'JW Marriott', y2014: 212, y2015: 218, y2019: 246 },
    { placeId: 'w2', blockName: 'The Westin', y2014: 195, y2015: 201, y2019: 221 },
  ],
  isPartner: (id: string) => ['w1', 'w2'].includes(id),
  partnerFor: (id: string) =>
    ({
      w1: { placeId: 'w1', blockName: 'JW Marriott', y2014: 212, y2015: 218, y2019: 246 },
      w2: { placeId: 'w2', blockName: 'The Westin', y2014: 195, y2015: 201, y2019: 221 },
    })[id] ?? null,
}));

vi.mock('../data/lodging', () => ({
  WALK_METRES: 1600,
  DRIVE_METRES: 25000,
  PULLED: '2026-08-11',
  SAMPLED: true,
  LODGING: [
    { id: 'w1', name: 'JW Marriott Indianapolis', kind: 'hotel', metres: 124, ring: 'walk', lat: 0, lng: 0 },
    { id: 'w2', name: 'The Westin Indianapolis', kind: 'hotel', metres: 280, ring: 'walk', lat: 0, lng: 0 },
    { id: 'w3', name: 'Nestle Inn', kind: 'guest_house', metres: 900, ring: 'walk', lat: 0, lng: 0 },
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
    { placeId: 'w4', nightly: 165, currency: 'USD', sources: ['xotelo'], at: '2026-08-08', spread: 0 },
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
  it('says these are not block rates, above the list rather than under it', () => {
    // The one error on this page that costs money: the block is cheaper, and a
    // table that omits it while looking authoritative is worse than no table.
    render(<HotelsView nowMs={NOW} />);
    const caution = page().querySelector('.hotels__caution')!;
    expect(caution.textContent).toMatch(/not Gen Con block rates/i);
    expect(caution.textContent).toMatch(/cannot be read by any app/i);
    const list = page().querySelector('.hotels__list')!;
    expect(caution.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says the hotel list is a sample rather than every hotel there is', () => {
    render(<HotelsView nowMs={NOW} />);
    expect(page().textContent).toMatch(/sample rather than a complete list/i);
  });
});

describe('how old a price is', () => {
  it('puts an age on every one', () => {
    render(<HotelsView nowMs={NOW} />);
    expect(within(row('Westin')).getByText(/yesterday/)).toBeTruthy();
    // Ten weeks old, and it has to look it rather than sitting beside a fresh
    // one in the same typeface with no date.
    expect(within(row('JW Marriott')).getByText(/months? ago|weeks ago/)).toBeTruthy();
  });

  it('shows a gap as a gap, not as a zero', () => {
    render(<HotelsView nowMs={NOW} />);
    const nestle = row('Nestle Inn');
    expect(within(nestle).getByText('no price')).toBeTruthy();
    expect(nestle.textContent).not.toMatch(/\$0|£0|0 per night/);
  });
});

describe('when two services disagree', () => {
  it('says by how much rather than hiding it', () => {
    // The honest width of "about $289". Averaging it away would make one number
    // look surer than the two that produced it.
    render(<HotelsView nowMs={NOW} />);
    expect(within(row('JW Marriott')).getByText(/they differ by 40/)).toBeTruthy();
    expect(within(row('JW Marriott')).getByText(/serpapi, xotelo/)).toBeTruthy();
  });

  it('names the single source when only one answered', () => {
    render(<HotelsView nowMs={NOW} />);
    const westin = row('The Westin');
    expect(within(westin).getByText('serpapi')).toBeTruthy();
    expect(westin.textContent).not.toMatch(/they differ/);
  });
});

describe('the two rings', () => {
  it('opens on the walk ring, nearest first', () => {
    // Distance is the number this app is sure of, so it decides the order.
    render(<HotelsView nowMs={NOW} />);
    expect(rows().map((one) => one.querySelector('h3')!.textContent)).toEqual([
      'JW Marriott Indianapolis',
      'The Westin Indianapolis',
      'Nestle Inn',
      'Holiday Inn Express',
    ]);
    expect(within(row('JW Marriott')).getByText(/min walk/)).toBeTruthy();
  });

  it('lists only priced places out there, cheapest first, in minutes not kilometres', () => {
    // A drive-ring hotel with no price is not an option — it is one nobody has
    // asked about. The only reason to sleep out there is to spend less, so the
    // price is what makes it a candidate, and Super 8 has none.
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Within a drive' }));
    expect(rows().map((one) => one.querySelector('h3')!.textContent)).toEqual([
      'Motel 6 Southport',
    ]);
    expect(within(row('Motel 6')).getByText(/about \d+ min drive/)).toBeTruthy();
  });

  it('says how many out there are still waiting to be priced', () => {
    // Otherwise a one-row list reads as "there is one hotel within a drive".
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Within a drive' }));
    expect(page().textContent).toMatch(/1 more are within range and have not been priced/);
  });

  it('keeps an unpriced walkable hotel on the list', () => {
    // The opposite rule, and it has to be the opposite: you would consider
    // walking to any of them at any price, so the blank is honest there.
    render(<HotelsView nowMs={NOW} />);
    expect(row('Nestle Inn')).toBeTruthy();
  });

  it('says a drive time is arithmetic rather than a route', () => {
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Within a drive' }));
    expect(page().textContent).toMatch(/not a routed time/i);
  });

  it('explains why the drive ring is short', () => {
    // It is capped at the cheapest walkable rate, and a list that looks
    // suspiciously thin without saying why reads as broken.
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Within a drive' }));
    expect(page().textContent).toMatch(/at or below the cheapest walkable rate/i);
  });
});


describe('the Gen Con block, estimated', () => {
  const openBlock = () => {
    render(<HotelsView nowMs={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gen Con block' }));
  };

  it('says every figure in it is an estimate, and where the base came from', () => {
    // The left column is a 2019 negotiated rate times an index. Presenting that
    // without its provenance is presenting a guess as a price.
    openBlock();
    const caution = page().querySelectorAll('.hotels__caution')[0];
    expect(caution.textContent).toMatch(/every figure in the left column is an estimate/i);
    expect(caution.textContent).toMatch(/2019 block rates/);
    expect(within(caution as HTMLElement).getByRole('link')).toBeTruthy();
  });

  it('draws the estimate differently from a quoted price', () => {
    // Same rule as the key dates page: an estimate never sits in a column of
    // facts looking like one.
    openBlock();
    expect(page().querySelector('.hotels__money--guess')).toBeTruthy();
  });

  it('shows what it was carried forward from, on every row', () => {
    openBlock();
    expect(within(row('JW Marriott')).getByText(/from \$246 in 2019/)).toBeTruthy();
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
    expect(page().textContent).toMatch(/\d+ m away/);
  });

  it('calls the saving a direction rather than a sum', () => {
    // It subtracts an estimate from a quote. Printing that as a firm figure
    // would be the most confident wrong number on the page.
    openBlock();
    expect(page().textContent).toMatch(/treat it as a direction, not a sum/i);
  });

  it('says the block list is partial rather than implying it is whole', () => {
    openBlock();
    expect(page().textContent).toMatch(/the rest are left out rather than guessed at/i);
  });
});
