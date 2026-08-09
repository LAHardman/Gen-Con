/**
 * Gen Con's API, on this app's own origin.
 *
 * WHY THIS EXISTS. Gen Con sends no `Access-Control-Allow-Origin`, so a browser
 * cannot read their API directly — that is not a thing any amount of front-end
 * code can work around, and it is why the schedule is imported at build time
 * into a file the app ships with.
 *
 * But a *same-origin* request has no CORS rule to break. Once the app is served
 * by Cloudflare Pages, this Function sits on the same origin as the app and
 * forwards to Gen Con server-side, so `/gencon/api/event_search?...` is readable
 * where `https://www.gencon.com/api/event_search?...` is not.
 *
 * It replaces the `_redirects` rule that used to do this. Netlify can proxy to
 * another host from `_redirects`; **Cloudflare Pages cannot** — there, a `200`
 * rewrite only points at paths inside the same project — so on Cloudflare that
 * rule silently did nothing and the live check reported itself unavailable.
 *
 * WHAT IT IS DELIBERATELY NOT. It is not a way to rebuild the schedule in the
 * browser: that is about 1,100 requests, and doing it from a phone would be
 * slower, hungrier and ruder than doing it once at build time. It is for small,
 * specific questions — has this event moved room since the build — where the
 * alternative is not being able to ask at all.
 */

/** Only Gen Con, and only the read-only API. */
const UPSTREAM = 'https://www.gencon.com';
const ALLOWED = /^\/api\//;

/** Their server refuses Node's default, and an honest one is good manners. */
const AGENT = 'gen-con-trip (personal trip planner; contact via repository)';

export async function onRequest({ request, params }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('only GET', { status: 405 });
  }

  const tail = Array.isArray(params.path) ? params.path.join('/') : (params.path ?? '');
  const path = `/${tail}`;
  // An open proxy is somebody else's outbound traffic on your bill and your
  // reputation. This one forwards to exactly one host, and only to the part of
  // it that reads.
  if (!ALLOWED.test(path)) {
    return new Response('only /api/ is proxied', { status: 403 });
  }

  const from = new URL(request.url);
  const to = new URL(path + from.search, UPSTREAM);

  const response = await fetch(to, {
    headers: { 'User-Agent': AGENT, Accept: 'application/json' },
    // Cloudflare's own cache, so the same question asked by twenty phones on
    // the same convention floor costs Gen Con one request rather than twenty.
    cf: { cacheTtl: 300, cacheEverything: true },
  });

  const body = await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
