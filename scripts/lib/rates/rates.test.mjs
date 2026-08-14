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
import { matchByName, matchByPoint, serpapi, words } from './sources.mjs';

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
  const budgets = { serpapi: 100, xotelo: 0, apify: 0 };
  const BLOCK = new Set(['w2']);

  it('never spends a request on a hotel Gen Con publishes', () => {
    // The most wasteful thing this could do: paying an allowance for a number
    // already sitting in partners.ts. The block covers most of the walk ring.
    const { tasks } = planRun({ places: PLACES, quotes: [], budgets, whenMs: AUGUST, inBlock: BLOCK });
    expect(tasks.map((task) => task.place.id)).not.toContain('w2');
    expect(tasks.length).toBe(PLACES.length - 1);
  });

  it('does the walk ring before the drive ring, nearest first', () => {
    const { tasks } = planRun({ places: PLACES, quotes: [], budgets, whenMs: AUGUST });
    expect(tasks.slice(0, 3).map((task) => task.place.id)).toEqual(['w1', 'w2', 'w3']);
  });

  it('leaves alone anything already asked about this month', () => {
    const quotes = [quote('w1', 200, '2026-08-02T00:00:00Z')];
    const { tasks } = planRun({ places: PLACES, quotes, budgets, whenMs: AUGUST });
    expect(tasks.filter((task) => task.why !== 'refresh').map((task) => task.place.id)).not.toContain('w1');
    expect(isFresh(quotes, 'w1', AUGUST)).toBe(true);
    // Last month is not this month, however few days ago it was.
    expect(isFresh([quote('w1', 200, '2026-07-31T23:00:00Z')], 'w1', AUGUST)).toBe(false);
  });

  it('asks about every hotel outside the block, not only the cheap ones', () => {
    /*
     * The rule that changed. Capping the drive ring at the cheapest walkable
     * rate saved quota and lost information: you cannot tell whether a hotel is
     * worth the drive without knowing what it costs, and "too expensive" is a
     * fact worth showing rather than one worth forgetting.
     */
    const { tasks } = planRun({ places: PLACES, quotes: [], budgets, whenMs: AUGUST });
    const asked = new Set(tasks.map((task) => task.place.id));
    for (const place of PLACES) expect(asked.has(place.id), place.id).toBe(true);
  });

  it('asks about the drive ring even with no walkable price yet', () => {
    // It used to refuse without a floor. There is no floor any more.
    const { tasks, floor } = planRun({ places: PLACES, quotes: [], budgets, whenMs: AUGUST });
    expect(floor).toBeNull();
    expect(tasks.some((task) => task.place.ring === 'drive')).toBe(true);
  });

  it('probes the drive ring cheapest-looking first', () => {
    const { tasks } = planRun({ places: PLACES, quotes: [], budgets, whenMs: AUGUST });
    const drive = tasks.filter((task) => task.place.ring === 'drive').map((task) => task.place.id);
    // Two budget chains before the Conrad, whatever the distances say.
    expect(drive.indexOf('d1')).toBeLessThan(drive.indexOf('d2'));
    expect(drive.indexOf('d3')).toBeLessThan(drive.indexOf('d2'));
    expect(cheapFirst(PLACES[3])).toBeLessThan(cheapFirst(PLACES[4]));
  });

  it('spends what is left over rather than letting it expire', () => {
    /*
     * An allowance resets on the first and anything unspent is gone. Once
     * nothing is due, the rest goes on refreshing the stalest — nearest first,
     * because that is where a stale price misleads most.
     */
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
    expect(tasks.every((task) => task.why === 'refresh')).toBe(true);
  });

  it('never refreshes a block hotel with the spare either', () => {
    const quotes = PLACES.map((one) => quote(one.id, 200, '2026-08-01T00:00:00Z'));
    const { tasks } = planRun({
      places: PLACES,
      quotes,
      budgets: { serpapi: 50 },
      whenMs: AUGUST,
      inBlock: BLOCK,
    });
    expect(tasks.map((task) => task.place.id)).not.toContain('w2');
  });

  it('plans nothing at all when every allowance is gone', () => {
    const { tasks } = planRun({
      places: PLACES,
      quotes: [],
      budgets: { serpapi: 0, xotelo: 0, apify: 0 },
      whenMs: AUGUST,
    });
    expect(tasks).toEqual([]);
  });
});

