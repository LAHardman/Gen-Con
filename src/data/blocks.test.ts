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

const { between, blockRate, pairings, preference, tier } = await import('./blocks');

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

  it('repeats an alternative rather than leaving a block hotel with nothing', () => {
    /*
     * Three block hotels and one alternative. This used to answer two of them
     * with "no comparison", which reads as a fault in the page rather than as a
     * fact about downtown — and downtown is where it happens: thirty-one of the
     * thirty-five hotels within a walk of the hall are in the block.
     */
    const scarce = [at('jw', 0), at('westin', 40), at('hilton', 80), at('near', 20)];
    const paired = pairings(2026, scarce);
    expect(paired.filter((one) => one.alternative).length).toBe(3);
    expect(paired.map((one) => one.alternative?.id)).toEqual(['near', 'near', 'near']);
  });

  it('marks a comparison that another block hotel leans on too', () => {
    // The honesty that repeating buys: a reader can see the same hotel twice
    // and know it, rather than reading two rows as two findings.
    const scarce = [at('jw', 0), at('westin', 40), at('hilton', 80), at('near', 20)];
    for (const one of pairings(2026, scarce)) expect(one.shared).toBe(true);

    // Where there are enough to go round, nothing is shared.
    for (const one of pairings(2026, CLUSTER)) expect(one.shared).toBe(false);
  });

  it('spreads the block evenly over the alternatives rather than piling on the first', () => {
    /*
     * Three block hotels, two alternatives, and 'near' is everybody's first
     * choice — it is closer and it is cheaper than the block. An even share is
     * two, so the third hotel takes 'mid'; without a share, 'near' answers all
     * three and 'mid' answers none.
     */
    const twoWays = [at('jw', 0), at('westin', 40), at('hilton', 80), at('near', 20), at('mid', 300)];
    const counts = new Map<string, number>();
    for (const one of pairings(2026, twoWays)) {
      counts.set(one.alternative!.id, (counts.get(one.alternative!.id) ?? 0) + 1);
    }
    expect(counts.get('near')).toBe(2);
    expect(counts.get('mid')).toBe(1);
  });

  it('gives a shared alternative to the block hotels nearest it', () => {
    // A share is not a queue: the two that keep 'near' are the two closest to
    // it, and the one that gives way is the one furthest off.
    const twoWays = [at('jw', 0), at('westin', 40), at('hilton', 80), at('near', 20), at('mid', 300)];
    const paired = pairings(2026, twoWays);
    expect(paired.find((one) => one.partner.id === 'hilton')!.alternative!.id).toBe('mid');
    expect(paired.find((one) => one.partner.id === 'jw')!.alternative!.id).toBe('near');
    expect(paired.find((one) => one.partner.id === 'westin')!.alternative!.id).toBe('near');
  });

  it('reaches past the walk ring for an alternative, since downtown has so few', () => {
    /*
     * Every walkable hotel is in the block, so the only candidate is 1.9 km
     * out. Stopping at the ring would answer the whole table with nothing.
     */
    const boxedIn = [
      at('jw', 0),
      at('westin', 40),
      { ...at('outside', 1900), ring: 'drive' as const },
    ];
    const paired = pairings(2026, boxedIn);
    expect(paired.map((one) => one.alternative?.id)).toEqual(['outside', 'outside']);
  });

  it('will not reach so far that the comparison stops being downtown', () => {
    const tooFar = [at('jw', 0), { ...at('airport', 12_000), ring: 'drive' as const }];
    expect(pairings(2026, tooFar)[0].alternative).toBeNull();
  });

  it('never offers a hotel that only looks like it is outside the block', () => {
    /*
     * The bug this caught in the wild. Gen Con writes "SpringHill Suites by
     * Marriott Indianapolis Downtown" and OpenStreetMap writes "SpringHill
     * Suites Indianapolis Downtown", so the strict matcher tied them to nothing
     * — and an untied block hotel fell straight into the alternatives list. The
     * page then compared two block hotels with each other.
     */
    const withLookalike = [...CLUSTER, at('lookalike', 10, { name: 'Also In The Block' })];
    const paired = pairings(2026, withLookalike);
    expect(paired.map((one) => one.alternative?.id)).not.toContain('lookalike');
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
    expect(withRate.saving).toBe(withRate.rate.low - 150);

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
