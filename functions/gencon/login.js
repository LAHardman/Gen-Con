/**
 * Signing in to Gen Con, without this app ever keeping the password.
 *
 * WHY A SERVER HAS TO DO THIS AT ALL. A browser cannot: gencon.com sends no
 * `Access-Control-Allow-Origin`, so the sign-in page cannot be read for its CSRF
 * token; the session cookie is `HttpOnly`, so script could not capture it; and
 * it is `SameSite=Lax`, so the browser would never attach it to a request from
 * this origin even if it had it. Those are three separate walls and all three
 * are deliberate. A server is not bound by any of them.
 *
 * WHAT IS AND IS NOT KEPT. The password exists as a string in this Worker for
 * the length of one request and is written nowhere — no KV, no cache, no log.
 * What comes back is Gen Con's session cookie, and that is handed to the browser
 * as an `HttpOnly` cookie **on this app's own origin**, so:
 *
 *   - the Worker stays stateless: there is no session store here to breach;
 *   - script on this page cannot read it either, so an XSS on this app cannot
 *     steal a Gen Con session. Returning it in the response body for
 *     `sessionStorage` would have given that away for nothing.
 *
 * THE ONE RULE THIS FILE LIVES BY: never log the request. Not the body, not the
 * parsed form, not an error object that happens to carry either. "The password
 * is not stored" is a property of the code rather than of the architecture, and
 * it is exactly one well-meaning `console.log(request)` away from being false.
 * If you add diagnostics here, log the *shape* — lengths, statuses, verdicts.
 *
 * WHAT THIS IS NOT. It is not a way to hold an account open. It signs in when
 * somebody asks and hands back one session; nothing here runs on a schedule,
 * retries a password, or acts on an account without a person pressing something.
 */

const UPSTREAM = 'https://www.gencon.com';
const AGENT = 'gen-con-trip (personal trip planner; contact via repository)';

/**
 * The name this app's own cookie goes by.
 *
 * Deliberately not `_genconllc_session`: it is a different cookie on a different
 * origin that happens to carry the same value, and naming it after theirs would
 * invite somebody to think the browser is talking to Gen Con directly.
 */
export const SESSION_COOKIE = 'gc_session';

/**
 * Eight hours.
 *
 * Long enough to plan in one sitting, short enough that a shared or forgotten
 * browser is not signed in tomorrow. Devise will expire its own side on its own
 * schedule; this is only how long the browser bothers to keep offering it.
 */
const MAX_AGE = 8 * 60 * 60;

/** One `Set-Cookie` value, scoped as tightly as it can be. */
export function sessionCookie(value, maxAge = MAX_AGE) {
  return [
    `${SESSION_COOKIE}=${value}`,
    // Only the routes that talk to Gen Con ever need it. The map and the
    // schedule have no business receiving it on every request.
    'Path=/gencon',
    'HttpOnly',
    'Secure',
    // Strict, not Lax: nothing about this should survive arriving from
    // somebody else's link.
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

/** `_genconllc_session=abc; other=1` → `abc`. */
export function readSetCookie(headers, name) {
  for (const line of headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const at = pair.indexOf('=');
    if (at > 0 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
  }
  return null;
}

/** The hidden CSRF field out of the sign-in form, and only that form. */
export function csrfToken(html) {
  return (
    html.match(
      /<form[^>]*action="\/users\/sign_in"[\s\S]*?name="authenticity_token"[^>]*value="([^"]+)"/,
    )?.[1] ?? null
  );
}

/**
 * What Gen Con's answer to a login attempt means.
 *
 * Split out and exported because the failure modes are the whole risk here and
 * they deserve tests: a Cloudflare challenge and a wrong password both come back
 * as unhelpful HTML, and telling somebody "wrong password" when the truth is
 * "we were blocked" sends them off to reset a password that was fine.
 */
export function verdict(status, location, body) {
  if (/cf-browser-verification|challenge-platform|__cf_chl|Attention Required/i.test(body)) {
    return { ok: false, reason: 'challenged', status: 502 };
  }
  if (status === 403) return { ok: false, reason: 'blocked', status: 502 };
  if (status === 302 || status === 303) {
    if (/\/users\/sign_in/.test(location ?? '')) {
      return { ok: false, reason: 'rejected', status: 401 };
    }
    return { ok: true };
  }
  if (/Invalid\s+(Email|Username|Login)|invalid[^<]{0,30}password/i.test(body)) {
    return { ok: false, reason: 'rejected', status: 401 };
  }
  if (/name="user\[password\]"/.test(body)) {
    return { ok: false, reason: 'rejected', status: 401 };
  }
  return { ok: false, reason: 'unclear', status: 502 };
}

/** What each verdict is called, for somebody reading it on a screen. */
const SAYS = {
  rejected: 'Gen Con did not accept that username and password.',
  challenged: 'Gen Con’s bot protection blocked the sign-in. Nothing is wrong with your password.',
  blocked: 'Gen Con refused the request before it reached their sign-in.',
  unclear: 'Gen Con answered in a way this app did not recognise.',
};

const json = (body, status, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });

export async function onRequest({ request }) {
  if (request.method !== 'POST') {
    return json({ ok: false, reason: 'method', says: 'Sign in is a POST.' }, 405);
  }

  let credentials;
  try {
    credentials = await request.json();
  } catch {
    // Note the absence of the parse error itself: it can quote the body.
    return json({ ok: false, reason: 'malformed', says: 'Expected JSON.' }, 400);
  }
  const username = String(credentials?.username ?? '');
  const password = String(credentials?.password ?? '');
  if (!username || !password) {
    return json({ ok: false, reason: 'incomplete', says: 'Both fields are needed.' }, 400);
  }

  // 1. Their sign-in page, for the CSRF token and the pre-login session that
  //    the token is bound to. Rails rejects one without the other.
  const page = await fetch(`${UPSTREAM}/users/sign_in`, {
    headers: { 'User-Agent': AGENT, Accept: 'text/html' },
    redirect: 'manual',
  });
  const html = await page.text();
  const token = csrfToken(html);
  const priming = readSetCookie(page.headers, '_genconllc_session');
  if (!token || !priming) {
    return json(
      { ok: false, reason: 'no-form', says: 'Gen Con’s sign-in page was not what this expected.' },
      502,
    );
  }

  // 2. The attempt itself.
  const login = await fetch(`${UPSTREAM}/users/sign_in`, {
    method: 'POST',
    headers: {
      'User-Agent': AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html',
      Cookie: `_genconllc_session=${priming}`,
      // Rails checks both of these on a non-GET, and drops the request without
      // them however good the token is.
      Origin: UPSTREAM,
      Referer: `${UPSTREAM}/users/sign_in`,
    },
    body: new URLSearchParams({
      'user[email]': username,
      'user[password]': password,
      'user[remember_me]': '0',
      authenticity_token: token,
      commit: 'Sign In',
    }),
    redirect: 'manual',
  });
  const body = await login.text();
  const answer = verdict(login.status, login.headers.get('location'), body);

  if (!answer.ok) {
    return json({ ok: false, reason: answer.reason, says: SAYS[answer.reason] }, answer.status);
  }

  // Devise rotates the session on a successful sign-in, so the cookie worth
  // keeping is the one on *this* response, not the one that primed it.
  const session = readSetCookie(login.headers, '_genconllc_session');
  if (!session) {
    return json(
      { ok: false, reason: 'no-session', says: 'Gen Con signed in but sent no session.' },
      502,
    );
  }

  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(session) });
}
