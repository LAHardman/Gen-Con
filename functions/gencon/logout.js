/**
 * Signing out, which has to be possible without a working network.
 *
 * The session lives in a cookie on this app's origin, so ending it is this
 * app's job alone — it expires the cookie and does not ask Gen Con's opinion.
 * That is deliberate: somebody pressing "sign out" on a convention floor with
 * two bars of signal needs it to work, and a sign-out that can fail is a
 * sign-out somebody does not trust.
 *
 * It does mean Gen Con's own session stays alive on their side until it times
 * out. The honest framing is that this is the app forgetting, not Gen Con — and
 * the panel says so, because "signed out" that leaves a live session somewhere
 * is the sort of half-truth people make decisions on.
 */

import { SESSION_COOKIE, sessionCookie } from './login.js';

export async function onRequest({ request }) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, reason: 'method' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Same name, same path, no life left. A cookie is only replaceable by one
      // scoped identically, which is why this goes through the same builder.
      'Set-Cookie': sessionCookie('', 0),
    },
  });
}

export { SESSION_COOKIE };
