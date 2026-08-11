/**
 * Who the session belongs to — the first thing worth reading behind the login.
 *
 * WHY THIS ONE FIRST. It proves the whole chain end to end: a password went in,
 * a session came back, the browser stored it on this origin, sent it up again,
 * and Gen Con recognised it. Every later account read is that same chain with a
 * different page on the end, so if this works the hard part is done, and if it
 * does not there is no point writing parsers.
 *
 * IT SCRAPES, BECAUSE THERE IS NOTHING ELSE TO DO. Gen Con has no authenticated
 * API: `/api/v1/me`, `/profile`, `/my_events`, `/my_tickets`, `/orders`,
 * `/badges` and `/registrations` are all 404, and `/api/v1/cart` only redirects
 * to the sign-in page. The account pages are server-rendered HTML and that is
 * the only surface there is.
 *
 * SO IT FAILS LOUDLY. A scraper's real failure is not throwing — it is
 * cheerfully returning nothing when the markup moves, so the app shows an empty
 * profile and somebody concludes their account is empty. This returns an error
 * when it recognises no fields at all, and reports which ones it *did* find when
 * it finds some, so a half-broken parse looks half-broken rather than fine.
 *
 * The field names below are read off Gen Con's own sign-up form, which is
 * public. The signed-in edit form is not, and may not match. That uncertainty is
 * the reason for `found` in the response rather than a reason to guess harder.
 */

import { SESSION_COOKIE } from './login.js';

const UPSTREAM = 'https://www.gencon.com';
const AGENT = 'gen-con-trip (personal trip planner; contact via repository)';

/** The account page, which is Devise's own and needs a session to render. */
const ACCOUNT = '/users/edit';

/** `gc_session=abc; theme=dark` → `abc`. */
export function readCookie(header, name) {
  for (const pair of (header ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at > 0 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
  }
  return null;
}

/** The value of one text input, by its `name`, whatever order the attributes are in. */
export function inputValue(html, name) {
  const escaped = name.replace(/[[\]]/g, '\\$&');
    const tag = html.match(new RegExp(`<input[^>]*name="${escaped}"[^>]*>`, 'i'))?.[0];
  if (!tag) return null;
  // A password field's value is never interesting and should never be carried.
  if (/type="password"/i.test(tag)) return null;
  const value = tag.match(/value="([^"]*)"/i)?.[1];
  return value ? decode(value) : null;
}

const decode = (text) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/**
 * What the app wants, and where each piece lives on Devise's form.
 *
 * Several candidates per field because the sign-up form and the edit form
 * disagree on names — `user[new_email]` on one, `user[email]` on the other —
 * and the first that yields anything wins.
 */
const FIELDS = {
  username: ['user[login]', 'user[username]'],
  firstName: ['user[first_name]'],
  lastName: ['user[last_name]'],
  email: ['user[email]', 'user[new_email]'],
};

/** Pull the profile out of the account page, and say what was recognised. */
export function profileFrom(html) {
  const profile = {};
  const found = [];
  for (const [key, names] of Object.entries(FIELDS)) {
    for (const name of names) {
      const value = inputValue(html, name);
      if (value) {
        profile[key] = value;
        found.push(key);
        break;
      }
    }
  }
  return { profile, found };
}

/** Whether the HTML is the signed-out sign-in page rather than the account. */
export const isSignInPage = (html) =>
  /name="user\[password\]"/.test(html) && /action="\/users\/sign_in"/.test(html);

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Somebody's name is not something to leave in a shared cache.
      'Cache-Control': 'no-store',
    },
  });

export async function onRequest({ request }) {
  if (request.method !== 'GET') return json({ ok: false, reason: 'method' }, 405);

  const session = readCookie(request.headers.get('Cookie'), SESSION_COOKIE);
  if (!session) {
    return json({ ok: false, reason: 'signed-out', says: 'Not signed in.' }, 401);
  }

  const page = await fetch(`${UPSTREAM}${ACCOUNT}`, {
    headers: {
      'User-Agent': AGENT,
      Accept: 'text/html',
      Cookie: `_genconllc_session=${session}`,
    },
    redirect: 'manual',
  });

  // Devise bounces an unauthenticated request straight back to the sign-in
  // page, which is how an expired session announces itself.
  if (page.status === 302 || page.status === 303) {
    return json(
      { ok: false, reason: 'expired', says: 'That Gen Con session has ended. Sign in again.' },
      401,
    );
  }
  if (!page.ok) {
    return json({ ok: false, reason: 'upstream', says: `Gen Con answered ${page.status}.` }, 502);
  }

  const html = await page.text();
  if (isSignInPage(html)) {
    return json(
      { ok: false, reason: 'expired', says: 'That Gen Con session has ended. Sign in again.' },
      401,
    );
  }

  const { profile, found } = profileFrom(html);
  if (found.length === 0) {
    // The important branch. Silence here would read as "your account is empty".
    return json(
      {
        ok: false,
        reason: 'unrecognised',
        says: 'Signed in, but Gen Con’s account page no longer looks the way this app expects.',
      },
      502,
    );
  }

  return json({ ok: true, profile, found }, 200);
}
