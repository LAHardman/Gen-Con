/**
 * The block estimate, and the comparison that gives it a meaning.
 *
 * Two things are being defended here.
 *
 * The estimate is arithmetic on a seven-year-old negotiated rate, so what
 * matters is not the multiplication — it is that a projected year can never be
 * mistaken for a measured one, and that the base year travels with the number
 * wherever it goes.
 *
 * The comparison is where the interesting judgement is. Two hotels are worth
 * putting side by side when one could stand in for the other, and the two ways
 * that can be true — round the corner, or at about the same money — are
 * different questions. What has to be defended is that neither one is stretched
 * to fill a column: a hotel a mile away at twice the price is not a comparison,
 * and printing nothing is the right answer.
 */

import { describe, expect, it, vi } from 'vitest';

const BLOCK = {
  jw: { placeId: 'jw', blockName: 'JW Marriott Indianapolis', low: 287, high: 620, region: 'downtown', skywalk: true, distance: 'Skywalk' },
  westin: { placeId: 'westin', blockName: 'The Westin Indianapolis', low: 276, high: 346, region: 'downtown', skywalk: true, distance: 'Skywalk' },
  hilton: { placeId: 'hilton', blockName: 'Hilton Indianapolis', low: 231, high: null, region: 'downtown', skywalk: false, distance: '3 Blocks' },
};

vi.mock('./partners', () => ({
  BLOCK_YEAR: 2025,
  BLOCK_GROWTH: 0.028,
  CAVEAT: 'Starting rates, before tax.',
  SOURCE: 'https://example.invalid/hotelmap',
  HISTORY_SOURCE: 'https://example.invalid/thread',
  PARTNERS: Object.values(BLOCK),
  CHEAPEST: BLOCK.hilton,
  SUSPECTED_IN_BLOCK: new Set(['lookalike']),
  isPartner: (id: string) => id in BLOCK,
  partnerFor: (id: string) => (BLOCK as Record<string, unknown>)[id] ?? null,
}));

const RATES: Record<string, { placeId: string; nightly: number; currency: string; sources: string[]; at: string; spread: number }> = {
  near: { placeId: 'near', nightly: 150, currency: 'USD', sources: ['serpapi'], at: '2026-08-01', spread: 0 },
  mid: { placeId: 'mid', nightly: 320, currency: 'USD', sources: ['serpapi'], at: '2026-08-01', spread: 0 },
  far: { placeId: 'far', nightly: 190, currency: 'USD', sources: ['serpapi'], at: '2026-08-01', spread: 0 },
};

vi.mock('./rates', () => ({
  RATES: [],
  REFRESHED: '2026-08-11',
  WALK_FLOOR: 150,
  rateFor: (id: string) => RATES[id] ?? null,
}));

vi.mock('./lodging', () => ({ LODGING: [], WALKABLE: [], WALK_METRES: 1600, DRIVE_METRES: 25000, PULLED: '2026-08-11', SAMPLED: true }));

const { beside, between, blockRate, preference, tier } = await import('./blocks');

/** Degrees are awkward; this puts places a known number of metres apart. */
const at = (id: string, metresEast: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: (extra.name as string) ?? id,
  kind: 'hotel',
  ring: 'walk' as const,
  metres: 100 + metresEast,
  lat: 39.7657,
  lng: -86.1668 + metresEast / (111_320 * Math.cos((39.7657 * Math.PI) / 180)),
  ...extra,
});

describe('the block rate for a year', () => {
  it('is a fact, not an estimate, for the year Gen Con published', () => {
    // The distinction the whole page is built around. 2025 is what Gen Con
    // printed; presenting it as a projection would undersell a real number.
    const rate = blockRate('jw', 2025)!;
    expect(rate.projected).toBe(false);
    expect(rate.low).toBe(287);
    expect(rate.high).toBe(620);
    expect(rate.yearsOn).toBe(0);
  });

  it('carries both ends of the range forward, not just the cheap one', () => {
    // Showing only the low end would make the block look cheaper than anybody
    // actually pays for it.
    const rate = blockRate('jw', 2026)!;
    expect(rate.low).toBe(Math.round(287 * 1.028));
    expect(rate.high).toBe(Math.round(620 * 1.028));
  });

  it('marks any year past the published one as projected, and says how far', () => {
    expect(blockRate('jw', 2026)!.projected).toBe(true);
    expect(blockRate('jw', 2026)!.yearsOn).toBe(1);
    expect(blockRate('jw', 2027)!.yearsOn).toBe(2);
    expect(blockRate('jw', 2027)!.low).toBeGreaterThan(blockRate('jw', 2026)!.low);
  });

  it('never projects backwards into a year it cannot know', () => {
    // Deflating a published rate to invent a past year would be fabricating
    // history that Gen Con's own page contradicts.
    const before = blockRate('jw', 2024)!;
    expect(before.low).toBe(287);
    expect(before.yearsOn).toBe(0);
  });

  it('keeps a single published rate single rather than inventing a range', () => {
    expect(blockRate('hilton', 2025)!.high).toBeNull();
    expect(blockRate('hilton', 2027)!.high).toBeNull();
  });

  it('carries its base year with it wherever it goes', () => {
    expect(blockRate('westin', 2027)!.from).toEqual({ year: 2025, low: 276 });
  });

  it('has nothing to say about a hotel that is not in the block', () => {
    expect(blockRate('near', 2026)).toBeNull();
  });

  it('never invents cents', () => {
    for (const id of ['jw', 'westin', 'hilton']) {
      expect(Number.isInteger(blockRate(id, 2027)!.low)).toBe(true);
    }
  });
});


