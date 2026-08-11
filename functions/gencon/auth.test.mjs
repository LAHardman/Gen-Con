/**
 * Signing in, and the four ways it goes wrong.
 *
 * The happy path here is the least interesting thing in the file. What decides
 * whether this feature is safe to ship is the rest:
 *
 *   - the password must never leave in a response, a cookie, or anything else
 *     this code hands back;
 *   - the session must reach the browser somewhere script cannot read it, or an
 *     XSS on this app becomes a stolen Gen Con account;
 *   - "we were blocked" must not be reported as "wrong password", or somebody
 *     resets a password that was fine;
 *   - a scraper that recognises nothing must say so rather than return an empty
 *     profile, which reads as an empty account.
 *
 * Gen Con is stubbed throughout. These are about this code's own decisions, and
 * the one question only the real site can answer — whether it accepts a login
 * from a datacentre at all — is what `scripts/gencon-login-spike.mjs` is for.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { onRequest as login, csrfToken, sessionCookie, verdict } from './login.js';
import { onRequest as logout } from './logout.js';
import { onRequest as whoami, inputValue, isSignInPage, profileFrom } from './whoami.js';

afterEach(() => vi.unstubAllGlobals());

const SIGN_IN_FORM = `
  <form action="/users/sign_in" method="post">
    <input type="hidden" name="authenticity_token" value="TOKEN-FROM-THE-PAGE" />
    <input type="text" name="user[email]" />
    <input type="password" name="user[password]" />
  </form>`;

/** A response with real `getSetCookie`, which is what the code reads. */
function reply(body, { status = 200, cookies = [], location } = {}) {
  const headers = new Headers();
  if (location) headers.set('Location', location);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name) => headers.get(name),
      getSetCookie: () => cookies,
    },
    text: async () => body,
  };
}

/** Stub Gen Con: first call is the sign-in page, second is the attempt. */
function stubGencon(pageReply, loginReply) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return calls.length === 1 ? pageReply : loginReply;
    }),
  );
  return calls;
}

const post = (body) =>
  new Request('https://app.example/gencon/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });

const GOOD_PAGE = () => reply(SIGN_IN_FORM, { cookies: ['_genconllc_session=PRIMING; path=/'] });

describe('signing in', () => {
  it('sends Gen Con the token from their own page, with the session it came with', async () => {
    // Rails binds the two together and drops the attempt if they disagree, so
    // reusing a token without its cookie fails in a way nothing else explains.
    const calls = stubGencon(
      GOOD_PAGE(),
      reply('', { status: 302, location: '/', cookies: ['_genconllc_session=SIGNED-IN; path=/'] }),
    );
    const response = await login({ request: post({ username: 'someone', password: 'hunter2' }) });

    expect(response.status).toBe(200);
    const sent = calls[1].init;
    expect(sent.headers.Cookie).toBe('_genconllc_session=PRIMING');
    expect(sent.body.get('authenticity_token')).toBe('TOKEN-FROM-THE-PAGE');
    // Rails checks these on a non-GET whatever the token says.
    expect(sent.headers.Origin).toBe('https://www.gencon.com');
    expect(sent.headers.Referer).toBe('https://www.gencon.com/users/sign_in');
  });

  it('keeps the session Devise rotated to, not the one that primed it', async () => {
    // Devise issues a new session on sign-in. Keeping the first one leaves you
    // holding a cookie that was never signed in, which fails later and a long
    // way from here.
    stubGencon(
      GOOD_PAGE(),
      reply('', { status: 302, location: '/', cookies: ['_genconllc_session=SIGNED-IN; path=/'] }),
    );
    const response = await login({ request: post({ username: 'a', password: 'b' }) });
    expect(response.headers.get('Set-Cookie')).toContain('gc_session=SIGNED-IN');
    expect(response.headers.get('Set-Cookie')).not.toContain('PRIMING');
  });

  it('never hands the password back in any form', async () => {
    // The whole promise of the design, asserted rather than assumed.
    stubGencon(
      GOOD_PAGE(),
      reply('', { status: 302, location: '/', cookies: ['_genconllc_session=S; path=/'] }),
    );
    const secret = 'correct-horse-battery-staple';
    const response = await login({ request: post({ username: 'someone', password: secret }) });
    const body = await response.text();
    expect(body).not.toContain(secret);
    expect(response.headers.get('Set-Cookie')).not.toContain(secret);
    expect(body).not.toContain('someone');
  });

  it('puts the session where script cannot reach it', async () => {
    // If this ever becomes a JSON body for sessionStorage, an XSS on this app
    // is a stolen Gen Con session.
    stubGencon(
      GOOD_PAGE(),
      reply('', { status: 302, location: '/', cookies: ['_genconllc_session=S; path=/'] }),
    );
    const response = await login({ request: post({ username: 'a', password: 'b' }) });
    const cookie = response.headers.get('Set-Cookie');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/gencon');
    expect(await response.text()).not.toContain('S');
  });

  it('refuses anything but a POST, and an empty pair', async () => {
    const got = await login({ request: new Request('https://app.example/gencon/login') });
    expect(got.status).toBe(405);
    const empty = await login({ request: post({ username: '', password: '' }) });
    expect(empty.status).toBe(400);
  });
});

describe('telling the failures apart', () => {
  it('calls a wrong password wrong, and a block a block', async () => {
    // Reporting "wrong password" for a Cloudflare challenge sends somebody off
    // to reset a password that was fine, and they never find out why.
    expect(verdict(200, null, 'Invalid Email or password.').reason).toBe('rejected');
    expect(verdict(302, '/users/sign_in', '').reason).toBe('rejected');
    expect(verdict(200, null, '<div id="challenge-platform">').reason).toBe('challenged');
    expect(verdict(403, null, '').reason).toBe('blocked');
    expect(verdict(302, '/', '').ok).toBe(true);
  });

  it('answers 401 for a bad password and 502 for a blocked one', async () => {
    // The status is what the panel keys off, so the distinction has to survive
    // as far as the browser rather than living only in a string.
    stubGencon(GOOD_PAGE(), reply('Invalid Email or password.'));
    const wrong = await login({ request: post({ username: 'a', password: 'b' }) });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).reason).toBe('rejected');

    stubGencon(GOOD_PAGE(), reply('<div class="challenge-platform"></div>'));
    const blocked = await login({ request: post({ username: 'a', password: 'b' }) });
    expect(blocked.status).toBe(502);
    expect((await blocked.json()).says).toMatch(/nothing is wrong with your password/i);
  });

  it('stops when the sign-in page is not what it expects', async () => {
    // No token means the next POST is guaranteed to fail; sending it anyway
    // spends somebody's password on a request that cannot work.
    const calls = stubGencon(reply('<html>something else</html>'), reply(''));
    const response = await login({ request: post({ username: 'a', password: 'b' }) });
    expect(response.status).toBe(502);
    expect((await response.json()).reason).toBe('no-form');
    expect(calls).toHaveLength(1);
  });

  it('takes the token from the sign-in form and not from another one on the page', async () => {
    // That page carries four forms — sign in, sign up, reset, resend — each
    // with its own token, and only one of them is the right one.
    const many = `
      <form action="/users/password"><input name="authenticity_token" value="WRONG-1"></form>
      ${SIGN_IN_FORM}
      <form action="/users"><input name="authenticity_token" value="WRONG-2"></form>`;
    expect(csrfToken(many)).toBe('TOKEN-FROM-THE-PAGE');
  });
});

