/**
 * The block estimate, and the pairing that gives it something to be compared to.
 *
 * Two things are being defended here.
 *
 * The estimate is arithmetic on a seven-year-old negotiated rate, so what
 * matters is not the multiplication — it is that a projected year can never be
 * mistaken for a measured one, and that the base year travels with the number
 * wherever it goes.
 *
 * The pairing is where the interesting bug lives. Nearest-neighbour looks right
 * and is not: four block hotels sit within two hundred metres of each other on
 * this campus, and greedy assignment hands all four the same alternative, which
 * tells you one thing four times. Every test below that mentions uniqueness is
 * really testing that.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('./partners', () => ({
  BASE_YEAR: 2019,
  SOURCE: 'https://example.invalid/thread',
  PARTNERS: [
    { placeId: 'jw', blockName: 'JW Marriott', y2014: 212, y2015: 218, y2019: 246 },
    { placeId: 'westin', blockName: 'The Westin', y2014: 195, y2015: 201, y2019: 221 },
    { placeId: 'hilton', blockName: 'Hilton', y2014: 162, y2015: 167, y2019: 200 },
  ],
  isPartner: (id: string) => ['jw', 'westin', 'hilton'].includes(id),
  partnerFor: (id: string) =>
    ({
      jw: { placeId: 'jw', blockName: 'JW Marriott', y2014: 212, y2015: 218, y2019: 246 },
      westin: { placeId: 'westin', blockName: 'The Westin', y2014: 195, y2015: 201, y2019: 221 },
      hilton: { placeId: 'hilton', blockName: 'Hilton', y2014: 162, y2015: 167, y2019: 200 },
    })[id] ?? null,
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

const { between, blockEstimate, pairings, preference, priceIndex, tier } = await import('./blocks');

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

describe('carrying a 2019 rate forward', () => {
  it('uses the measured index where one exists, and says it is measured', () => {
    // 13.0% above 2019 in June 2026, from the Travel Price Index.
    const index = priceIndex(2026);
    expect(index.factor).toBe(1.13);
    expect(index.measured).toBe(true);
    expect(blockEstimate('jw', 2026)!.nightly).toBe(278);
  });

  it('marks a projected year as not measured, however plausible it looks', () => {
    // The whole difference between a figure somebody can check and one they
    // cannot. 2027 is 2026's number continued, and must never claim otherwise.
    const next = priceIndex(2027);
    expect(next.measured).toBe(false);
    expect(next.factor).toBeGreaterThan(1.13);
    expect(blockEstimate('jw', 2027)!.measured).toBe(false);
  });

  it('carries its base year with it wherever it goes', () => {
    // A number with no base year is a number nobody can argue with.
    const estimate = blockEstimate('westin', 2026)!;
    expect(estimate.from).toEqual({ year: 2019, nightly: 221 });
    expect(estimate.factor).toBe(1.13);
  });

  it('has nothing to say about a hotel that was never in the block', () => {
    expect(blockEstimate('near', 2026)).toBeNull();
  });

  it('never invents cents on a seven-year projection', () => {
    for (const id of ['jw', 'westin', 'hilton']) {
      expect(Number.isInteger(blockEstimate(id, 2026)!.nightly)).toBe(true);
    }
  });
});

describe('pairing each block hotel with something to compare against', () => {
  /*
   * Three block hotels bunched together and three alternatives at increasing
   * distances. Nearest-neighbour would give all three the same answer.
   */
  const CLUSTER = [
    at('jw', 0),
    at('westin', 40),
    at('hilton', 80),
    at('near', 20, { name: 'Nearest Alternative' }),
    at('mid', 300, { name: 'Middle Alternative' }),
    at('far', 900, { name: 'Far Alternative' }),
  ];

  it('never uses one alternative twice', () => {
    // The reason this is a matching rather than a lookup.
    const paired = pairings(2026, CLUSTER);
    const used = paired.map((one) => one.alternative?.id).filter(Boolean);
    expect(used).toHaveLength(3);
    expect(new Set(used).size).toBe(3);
  });

  it('gives the contested alternative to whichever block hotel is nearer it', () => {
    // All three want 'near'; only the closest keeps it.
    const paired = pairings(2026, CLUSTER);
    const nearest = paired.find((one) => one.alternative?.id === 'near')!;
    const distances = CLUSTER.filter((one) => ['jw', 'westin', 'hilton'].includes(one.id)).map(
      (one) => ({ id: one.id, m: between(one, CLUSTER.find((two) => two.id === 'near')!) }),
    );
    distances.sort((a, b) => a.m - b.m);
    expect(nearest.partner.id).toBe(distances[0].id);
  });

  it('gives the rest their next choice rather than nothing', () => {
    const paired = pairings(2026, CLUSTER);
    for (const one of paired) expect(one.alternative).not.toBeNull();
  });

  it('leaves a block hotel unpaired rather than reusing one, when they run out', () => {
    // Three block hotels and one alternative: two must go without, and saying
    // so is better than showing the same comparison three times.
    const scarce = [at('jw', 0), at('westin', 40), at('hilton', 80), at('near', 20)];
    const paired = pairings(2026, scarce);
    expect(paired.filter((one) => one.alternative).length).toBe(1);
    expect(paired.filter((one) => !one.alternative).length).toBe(2);
  });

  it('reports how far apart the pair is, so the comparison can be judged', () => {
    const paired = pairings(2026, CLUSTER);
    for (const one of paired) {
      if (!one.alternative) continue;
      expect(one.apart).toBe(between(one.partner, one.alternative));
    }
  });

  it('works out the saving only where the alternative has a price', () => {
    const paired = pairings(2026, CLUSTER);
    const withRate = paired.find((one) => one.alternative?.id === 'near')!;
    expect(withRate.saving).toBe(withRate.estimate.nightly - 150);

    const noRate = pairings(2026, [at('jw', 0), at('blank', 30)]);
    expect(noRate[0].alternative?.id).toBe('blank');
    expect(noRate[0].saving).toBeNull();
  });

  it('is ordered by how near the block hotel is to the hall', () => {
    const paired = pairings(2026, CLUSTER);
    const order = paired.map((one) => one.partner.metres);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
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