describe('what is worth keeping', () => {
  it('keeps any real number now that the drive ring is uncapped', () => {
    expect(keeps(PLACES[3], 999)).toBe(true);
    expect(keeps(PLACES[0], 10)).toBe(true);
  });

  it('still refuses a number that is not one', () => {
    // A source that half-answered is worse than one that did not answer.
    expect(keeps(PLACES[0], 0)).toBe(false);
    expect(keeps(PLACES[0], NaN)).toBe(false);
    expect(keeps(PLACES[0], -5)).toBe(false);
  });

  it('still reports the cheapest walkable rate, which the page uses', () => {
    const quotes = [quote('w1', 300, '2026-07-01T00:00:00Z'), quote('d1', 60, '2026-08-01T00:00:00Z')];
    expect(walkFloor(PLACES, quotes)).toBe(300);
  });
});

describe('when a service goes offline', () => {
  const env = { SERPAPI_KEY: 'k', APIFY_TOKEN: 't', APIFY_ACTOR: 'a' };

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

  it('never stores a bought price for a hotel Gen Con publishes', async () => {
    /*
     * An area source returns a page of hotels whatever it was asked, so a block
     * hotel can come back through the side door — and a bought price sitting
     * beside a published one is worse than no price at all.
     */
    const inBlock = new Set(['w2']);
    const everything = areaSource('serpapi', async (asked) => {
      // It was not even offered the block hotel.
      expect(asked.map((one) => one.id)).not.toContain('w2');
      return [
        { placeId: 'w1', nightly: 100, currency: 'USD' },
        { placeId: 'w2', nightly: 999, currency: 'USD' },
      ];
    });
    const result = await runOnce({
      places: PLACES,
      quotes: [],
      ledger: ledgerFor(null, AUGUST),
      env,
      whenMs: AUGUST,
      sources: [everything],
      inBlock,
    });
    expect(result.quotes.map((one) => one.placeId)).not.toContain('w2');
    expect(result.quotes.map((one) => one.placeId)).toContain('w1');
  });
});