describe('signing out', () => {
  it('expires the cookie with one scoped identically', async () => {
    // A cookie is only replaceable by one with the same name and path. Get that
    // wrong and "sign out" leaves the session sitting there.
    const response = await logout({
      request: new Request('https://app.example/gencon/logout', { method: 'POST' }),
    });
    const cookie = response.headers.get('Set-Cookie');
    expect(cookie).toContain('gc_session=;');
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Path=/gencon');
    expect(cookie).toContain('HttpOnly');
  });

  it('works without asking Gen Con anything', async () => {
    // Signing out on a convention floor with two bars has to succeed.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('the network is gone');
    }));
    const response = await logout({
      request: new Request('https://app.example/gencon/logout', { method: 'POST' }),
    });
    expect(response.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('reading the account', () => {
  const ACCOUNT_FORM = `
    <form action="/users" method="post">
      <input type="text" name="user[login]" value="dicegoblin" />
      <input type="text" name="user[first_name]" value="Sam" />
      <input type="text" name="user[last_name]" value="O&#39;Neill" />
      <input type="text" name="user[email]" value="sam@example.com" />
      <input type="password" name="user[password]" value="never-read-this" />
    </form>`;

  const get = (cookie) =>
    new Request('https://app.example/gencon/whoami', { headers: cookie ? { Cookie: cookie } : {} });

  it('reads the profile off the page and says what it recognised', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(ACCOUNT_FORM)));
    const response = await whoami({ request: get('gc_session=S') });
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.profile).toEqual({
      username: 'dicegoblin',
      firstName: 'Sam',
      lastName: "O'Neill",
      email: 'sam@example.com',
    });
    expect(body.found).toContain('email');
  });

  it('never carries a password field out of the page', async () => {
    expect(inputValue(ACCOUNT_FORM, 'user[password]')).toBeNull();
  });

  it('says nothing was recognised rather than returning an empty profile', async () => {
    // The failure that matters. An empty profile reads as an empty account, and
    // somebody believes it.
    vi.stubGlobal('fetch', vi.fn(async () => reply('<html><body>Redesigned!</body></html>')));
    const response = await whoami({ request: get('gc_session=S') });
    expect(response.status).toBe(502);
    expect((await response.json()).reason).toBe('unrecognised');
  });

  it('knows an expired session from a signed-in one, both ways round', async () => {
    // Devise announces it by redirect, but a cached or rewritten response can
    // serve the sign-in page with a 200 instead.
    vi.stubGlobal('fetch', vi.fn(async () => reply('', { status: 302, location: '/users/sign_in' })));
    const bounced = await whoami({ request: get('gc_session=S') });
    expect(bounced.status).toBe(401);
    expect((await bounced.json()).reason).toBe('expired');

    vi.stubGlobal('fetch', vi.fn(async () => reply(SIGN_IN_FORM)));
    const served = await whoami({ request: get('gc_session=S') });
    expect(served.status).toBe(401);
    expect((await served.json()).reason).toBe('expired');
    expect(isSignInPage(SIGN_IN_FORM)).toBe(true);
    expect(isSignInPage(ACCOUNT_FORM)).toBe(false);
  });

  it('asks nobody anything when there is no session', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const response = await whoami({ request: get(null) });
    expect(response.status).toBe(401);
    expect((await response.json()).reason).toBe('signed-out');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps somebody’s name out of any shared cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(ACCOUNT_FORM)));
    const response = await whoami({ request: get('gc_session=S') });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('finds a field wherever the two forms disagree on its name', async () => {
    const { profile } = profileFrom('<input name="user[new_email]" value="a@b.c" />');
    expect(profile.email).toBe('a@b.c');
  });
});

describe('the cookie builder', () => {
  it('never lets a value escape its own attributes', () => {
    expect(sessionCookie('abc')).toMatch(/^gc_session=abc; Path=\/gencon; HttpOnly; Secure/);
    expect(sessionCookie('', 0)).toContain('Max-Age=0');
  });
});
