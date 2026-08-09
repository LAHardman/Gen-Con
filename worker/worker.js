/**
 * A second place to get the schedule from, on somebody else's free tier.
 *
 * WHAT IT IS FOR. Everything the app needs is baked into the deploy on GitHub
 * Pages, and a phone that has opened the app once keeps working forever without
 * either — that is tested and it is not what this is about. This is for the two
 * things a cache cannot do: hand the schedule to a device that has never had it,
 * and keep it current when the deploy that used to refresh it has stopped.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not talk to Gen Con. An earlier
 * sketch had it aggregating their catalogue itself, and that was wrong: the
 * catalogue is about 1,100 requests and a Worker on the free plan is capped at
 * **50 subrequests per invocation**, so it cannot be done in one call and is
 * miserable across many. The aggregation stays in GitHub Actions, where it
 * already works and where the limit does not exist.
 *
 * So this is a dumb static server, and that is the point. Once a snapshot is in
 * KV it is served indefinitely — with no dependency on GitHub Actions still
 * running, GitHub Pages still serving, or Gen Con's API still existing. The
 * failure mode is a schedule that gets old, which is a great deal better than
 * one that is gone.
 *
 * ROUTES
 *   GET  /events.json   the newest snapshot, with CORS so a browser may read it
 *   PUT  /events.json   store a snapshot; requires the shared secret
 *   GET  /health        what it holds and how old it is
 *
 * The PUT is what the deploy calls. It is the only writable thing here and the
 * only reason this needs a secret at all.
 */

const KEY = 'events.json';
const META = 'events.meta';

/**
 * Long, because the thing being cached is a file that changes once a week at
 * most, and short-lived caching is how a mirror ends up hitting its own origin
 * on every request. `stale-while-revalidate` means a phone is never made to
 * wait for a revalidation it does not care about.
 */
const CACHE = 'public, max-age=3600, stale-while-revalidate=604800';

const cors = {
  // A browser may read this from anywhere, which is the entire reason the
  // mirror exists — the app is served from a different origin to this one, and
  // without this header it could not be read at all.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extra },
  });

/**
 * Constant-time-ish comparison.
 *
 * The secret only guards who may replace the schedule, so this is not holding
 * back a determined attacker — but comparing with `===` leaks the length and
 * the first differing byte through timing, and there is no reason to.
 */
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (path === '/health') {
      const meta = await env.SCHEDULE.get(META, 'json');
      return json({
        holding: meta ? KEY : null,
        events: meta?.events ?? null,
        year: meta?.year ?? null,
        storedAt: meta?.storedAt ?? null,
        ageHours: meta?.storedAt ? Math.round((Date.now() - Date.parse(meta.storedAt)) / 3_600_000) : null,
      });
    }

    if (path === '/events.json' && request.method === 'PUT') {
      const offered = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      if (!env.UPLOAD_SECRET || !same(offered, env.UPLOAD_SECRET)) {
        return json({ error: 'not authorised' }, 401);
      }
      const body = await request.text();
      let feed;
      try {
        feed = JSON.parse(body);
      } catch {
        return json({ error: 'not JSON' }, 400);
      }
      // Refusing a bad upload matters more here than anywhere else in this
      // repository: whatever is stored may be the last copy anybody ever sees,
      // long after there is anything left to re-fetch from. An empty or
      // truncated feed must not be allowed to replace a good one.
      if (!Array.isArray(feed?.events) || feed.events.length < 1000) {
        return json({ error: `refusing a feed with ${feed?.events?.length ?? 0} events` }, 400);
      }
      await env.SCHEDULE.put(KEY, body);
      await env.SCHEDULE.put(
        META,
        JSON.stringify({ events: feed.events.length, year: feed.year, storedAt: new Date().toISOString() }),
      );
      return json({ stored: feed.events.length, year: feed.year });
    }

    if (path === '/events.json') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'method not allowed' }, 405);
      }
      const body = await env.SCHEDULE.get(KEY, 'stream');
      if (!body) return json({ error: 'nothing stored yet' }, 404);
      return new Response(request.method === 'HEAD' ? null : body, {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': CACHE, ...cors },
      });
    }

    return json({ error: 'not found', routes: ['/events.json', '/health'] }, 404);
  },
};
