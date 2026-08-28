/**
 * The Gen Con session, as far as the browser is allowed to know about it.
 *
 * WHICH IS DELIBERATELY NOT MUCH. The session itself is an `HttpOnly` cookie on
 * this app's origin, so nothing here can read it and nothing here tries. What
 * this hook holds is the *consequence* of a session — a name, an email — and a
 * flag for whether the last thing the server said was "signed in".
 *
 * That is the point rather than a limitation. If this hook could see the
 * session, so could anything else that ran on the page, and the reason for
 * putting it in an `HttpOnly` cookie in the first place would be gone.
 *
 * SIGNED-OUT IS THE NORMAL STATE and the app has to be worth using in it. The
 * whole feature is additive: the map, the schedule and the dates never ask
 * whether anybody signed in, and they work identically when the answer is no.
 */

import { useCallback, useEffect, useState } from 'react';
import { CONFIG } from '../data/config';
import { isNative } from '../platform';

export interface Profile {
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

/**
 * Where the sign-in stands.
 *
 * `blocked` is its own state rather than a kind of failure: being stopped by
 * Gen Con's bot protection means nothing is wrong with the password, and
 * somebody told "that was rejected" goes off and resets a working one.
 */
export type AuthState =
  | { status: 'unknown' }
  | { status: 'out' }
  | { status: 'busy' }
  | { status: 'in'; profile: Profile; partial: boolean }
  | { status: 'rejected' }
  | { status: 'blocked'; says: string }
  | { status: 'broken'; says: string };

/** Every field the account page could yield, for spotting a half-read one. */
const WHOLE = ['username', 'firstName', 'lastName', 'email'];

const problem = (reason: string, says: string): AuthState => {
  if (reason === 'rejected') return { status: 'rejected' };
  if (reason === 'signed-out' || reason === 'expired') return { status: 'out' };
  if (reason === 'challenged' || reason === 'blocked') return { status: 'blocked', says };
  return { status: 'broken', says };
};

/**
 * Where the sign-in endpoints are.
 *
 * Same-origin on the web, where `functions/gencon/` serves them — a browser
 * needs that server, because gencon.com sends no CORS header, its session
 * cookie is `HttpOnly`, and it is `SameSite=Lax`: three walls, all
 * deliberate. A native shell is served from `file://` and has no origin to
 * be relative to, so it needs a host named; without one, signing in is a
 * web-app feature and the panel says so rather than offering a form that
 * cannot work.
 *
 * (A native shell has none of those three walls and could one day sign in
 * to gencon.com directly, retiring the Worker rather than needing it. That
 * is worth doing and is not done here: a half-built credential path is the
 * one thing worse than an honest "not here yet".)
 */
export function accountBase(): string | null {
  const configured = (CONFIG.accountHost ?? '').trim();
  if (configured) return configured.replace(/\/$/, '');
  return isNative() ? null : '';
}

/** Whether this copy can sign in at all. */
export const canSignIn = (): boolean => accountBase() !== null;

export function useGenConAccount() {
  const [state, setState] = useState<AuthState>({ status: 'unknown' });

  /** Ask the server who the cookie belongs to. Cheap, and the only source. */
  const refresh = useCallback(async (): Promise<AuthState> => {
    try {
      const base = accountBase();
      if (base === null) return { status: 'out' };
      const response = await fetch(`${base}/gencon/whoami`, { credentials: 'same-origin' });
      const body = await response.json();
      const next: AuthState = body.ok
        ? {
            status: 'in',
            profile: body.profile as Profile,
            // Said out loud, because a page Gen Con has half-redesigned reads
            // as an account with half its details missing.
            partial: WHOLE.some((field) => !(body.found ?? []).includes(field)),
          }
        : problem(body.reason, body.says ?? '');
      setState(next);
      return next;
    } catch {
      // Offline is not signed out — claiming it would throw away a live session
      // the moment somebody walks into a hall with no signal.
      const next: AuthState = { status: 'broken', says: 'Could not reach the app’s own server.' };
      setState(next);
      return next;
    }
  }, []);

  // Once, on load: the cookie may have outlived the tab that made it.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (username: string, password: string): Promise<AuthState> => {
      setState({ status: 'busy' });
      try {
        const base = accountBase();
        if (base === null) {
          return { status: 'broken', says: 'Signing in is not available in the app; use the website.' };
        }
        const response = await fetch(`${base}/gencon/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          // The only place the password appears, and it is gone with the call.
          body: JSON.stringify({ username, password }),
        });
        const body = await response.json();
        if (!body.ok) {
          const next = problem(body.reason, body.says ?? '');
          setState(next);
          return next;
        }
        return await refresh();
      } catch {
        const next: AuthState = { status: 'broken', says: 'Could not reach the app’s own server.' };
        setState(next);
        return next;
      }
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    // Optimistic on purpose: this is the app forgetting, and it must not be
    // possible for a bad network to keep somebody signed in.
    setState({ status: 'out' });
    try {
      const base = accountBase();
      if (base !== null) {
        await fetch(`${base}/gencon/logout`, { method: 'POST', credentials: 'same-origin' });
      }
    } catch {
      /* The cookie is what matters, and the next reload will re-ask. */
    }
  }, []);

  return { state, signIn, signOut, refresh };
}
