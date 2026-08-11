/**
 * The rules the hotel prices are gathered by.
 *
 * Almost none of this is about HTTP. The four services are stubbed throughout,
 * because what can actually go wrong here is not a malformed response — it is
 * spending a month's allowance on the wrong hotels, or on the same hotel twice,
 * or letting one dead service take the other three down with it. Those are
 * arithmetic and ordering, and they are testable exactly.
 *
 * The one thing these cannot check is whether the request shapes in
 * `sources.mjs` match what the live services actually want. Nothing in this
 * repository can: those hosts are unreachable from here. `--dry` is for that.
 */

import { describe, expect, it, vi } from 'vitest';

import { cheapFirst, isFresh, keeps, planRun, walkFloor } from './plan.mjs';
import { budget, ledgerFor, noteTried, quotaFor, remaining, spend } from './quota.mjs';
import { merge, runOnce, usable } from './run.mjs';
import { matchByName, words } from './sources.mjs';

const AUGUST = Date.parse('2026-08-11T12:00:00Z');
const JULY = Date.parse('2026-07-11T12:00:00Z');

const place = (id, ring, metres, extra = {}) => ({
  id,
  name: extra.name ?? id,
  kind: 'hotel',
  ring,
  metres,
  lat: 39.76,
  lng: -86.16,
  ...extra,
});

/** Three walkable and three not, near-to-far. */
const PLACES = [
  place('w1', 'walk', 120),
  place('w2', 'walk', 400),
  place('w3', 'walk', 900),
  place('d1', 'drive', 6_000, { name: 'Motel 6 Southport' }),
  place('d2', 'drive', 9_000, { name: 'Conrad Carmel', stars: '5' }),
  place('d3', 'drive', 14_000, { name: 'Super 8 Airport' }),
];

const quote = (placeId, nightly, at, source = 'serpapi') => ({
  placeId,
  nightly,
  currency: 'USD',
  at,
  source,
});

describe('the monthly allowance', () => {
  it('defaults to the lowest credible figure and can be corrected', () => {
    // The published free tiers disagree with each other. Guessing high spends
    // somebody's account; guessing low costs a few prices.
    expect(quotaFor('serpapi')).toBe(100);
    expect(quotaFor('serpapi', { RATES_QUOTA_SERPAPI: '250' })).toBe(250);
    expect(() => quotaFor('serpapi', { RATES_QUOTA_SERPAPI: 'lots' })).toThrow();
  });

  it('never lets a spend exceed what is left', () => {
    const ledger = ledgerFor(null, AUGUST);
    expect(spend(ledger, 'apify', 25)).toBe(true);
    expect(spend(ledger, 'apify', 1)).toBe(false);
    expect(remaining(ledger, 'apify')).toBe(0);
  });

  it('resets the allowance each month but never the memory', () => {
    // Forgetting which places were probed and found too dear would re-buy the
    // same disappointing answer twelve times a year.
    const july = ledgerFor(null, JULY);
    spend(july, 'serpapi', 40);
    noteTried(july, 'd2', JULY);

    const august = ledgerFor(july, AUGUST);
    expect(august.spent.serpapi ?? 0).toBe(0);
    expect(august.tried.d2).toBe('2026-07');
  });

  it('treats a switched-off source as having nothing left', () => {
    const ledger = ledgerFor(null, AUGUST);
    expect(remaining(ledger, 'serpapi', { RATES_OFF_SERPAPI: '1' })).toBe(0);
    expect(spend(ledger, 'serpapi', 1, { RATES_OFF_SERPAPI: '1' })).toBe(false);
  });
});