describe('what tips a close-run choice', () => {
  it('prefers a hotel of the same sort when two are equally near', () => {
    const luxury = at('jw', 0, { name: 'JW Marriott' });
    const alike = at('a', 200, { name: 'Conrad Indianapolis' });
    const unalike = at('b', 200, { name: 'Motel 6' });
    expect(preference(luxury, alike, null, null)).toBeLessThan(
      preference(luxury, unalike, null, null),
    );
    expect(tier(alike)).toBeGreaterThan(tier(unalike));
  });

  it('prefers one that costs no more than the block, without excluding dearer ones', () => {
    const partner = at('jw', 0, { name: 'JW Marriott' });
    const cheap = at('near', 200, { name: 'Cheap Place' });
    const dear = at('mid', 200, { name: 'Dear Place' });
    expect(preference(partner, cheap, 278, RATES.near)).toBeLessThan(
      preference(partner, dear, 278, RATES.mid),
    );
    // Still a finite preference: "the nearest thing is dearer" is worth knowing.
    expect(Number.isFinite(preference(partner, dear, 278, RATES.mid))).toBe(true);
  });

  it('does not let quality or price drag a comparison across town', () => {
    // The corrections are worth tens of metres, not hundreds. A perfect match
    // eight hundred metres away must lose to a mediocre one next door.
    const partner = at('jw', 0, { name: 'JW Marriott' });
    const nextDoor = at('b', 50, { name: 'Motel 6' });
    const acrossTown = at('a', 900, { name: 'Conrad Indianapolis' });
    expect(preference(partner, nextDoor, 278, null)).toBeLessThan(
      preference(partner, acrossTown, 278, null),
    );
  });
});

describe('the one hotel worth putting beside a block hotel', () => {
  /** A candidate as the comparison sees it: a place and what it costs. */
  const candidate = (id: string, metresEast: number, nightly: number | null, name?: string) => ({
    place: at(id, metresEast, name ? { name } : {}),
    nightly,
  });

  const jw = at('jw', 0, { name: 'JW Marriott' });

  it('takes a hotel round the corner, whatever it costs', () => {
    // Distance is one of the two reasons to look at a second hotel, and it does
    // not need a price to be a real answer — most of this app's hotels have none.
    const found = beside(jw, 300, [candidate('near', 200, null)])!;
    expect(found.place.id).toBe('near');
    expect(found.because).toBe('near');
    expect(found.apart).toBeGreaterThan(150);
    expect(found.saving).toBeNull();
  });

  it('takes a hotel at about the same money, wherever it is', () => {
    // The other reason, and it does not care about distance: somebody comparing
    // on price is asking what else that money buys.
    const found = beside(jw, 300, [candidate('far', 1400, 290)])!;
    expect(found.place.id).toBe('far');
    expect(found.because).toBe('priced');
    expect(found.saving).toBe(10);
  });

  it('refuses when a hotel is neither near nor at the price', () => {
    // The finding, not a gap. A hotel a mile off at twice the money is not a
    // comparison, and reaching for it would be inventing one to fill a column.
    expect(beside(jw, 300, [candidate('far', 1400, 700)])).toBeNull();
  });

  it('refuses when there is nothing to compare against at all', () => {
    expect(beside(jw, 300, [])).toBeNull();
  });

  it('calls a hotel that is both near and priced "near"', () => {
    // The stronger claim: "round the corner" is more use than "about the same
    // money", so where both hold the row says the one worth acting on.
    expect(beside(jw, 300, [candidate('near', 200, 310)])!.because).toBe('near');
  });

  it('takes the nearer of two that both qualify', () => {
    const found = beside(jw, 300, [candidate('far', 500, 300), candidate('near', 100, 300)])!;
    expect(found.place.id).toBe('near');
  });

  it('prefers the same sort of place when two are equally near', () => {
    // A Motel 6 beside the Conrad is a true comparison and a useless one.
    const found = beside(jw, 300, [
      candidate('motel', 200, null, 'Motel 6'),
      candidate('grand', 200, null, 'Conrad Indianapolis'),
    ])!;
    expect(found.place.id).toBe('grand');
  });

  it('does not compare a hotel with itself', () => {
    expect(beside(jw, 300, [{ place: jw, nightly: 300 }])).toBeNull();
  });

  it('spreads itself across the list rather than naming one hotel every time', () => {
    // Downtown has four hotels outside the block and thirty-one in it, so this
    // can only ever be a preference — but a page that says "Atlas Hotel" on
    // thirty-one rows has told the reader one thing thirty-one times.
    const options = [candidate('a', 200, null), candidate('b', 260, null)];
    const first = beside(jw, 300, options)!;
    const second = beside(jw, 300, options, new Set([first.place.id]))!;
    expect(second.place.id).not.toBe(first.place.id);
  });

  it('still repeats one rather than answering with nothing', () => {
    // A preference, not a rule: with a single candidate, used or not, it is
    // still the best answer there is.
    const only = [candidate('a', 200, null)];
    expect(beside(jw, 300, only, new Set(['a']))!.place.id).toBe('a');
  });

  it('works out the saving per room, and only where both have a price', () => {
    expect(beside(jw, 300, [candidate('near', 200, 240)])!.saving).toBe(60);
    expect(beside(jw, null, [candidate('near', 200, 240)])!.saving).toBeNull();
    expect(beside(jw, 300, [candidate('near', 200, null)])!.saving).toBeNull();
  });

  it('says how far apart the two are, so the comparison can be judged', () => {
    const other = candidate('near', 400, null);
    expect(beside(jw, 300, [other])!.apart).toBe(between(jw, other.place));
  });
});
