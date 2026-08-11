/**
 * Does Gen Con accept a login from a server at all?
 *
 *     GENCON_USER='you@example.com' GENCON_PASS='...' node scripts/gencon-login-spike.mjs
 *     node scripts/gencon-login-spike.mjs            # fake credentials, mechanism only
 *
 * THIS IS A SPIKE, NOT A FEATURE. It exists to answer one question before any
 * UI is built on top of it: gencon.com sits behind Cloudflare, and a login POST
 * arriving from a datacentre IP — which is what a Cloudflare Worker is — may be
 * challenged before Rails ever sees it. If it is, the whole
 * server-authenticates design is dead and it is worth finding that out in ten
 * minutes rather than after a sign-in panel exists.
 *
 * Run with no credentials and it posts an obviously fake pair. That still
 * answers the question: an "invalid email or password" page proves the request
 * reached Devise, which is the thing in doubt. A challenge page or a 403 proves
 * it did not. Neither outcome needs a real account, which is why the default is
 * the fake one.
 *
 * THE PASSWORD IS NEVER LOGGED. Not on success, not in an error path, not in
 * the request dump below — the body is reported by *shape*, never by content.
 * That rule is the whole security story of the design this is testing, and it
 * has to hold in the throwaway script too, because this is the file somebody
 * copies from.
 *
 * WHAT IT DOES NOT DO: read anything from the account, and nothing on a
 * schedule. One GET and one POST, by hand, when somebody runs it.
 */

const BASE = 'https://www.gencon.com';
/** Honest, and the same shape as the one the proxy Function already sends. */
const AGENT = 'gen-con-trip (personal trip planner; contact via repository)';

const USER = process.env.GENCON_USER ?? 'no-such-account.spike@example.invalid';
const PASS = process.env.GENCON_PASS ?? 'not-a-real-password';
const REAL = Boolean(process.env.GENCON_USER);

/** Cookie jar, in the only form this needs: name=value pairs for one host. */
const jar = new Map();
function keep(response) {
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const at = pair.indexOf('=');
    if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
  }
}
const cookieHeader = () =>
  [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

/** What a response *is*, without printing anything sensitive out of it. */
function classify(status, location, body) {
  if (/cf-browser-verification|challenge-platform|__cf_chl|Attention Required/i.test(body)) {
    return 'CLOUDFLARE CHALLENGE — Rails never saw it';
  }
  if (status === 403) return 'FORBIDDEN — blocked before Rails';
  if (status === 302 || status === 303) {
    if (/sign_in/.test(location ?? '')) return 'REJECTED — bounced back to the sign-in page';
    return `SIGNED IN — redirected to ${location}`;
  }
  if (/Invalid (Email|Username|email)|invalid.{0,20}password/i.test(body)) {
    return 'REACHED DEVISE — it answered "invalid credentials"';
  }
  if (/authenticity_token/.test(body) && /user\[password\]/.test(body)) {
    return 'REJECTED — the sign-in form was served back';
  }
  return `UNCLEAR — status ${status}, ${body.length} bytes`;
}

console.log(REAL ? 'Using GENCON_USER from the environment.' : 'Using a deliberately fake account.');
console.log('The password is never printed, logged or written to disk.\n');

/* ---- 1. the sign-in page, for the CSRF token and the pre-login session ---- */

const page = await fetch(`${BASE}/users/sign_in`, {
  headers: { 'User-Agent': AGENT, Accept: 'text/html' },
  redirect: 'manual',
});
keep(page);
const html = await page.text();
console.log(`GET  /users/sign_in            ${page.status}`);
console.log(`     cookies received          ${[...jar.keys()].join(', ') || 'none'}`);

const token = html.match(
  /<form[^>]*action="\/users\/sign_in"[\s\S]*?name="authenticity_token"[^>]*value="([^"]+)"/,
)?.[1];
console.log(`     authenticity_token        ${token ? `found (${token.length} chars)` : 'NOT FOUND'}`);
if (!token) {
  console.log('\nNo CSRF token, so there is nothing to post. Stop here.');
  process.exit(1);
}

/* ---------------------------- 2. the login POST --------------------------- */

const form = new URLSearchParams({
  'user[email]': USER,
  'user[password]': PASS,
  'user[remember_me]': '0',
  authenticity_token: token,
  commit: 'Sign In',
});

const before = jar.get('_genconllc_session');
const login = await fetch(`${BASE}/users/sign_in`, {
  method: 'POST',
  headers: {
    'User-Agent': AGENT,
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'text/html',
    Cookie: cookieHeader(),
    // Rails checks this against its own host on non-GET requests.
    Origin: BASE,
    Referer: `${BASE}/users/sign_in`,
  },
  body: form,
  redirect: 'manual',
});
keep(login);
const body = await login.text();
const after = jar.get('_genconllc_session');

console.log(`\nPOST /users/sign_in            ${login.status}`);
console.log(`     session cookie rotated    ${before && after && before !== after ? 'yes' : 'no'}`);
console.log(`     verdict                   ${classify(login.status, login.headers.get('location'), body)}`);

console.log(`
What this tells you
  REACHED DEVISE (or SIGNED IN) — a server-side login is mechanically possible.
  CLOUDFLARE CHALLENGE / FORBIDDEN — it is not, from this kind of IP, and the
  design needs rethinking rather than debugging.

Run from a Cloudflare Worker before trusting a pass: this machine is a
datacentre IP but not the same one, and Cloudflare treats its own network
differently from everybody else's.`);
