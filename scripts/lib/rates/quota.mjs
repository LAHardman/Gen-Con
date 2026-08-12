/**
 * How many calls are left this month, and the promise never to spend one more.
 *
 * WHY THIS IS ITS OWN FILE WITH ITS OWN TESTS. Everything else here degrades
 * politely when it is wrong: a missing price shows a gap, a stale one shows a
 * date. Overspending a free quota does not degrade — the account stops working,
 * or starts charging, and either way somebody finds out weeks later. So the
 * budget is arithmetic in one place rather than a rule of thumb spread across
 * four adapters.
 *
 * THE NUMBERS ARE UNCERTAIN, DELIBERATELY LOW, AND OVERRIDABLE. Published free
 * tiers disagree with each other and change without notice — SerpApi's own free
 * allowance is reported as both 100 and 250 searches a month by current
 * sources, and Amadeus closed its self-service tier to individuals altogether
 * while this was being written. Every default below is therefore the *lowest*
 * figure that is credible, because guessing high spends somebody's account and
 * guessing low only means fewer prices. Each is overridable by environment
 * variable, so correcting one is a config change and not a patch.
 *
 * THE LEDGER IS A FILE IN THE REPOSITORY, which is the only store this app has
 * — there is no database and adding one for a counter would be the largest
 * dependency in the project. It means the count is only as good as the last
 * commit, so a run that dies after spending and before writing loses its own
 * tally. That is why spending is recorded *before* the call rather than after:
 * an over-count wastes a few requests, an under-count exceeds the quota.
 */

/** A calendar month in UTC, `2026-08`. The window every free tier resets on. */
export const monthOf = (whenMs) => new Date(whenMs).toISOString().slice(0, 7);

/**
 * What each source will give away in a month, at its most pessimistic reading.
 *
 * `unit` is what one unit *buys*, and they are not comparable: a SerpApi search
 * returns a page of hotels, an Amadeus call returns offers for one hotel. The
 * planner treats them as separate currencies for that reason.
 */
export const SOURCES = {
  serpapi: {
    label: 'SerpApi (Google Hotels)',
    // Reported as both 100 and 250 for the free plan. The low reading wins.
    free: 100,
    unit: 'search',
    /** One search covers a whole area, so it is worth spending on the ring. */
    covers: 'area',
  },
  xotelo: {
    label: 'Xotelo (TripAdvisor rates)',
    /*
     * No key and no published monthly cap, but "no documented limit" is not
     * "no limit" — it is an unmetered free service that can withdraw. The cap
     * here is self-imposed politeness rather than an allowance being spent.
     */
    free: 900,
    unit: 'lookup',
    covers: 'place',
    /** It asks for a per-second pace rather than a monthly budget. */
    pacingMs: 1_200,
  },
  apify: {
    label: 'Apify (actor run)',
    /*
     * $5 of platform credit a month at $0.20 per compute unit is 25 CU. A
     * booking-site actor run costs well under a CU for a handful of hotels, but
     * "well under" is not a number anybody publishes, so this counts *runs* and
     * assumes each is worth a whole CU. Wrong in the safe direction.
     */
    free: 25,
    unit: 'run',
    covers: 'area',
  },
};

/** `RATES_QUOTA_SERPAPI=250` overrides one, for when a tier is confirmed. */
export function quotaFor(name, env = {}) {
  const source = SOURCES[name];
  if (!source) throw new Error(`no such source: ${name}`);
  const override = env[`RATES_QUOTA_${name.toUpperCase()}`];
  if (override === undefined || override === '') return source.free;
  const parsed = Number(override);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`RATES_QUOTA_${name.toUpperCase()} is not a count: ${override}`);
  }
  return Math.floor(parsed);
}

/**
 * A source that is switched off entirely.
 *
 * Distinct from having no quota left: off means "do not call this at all", and
 * it is how somebody turns a source off without deleting its adapter, and how
 * a source with no credentials configured takes itself out of the running.
 */
export const isOff = (name, env = {}) => env[`RATES_OFF_${name.toUpperCase()}`] === '1';

/** An empty ledger, which is what a first run and a new month both look like. */
export const emptyLedger = (month) => ({ month, spent: {}, tried: {} });

/**
 * Roll the ledger into the month `whenMs` falls in.
 *
 * A new month is a clean allowance, but *not* a clean memory: `tried` records
 * which places were probed and found too expensive, and forgetting that every
 * month would mean re-buying the same disappointing answer twelve times a year.
 */
export function ledgerFor(stored, whenMs) {
  const month = monthOf(whenMs);
  if (!stored || typeof stored !== 'object') return emptyLedger(month);
  if (stored.month !== month) return { month, spent: {}, tried: stored.tried ?? {} };
  return { month, spent: { ...stored.spent }, tried: { ...(stored.tried ?? {}) } };
}

/** How many units of `name` are still available this month. */
export function remaining(ledger, name, env = {}) {
  if (isOff(name, env)) return 0;
  return Math.max(0, quotaFor(name, env) - (ledger.spent[name] ?? 0));
}

/**
 * Take `units` from a source, or refuse.
 *
 * Called *before* the request, never after: a run that dies mid-call has then
 * over-counted by one, which costs a request. Counting afterwards would
 * under-count on exactly the same failure, which costs the quota.
 */
export function spend(ledger, name, units = 1, env = {}) {
  if (units <= 0) throw new Error('spend at least one unit');
  if (remaining(ledger, name, env) < units) return false;
  ledger.spent[name] = (ledger.spent[name] ?? 0) + units;
  return true;
}

/** Note that a place was probed and rejected, so next month does not repeat it. */
export function noteTried(ledger, placeId, whenMs) {
  ledger.tried[placeId] = monthOf(whenMs);
}

/** Everything left, by source, for a run that wants to report before it starts. */
export const budget = (ledger, env = {}) =>
  Object.fromEntries(Object.keys(SOURCES).map((name) => [name, remaining(ledger, name, env)]));