describe('who gets asked about', () => {
  const budgets = { serpapi: 100, xotelo: 0, amadeus: 0, apify: 0 };

  it('does the walk ring before the drive ring, nearest first', () => {
    // If the allowance runs out halfway down, the half that got asked should be
    // the half nearest the hall.
    const { tasks } = planRun({ places: PLACES, quotes: [], budgets, whenMs: AUGUST });
    expect(tasks.slice(0, 3).map((task) => task.place.id)).toEqual(['w1', 'w2', 'w3']);
    expect(tasks.every((task) => task.why === 'walk-due' || task.why === 'drive-candidate')).toBe(true);
  });

  it('leaves alone anything already asked about this month', () => {
    const quotes = [quote('w1', 200, '2026-08-02T00:00:00Z')];
    const { tasks } = planRun({ places: PLACES, quotes, budgets, whenMs: AUGUST });
    expect(tasks.map((task) => task.place.id)).not.toContain('w1');
    expect(isFresh(quotes, 'w1', AUGUST)).toBe(true);
    // Last month is not this month, however few days ago it was.
    expect(isFresh([quote('w1', 200, '2026-07-31T23:00:00Z')], 'w1', AUGUST)).toBe(false);
  });

  it('will not touch the drive ring until something walkable has a price', () => {
    // No floor is a reason to stop, not a reason to use infinity — otherwise the
    // whole allowance goes on places that may all be above a cap found next week.
    const { tasks, floor } = planRun({ places: PLACES, quotes: [], budgets, whenMs: AUGUST });
    expect(floor).toBeNull();
    expect(tasks.every((task) => task.place.ring === 'walk')).toBe(true);
  });

  it('probes the drive ring cheapest-looking first once there is a floor', () => {
    const quotes = PLACES.filter((one) => one.ring === 'walk').map((one) =>
      quote(one.id, 250, '2026-08-02T00:00:00Z'),
    );
    const { tasks, floor } = planRun({ places: PLACES, quotes, budgets, whenMs: AUGUST });
    expect(floor).toBe(250);
    const drive = tasks.filter((task) => task.place.ring === 'drive').map((task) => task.place.id);
    // Two budget chains before the Conrad, whatever the distances say.
    expect(drive.indexOf('d1')).toBeLessThan(drive.indexOf('d2'));
    expect(drive.indexOf('d3')).toBeLessThan(drive.indexOf('d2'));
    expect(cheapFirst(PLACES[3])).toBeLessThan(cheapFirst(PLACES[4]));
  });

  it('does not re-probe a place already found to be over the floor', () => {
    const quotes = [quote('w1', 250, '2026-08-02T00:00:00Z')];
    const { tasks } = planRun({
      places: PLACES,
      quotes,
      budgets,
      whenMs: AUGUST,
      tried: { d1: '2026-07' },
    });
    expect(tasks.map((task) => task.place.id)).not.toContain('d1');
  });

  it('spends spare quota re-asking the walk ring, stalest first', () => {
    // "Once a month unless there is extra": a second look at the hotel across
    // the road beats a first look at one you would need a car for.
    const quotes = [
      quote('w1', 200, '2026-08-09T00:00:00Z'),
      quote('w2', 210, '2026-08-01T00:00:00Z'),
      quote('w3', 220, '2026-08-05T00:00:00Z'),
    ];
    const { tasks } = planRun({
      places: PLACES.filter((one) => one.ring === 'walk'),
      quotes,
      budgets: { serpapi: 2 },
      whenMs: AUGUST,
    });
    expect(tasks.map((task) => task.place.id)).toEqual(['w2', 'w3']);
    expect(tasks.every((task) => task.why === 'walk-extra')).toBe(true);
  });

  it('plans nothing at all when every allowance is gone', () => {
    const { tasks } = planRun({
      places: PLACES,
      quotes: [],
      budgets: { serpapi: 0, xotelo: 0, amadeus: 0, apify: 0 },
      whenMs: AUGUST,
    });
    expect(tasks).toEqual([]);
  });
});

describe('the price cap', () => {
  it('takes the floor from the walk ring only, stale quotes included', () => {
    // Last month's cheapest walkable rate is a far better cap than none.
    const quotes = [quote('w1', 300, '2026-07-01T00:00:00Z'), quote('d1', 60, '2026-08-01T00:00:00Z')];
    expect(walkFloor(PLACES, quotes)).toBe(300);
  });

  it('keeps a drive-ring price at or under the floor and drops one over it', () => {
    const drive = PLACES[3];
    expect(keeps(drive, 199, 200)).toBe(true);
    expect(keeps(drive, 200, 200)).toBe(true);
    expect(keeps(drive, 201, 200)).toBe(false);
  });

  it('always keeps a walkable price, because it is what the cap is made of', () => {
    expect(keeps(PLACES[0], 900, 200)).toBe(true);
    expect(keeps(PLACES[0], 900, null)).toBe(true);
  });

  it('keeps nothing from the drive ring when there is no floor', () => {
    expect(keeps(PLACES[3], 10, null)).toBe(false);
  });
});