describe('a source with nothing to ask with', () => {
  const env = {};
  const keyed = (name, impl) => ({
    name,
    covers: 'place',
    ready: () => true,
    cost: 1,
    canAsk: (place, ctx) => Boolean(ctx?.keys?.[place.id]),
    quote: impl,
  });

  it('is not charged for the hotels it cannot name', async () => {
    /*
     * The bug this closes emptied a whole allowance on silence. The ledger is
     * charged before the request goes out, and Xotelo returns null on its first
     * line for any hotel it has no TripAdvisor key for — so every run spent one
     * unit per hotel, sent nothing, and reported the budget as used.
     */
    const asked = [];
    const source = keyed('xotelo', async (place) => {
      asked.push(place.id);
      return { nightly: 150, currency: 'USD' };
    });
    const ledger = ledgerFor(null, AUGUST);

    await runOnce({
      places: PLACES,
      quotes: [],
      ledger,
      env,
      whenMs: AUGUST,
      sources: [source],
      keys: { w1: 'g37209-d1' },
    });

    expect(asked).toEqual(['w1']);
    expect(ledger.spent.xotelo).toBe(1);
  });

  it('still asks about every hotel it can name', async () => {
    // The guard must not become a reason to skip work that was possible.
    const asked = [];
    const source = keyed('xotelo', async (place) => {
      asked.push(place.id);
      return { nightly: 150, currency: 'USD' };
    });
    const keys = Object.fromEntries(PLACES.map((one) => [one.id, `g37209-d${one.id}`]));

    await runOnce({
      places: PLACES,
      quotes: [],
      ledger: ledgerFor(null, AUGUST),
      env,
      whenMs: AUGUST,
      sources: [source],
      keys,
    });

    expect(asked.sort()).toEqual(PLACES.map((one) => one.id).sort());
  });

  it('leaves a source that never declared canAsk alone', async () => {
    // `canAsk` is optional, and a source without one has always been askable.
    const asked = [];
    const source = {
      name: 'xotelo',
      covers: 'place',
      ready: () => true,
      cost: 1,
      quote: async (place) => {
        asked.push(place.id);
        return { nightly: 150, currency: 'USD' };
      },
    };

    await runOnce({
      places: PLACES,
      quotes: [],
      ledger: ledgerFor(null, AUGUST),
      env,
      whenMs: AUGUST,
      sources: [source],
    });

    expect(asked.length).toBe(PLACES.length);
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
    /*
     * It used to refuse this outright, because `marriott` counted as a
     * distinguishing word and the name was therefore ambiguous between the
     * Courtyard and the Marriott. Treating chain names as noise removed the
     * ambiguity rather than papering over it: what is left of "Courtyard by
     * Marriott Downtown" is `courtyard`, which is exactly one of these.
     */
    expect(matchByName(places, 'Courtyard by Marriott Downtown')?.id).toBe('b');
    // The thing that must never happen, and still does not.
    expect(matchByName(places, 'Courtyard by Marriott Downtown')?.id).not.toBe('a');
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

describe('one search per town, rather than one search', () => {
  it('groups the hotels by town, biggest group first', () => {
    /*
     * The first version asked "hotels near Indiana Convention Center" and
     * nothing else. That was fine while the interesting hotels were downtown,
     * and useless the moment Gen Con's own page took over downtown pricing —
     * because what is left to buy is a hundred and seventy hotels in Plainfield
     * and Carmel that a downtown search will never return.
     */
    const groups = serpapi.areas([
      place('a', 'walk', 1390, { city: 'Indianapolis' }),
      place('b', 'walk', 1458, { city: 'Indianapolis' }),
      place('c', 'drive', 20000, { city: 'Plainfield' }),
    ]);
    expect(groups).toHaveLength(2);
    // Biggest first: if the allowance runs out, it runs out having priced the
    // most hotels it could.
    expect(groups[0].places).toHaveLength(2);
    expect(groups[0].query).toMatch(/Indiana Convention Center/);
    expect(groups[1].query).toMatch(/Plainfield/);
  });

  it('treats a hotel with no town as downtown rather than dropping it', () => {
    const groups = serpapi.areas([place('a', 'walk', 100)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].places).toHaveLength(1);
  });

  it('reports every property it saw, matched or not', async () => {
    // The interesting failure is twenty hotels coming back and two matching,
    // which looks exactly like a thin response unless both halves are printed.
    const reply = {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          properties: [
            { name: 'Motel 6 Southport Indianapolis', rate_per_night: { extracted_lowest: 71 } },
            { name: 'A Hotel Nobody Here Has', rate_per_night: { extracted_lowest: 95 } },
            { name: 'No Price On This One' },
          ],
        }),
    };
    const seen = [];
    const found = await serpapi.quoteArea([PLACES[3]], {
      env: { SERPAPI_KEY: 'k' },
      whenMs: AUGUST,
      fetch: async () => reply,
      report: (one) => seen.push(one),
    });
    expect(found).toHaveLength(1);
    expect(found[0].nightly).toBe(71);
    expect(seen).toHaveLength(3);
    expect(seen.filter((one) => !one.matched).map((one) => one.name)).toEqual([
      'A Hotel Nobody Here Has',
      'No Price On This One',
    ]);
  });

  it('walks the pages, because one search is about twenty hotels', async () => {
    /*
     * The gap that would have looked like a broken service. Indianapolis has
     * 184 of our hotels in it and a Google Hotels search returns a page of
     * about twenty — so a single search prices the first twenty and leaves a
     * hundred and sixty reading as simply unpriced.
     */
    const pages = [
      { properties: [{ name: 'Motel 6 Southport Indianapolis', rate_per_night: { extracted_lowest: 71 } }], serpapi_pagination: { next_page_token: 'two' } },
      { properties: [{ name: 'Conrad Carmel', rate_per_night: { extracted_lowest: 300 } }], serpapi_pagination: { next_page_token: 'three' } },
      { properties: [{ name: 'Super 8 Airport', rate_per_night: { extracted_lowest: 60 } }] },
    ];
    const tokens = [];
    let page = 0;
    const found = await serpapi.quoteArea([PLACES[3], PLACES[4], PLACES[5]], {
      env: { SERPAPI_KEY: 'k' },
      whenMs: AUGUST,
      fetch: async (url) => {
        tokens.push(new URL(url).searchParams.get('next_page_token'));
        const body = pages[page++];
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
      },
      charge: () => true,
    });

    expect(tokens).toEqual([null, 'two', 'three']);
    expect(found.map((one) => one.placeId).sort()).toEqual(['d1', 'd2', 'd3']);
  });

  it('records every page it walked in the ledger, not just the first', async () => {
    /*
     * The wiring, not the adapter. `charge` only bounds anything if the run
     * loop actually hands one over — without it a paging source is handed a
     * missing callback, pages freely, and spends a month's allowance the
     * ledger has no record of.
     */
    const ledger = ledgerFor(null, AUGUST);
    const pager = {
      name: 'serpapi',
      covers: 'area',
      ready: () => true,
      cost: 1,
      areas: (all) => [{ places: all, label: 'one town' }],
      quoteArea: async (_places, { charge }) => {
        // Two pages beyond the one the loop already paid for.
        charge();
        charge();
        return [];
      },
    };

    await runOnce({
      places: PLACES,
      quotes: [],
      ledger,
      env: {},
      whenMs: AUGUST,
      sources: [pager],
    });

    expect(ledger.spent.serpapi).toBe(3);
  });

  it('stops paging when the month says stop, rather than spending it unseen', async () => {
    // Every page is another search. A source that pages without charging for
    // them spends an allowance the ledger never sees.
    let page = 0;
    const found = await serpapi.quoteArea([PLACES[3], PLACES[4]], {
      env: { SERPAPI_KEY: 'k' },
      whenMs: AUGUST,
      fetch: async () => {
        page += 1;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              properties: [{ name: 'Motel 6 Southport Indianapolis', rate_per_night: { extracted_lowest: 71 } }],
              serpapi_pagination: { next_page_token: 'more' },
            }),
        };
      },
      // The first page is paid for by the run loop; nothing after it is.
      charge: () => false,
    });

    expect(page).toBe(1);
    expect(found).toHaveLength(1);
  });

  it('spends one unit per town, and stops when the allowance runs out', async () => {
    // Three towns and two searches left: two get asked, the third does not, and
    // nothing goes over.
    const asked = [];
    const source = {
      name: 'serpapi',
      covers: 'area',
      ready: () => true,
      cost: 1,
      areas: (places) => [
        { label: 'one', query: 'q1', places },
        { label: 'two', query: 'q2', places },
        { label: 'three', query: 'q3', places },
      ],
      quoteArea: async (_places, { query }) => {
        asked.push(query);
        return [];
      },
    };
    const ledger = ledgerFor(null, AUGUST);
    await runOnce({
      places: PLACES,
      quotes: [],
      ledger,
      env: { RATES_QUOTA_SERPAPI: '2' },
      whenMs: AUGUST,
      sources: [source],
    });
    expect(asked).toEqual(['q1', 'q2']);
    expect(ledger.spent.serpapi).toBe(2);
  });
});