describe('when a service goes offline', () => {
  const env = { SERPAPI_KEY: 'k', AMADEUS_KEY: 'k', AMADEUS_SECRET: 's' };

  const areaSource = (name, impl) => ({
    name,
    covers: 'area',
    ready: () => true,
    cost: 1,
    quoteArea: impl,
  });
  const placeSource = (name, impl) => ({
    name,
    covers: 'place',
    ready: () => true,
    cost: 1,
    quote: impl,
  });

  it('carries on with the others and still returns a result', async () => {
    // A run that fails because one of four sources failed has turned a partial
    // outage into a total one.
    const dead = areaSource('serpapi', async () => {
      throw new Error('ECONNRESET');
    });
    const alive = placeSource('xotelo', async (one) => ({ nightly: 150, currency: 'USD' }));

    const result = await runOnce({
      places: PLACES,
      quotes: [],
      ledger: ledgerFor(null, AUGUST),
      env,
      whenMs: AUGUST,
      sources: [dead, alive],
    });

    expect(result.down.serpapi).toMatch(/ECONNRESET/);
    expect(result.kept).toBeGreaterThan(0);
    expect(result.quotes.some((one) => one.source === 'xotelo')).toBe(true);
  });

  it('does not spend the allowance of a source that broke', async () => {
    // A dead service must not be able to eat an allowance it never served.
    const dead = areaSource('serpapi', async () => {
      throw new Error('502');
    });
    const ledger = ledgerFor(null, AUGUST);
    await runOnce({
      places: PLACES,
      quotes: [],
      ledger,
      env,
      whenMs: AUGUST,
      sources: [dead],
    });
    expect(ledger.spent.serpapi ?? 0).toBe(0);
  });

  it('stops asking a source once it has broken, rather than timing out per hotel', async () => {
    // One timeout predicts the next two hundred, and a run that waits them all
    // out never finishes and never writes.
    const calls = vi.fn(async () => {
      throw new Error('down');
    });
    const dead = placeSource('xotelo', calls);
    await runOnce({
      places: PLACES,
      quotes: [],
      ledger: ledgerFor(null, AUGUST),
      env,
      whenMs: AUGUST,
      sources: [dead],
    });
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('writes the old prices back untouched when every service is down', async () => {
    // A month with no answers must leave the page as it was, with real dates on
    // it — not empty it.
    const held = [quote('w1', 189, '2026-06-01T00:00:00Z')];
    const dead = areaSource('serpapi', async () => {
      throw new Error('gone');
    });
    const result = await runOnce({
      places: PLACES,
      quotes: held,
      ledger: ledgerFor(null, AUGUST),
      env,
      whenMs: AUGUST,
      sources: [dead],
    });
    expect(result.quotes).toEqual(held);
  });

  it('asks the area sources before the per-place ones', async () => {
    // One area unit prices a whole ring; spending a per-place allowance on a
    // hotel the area search covers anyway is the most wasteful thing possible.
    const order = [];
    const area = areaSource('serpapi', async () => {
      order.push('area');
      return [];
    });
    const each = placeSource('xotelo', async () => {
      order.push('place');
      return null;
    });
    await runOnce({
      places: [PLACES[0]],
      quotes: [],
      ledger: ledgerFor(null, AUGUST),
      env,
      whenMs: AUGUST,
      sources: [each, area],
    });
    expect(order[0]).toBe('area');
    expect(usable([each, area], env, { serpapi: 1, xotelo: 1 })[0].name).toBe('serpapi');
  });

  it('remembers a drive-ring place it priced and rejected', async () => {
    const quotes = [quote('w1', 100, '2026-08-01T00:00:00Z')];
    const ledger = ledgerFor(null, AUGUST);
    const dear = placeSource('xotelo', async (one) =>
      one.ring === 'drive' ? { nightly: 400, currency: 'USD' } : null,
    );
    const result = await runOnce({
      places: PLACES,
      quotes,
      ledger,
      env,
      whenMs: AUGUST,
      sources: [dear],
    });
    expect(result.rejected).toBeGreaterThan(0);
    expect(Object.keys(ledger.tried).length).toBeGreaterThan(0);
    expect(result.quotes.some((one) => one.nightly === 400)).toBe(false);
  });
});

describe('holding on to what was learned', () => {
  it('keeps one quote per place per source, newest winning', () => {
    // Two services disagreeing about one hotel is information — the honest
    // width of "about $180" — and collapsing them would hide it.
    const merged = merge(
      [quote('w1', 200, '2026-07-01T00:00:00Z', 'serpapi'), quote('w1', 210, '2026-07-01T00:00:00Z', 'xotelo')],
      [quote('w1', 190, '2026-08-01T00:00:00Z', 'serpapi')],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((one) => one.source === 'serpapi').nightly).toBe(190);
    expect(merged.find((one) => one.source === 'xotelo').nightly).toBe(210);
  });

  it('never lets an older quote overwrite a newer one', () => {
    const merged = merge([quote('w1', 190, '2026-08-01T00:00:00Z')], [quote('w1', 900, '2026-01-01T00:00:00Z')]);
    expect(merged[0].nightly).toBe(190);
  });
});

describe('tying their name for a hotel to ours', () => {
  it('matches the same hotel written three ways', () => {
    const places = [place('a', 'walk', 100, { name: 'JW Marriott Indianapolis' })];
    expect(matchByName(places, 'JW Marriott Indianapolis Downtown')?.id).toBe('a');
    expect(matchByName(places, 'The JW Marriott, Indianapolis')?.id).toBe('a');
  });

  it('refuses to confuse two hotels of the same chain', () => {
    // A missed match costs a blank cell. A false one puts the IUPUI Hampton's
    // price on the Circle Centre Hampton and somebody books the wrong hotel.
    const places = [
      place('a', 'walk', 100, { name: 'Hampton Inn Indianapolis Downtown Across from Circle Centre' }),
      place('b', 'walk', 800, { name: 'Hampton Inn Indianapolis Downtown IUPUI' }),
    ];
    expect(matchByName(places, 'Hampton Inn Indianapolis Downtown IUPUI')?.id).toBe('b');
    // Ambiguous on its own, so it must answer nothing rather than pick one.
    expect(matchByName(places, 'Hampton Inn Indianapolis')).toBeNull();
    expect(matchByName(places, 'Motel 6')).toBeNull();
  });

  it('will not put a Courtyard’s price on the Marriott', () => {
    /*
     * A real false match, caught when the block rates were first generated.
     * "Courtyard by Marriott Downtown" reduces to {courtyard, marriott} and
     * "Marriott Indianapolis Downtown" to {marriott} — contained, one word
     * shared. The Marriott ended up with two different block rates, its own
     * and a Courtyard's, and nothing downstream could have told.
     */
    const places = [
      place('a', 'walk', 200, { name: 'Marriott Indianapolis Downtown' }),
      place('b', 'walk', 210, { name: 'Courtyard Indianapolis Downtown' }),
      place('c', 'walk', 740, { name: 'Courtyard Indianapolis at the Capitol' }),
    ];
    expect(matchByName(places, 'Courtyard by Marriott Downtown')).toBeNull();
    // And the Marriott still matches itself.
    expect(matchByName(places, 'Marriott Indianapolis Downtown')?.id).toBe('a');
  });

  it('throws away the words every hotel in this city shares', () => {
    expect([...words('The Westin Indianapolis Downtown Hotel')]).toEqual(['westin']);
  });
});

describe('the promise the whole thing rests on', () => {
  it('cannot exceed a monthly allowance however many times it runs', async () => {
    /*
     * The one failure that does not degrade politely. A missing price shows a
     * gap; an overspent free tier stops the account or starts charging, and
     * somebody finds out weeks later.
     *
     * Twenty runs in one month against a source that answers every time, with
     * an allowance of five.
     */
    const env = { RATES_QUOTA_XOTELO: '5' };
    const asked = vi.fn(async () => ({ nightly: 100, currency: 'USD' }));
    const source = { name: 'xotelo', covers: 'place', ready: () => true, cost: 1, quote: asked };

    let ledger = ledgerFor(null, AUGUST);
    let quotes = [];
    for (let run = 0; run < 20; run += 1) {
      // A fresh ledger object each time, as a new process would load it.
      ledger = ledgerFor(JSON.parse(JSON.stringify(ledger)), AUGUST);
      const result = await runOnce({
        places: PLACES,
        quotes,
        ledger,
        env,
        whenMs: AUGUST,
        sources: [source],
      });
      quotes = result.quotes;
    }

    expect(asked.mock.calls.length).toBeLessThanOrEqual(5);
    expect(ledger.spent.xotelo).toBeLessThanOrEqual(5);
  });

  it('starts again the following month, and not before', async () => {
    const env = { RATES_QUOTA_XOTELO: '2' };
    const asked = vi.fn(async () => ({ nightly: 100, currency: 'USD' }));
    const source = { name: 'xotelo', covers: 'place', ready: () => true, cost: 1, quote: asked };

    const july = ledgerFor(null, JULY);
    await runOnce({ places: PLACES, quotes: [], ledger: july, env, whenMs: JULY, sources: [source] });
    expect(asked).toHaveBeenCalledTimes(2);

    const august = ledgerFor(july, AUGUST);
    await runOnce({ places: PLACES, quotes: [], ledger: august, env, whenMs: AUGUST, sources: [source] });
    expect(asked).toHaveBeenCalledTimes(4);
  });
});