describe('telling one hotel from another', () => {
  it('will not put a downtown price on a suburb of the same chain', () => {
    /*
     * Bought with a wrong price on a live run. SerpApi returned "Tru by Hilton
     * Indianapolis Downtown" at $166 and the matcher gave it to "Tru by Hilton
     * Indianapolis-Lawrence", seventeen kilometres away — because `hilton`
     * counted as a distinguishing word, so the two shared `tru` and `hilton`
     * and cleared the two-word bar. A franchise brand says who runs a hotel,
     * not which one it is.
     */
    const lawrence = [place('a', 'drive', 17023, { name: 'Tru by Hilton Indianapolis-Lawrence' })];
    expect(matchByName(lawrence, 'Tru by Hilton Indianapolis Downtown')).toBeNull();
    expect([...words('Tru by Hilton Indianapolis Downtown')]).toEqual(['tru']);
  });

  it('still matches a hotel whose whole name is chain words', () => {
    // "Marriott Indianapolis Downtown" is nothing but stripped words, and an
    // empty set matches nothing at all.
    const places = [place('a', 'walk', 192, { name: 'Marriott Indianapolis Downtown' })];
    expect(matchByName(places, 'Indianapolis Marriott Downtown')?.id).toBe('a');
  });

  it('separates hotels by position where their names cannot', () => {
    /*
     * Four hotels in this city reduce to "la quinta" — one 1.4 km from the hall
     * and three sixteen kilometres out. No care with words can tell them apart,
     * because the names genuinely are identical. The coordinates are not.
     */
    const quintas = [
      { id: 'downtown', name: 'La Quinta Inn & Suites', lat: 39.7538, lng: -86.1621 },
      { id: 'south', name: 'La Quinta Inn & Suites', lat: 39.68, lng: -86.12 },
      { id: 'east', name: 'La Quinta Inn', lat: 39.78, lng: -86.01 },
    ];
    expect(matchByName(quintas, 'La Quinta Inn & Suites by Wyndham Indianapolis Downtown')).toBeNull();
    expect(matchByPoint(quintas, { lat: 39.75383, lng: -86.16215 })?.id).toBe('downtown');
    expect(matchByPoint(quintas, { lat: 39.68005, lng: -86.12002 })?.id).toBe('south');
  });

  it('refuses a position that is near nothing, or near two things', () => {
    const twins = [
      { id: 'a', name: 'One', lat: 39.7538, lng: -86.1621 },
      { id: 'b', name: 'Two', lat: 39.75381, lng: -86.16211 },
    ];
    // Two hotels within eighty metres of one point is a car park, not a match.
    expect(matchByPoint(twins, { lat: 39.7538, lng: -86.1621 })).toBeNull();
    expect(matchByPoint(twins, { lat: 39.9, lng: -86.9 })).toBeNull();
    /*
     * And the *nearest* hotel to a point is not the same building as it — even
     * when it is the only candidate there is. Two kilometres away is the next
     * district in this city, and a radius that accepted it would turn "which
     * building" back into "which is closest", which is the question that got
     * the Tru wrong.
     */
    const lonely = [{ id: 'only', name: 'Only One', lat: 39.7538, lng: -86.1621 }];
    expect(matchByPoint(lonely, { lat: 39.7538, lng: -86.1621 })?.id).toBe('only');
    expect(matchByPoint(lonely, { lat: 39.7718, lng: -86.1621 })).toBeNull();
    expect(matchByPoint(twins, null)).toBeNull();
    expect(matchByPoint(twins, { lat: NaN, lng: 0 })).toBeNull();
  });

  it('prefers a position to a name, and says which it used', async () => {
    const reply = {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          properties: [
            {
              name: 'La Quinta Inn & Suites by Wyndham Indianapolis Downtown',
              rate_per_night: { extracted_lowest: 108 },
              gps_coordinates: { latitude: 39.7538, longitude: -86.1621 },
            },
          ],
        }),
    };
    const seen = [];
    const found = await serpapi.quoteArea(
      [
        { id: 'downtown', name: 'La Quinta Inn & Suites', lat: 39.7538, lng: -86.1621 },
        { id: 'south', name: 'La Quinta Inn & Suites', lat: 39.68, lng: -86.12 },
      ],
      { env: { SERPAPI_KEY: 'k' }, whenMs: AUGUST, fetch: async () => reply, report: (one) => seen.push(one) },
    );
    expect(found).toHaveLength(1);
    expect(found[0].placeId).toBe('downtown');
    expect(seen[0].how).toBe('position');
  });

  it('falls back to the name when no coordinates come back', async () => {
    // Nothing here has been run against the live service, so the field may not
    // arrive at all. Losing every match to that would be worse than the naming.
    const reply = {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ properties: [{ name: 'Atlas Hotel', rate_per_night: { extracted_lowest: 149 } }] }),
    };
    const seen = [];
    const found = await serpapi.quoteArea([place('atlas', 'walk', 1458, { name: 'Atlas Hotel' })], {
      env: { SERPAPI_KEY: 'k' },
      whenMs: AUGUST,
      fetch: async () => reply,
      report: (one) => seen.push(one),
    });
    expect(found[0].placeId).toBe('atlas');
    expect(seen[0].how).toBe('name');
  });
});
