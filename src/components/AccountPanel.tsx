/**
 * Signing in to Gen Con from an app that is not Gen Con.
 *
 * THIS FORM HAS TO ARGUE AGAINST ITSELF. Typing the password for one site into
 * a different site is the exact shape of a phishing page, and the habit of
 * doing it without looking is what phishing lives on. So this one says whose
 * server it is, what happens to the password, and what it cannot promise —
 * before the fields, not after them, and not in grey six-point type.
 *
 * It also deliberately does not look like Gen Con. No borrowed logo, no
 * borrowed colours. A sign-in panel that mimics the site it is signing in to is
 * teaching a habit worth not teaching, even when it is honest.
 *
 * WHAT IT REFUSES TO OFFER. There is no "remember me". A stored password is the
 * one thing that turns a session somebody chose into a credential this app
 * keeps, and the design is worth nothing the moment that exists. Signing in
 * again is eight seconds.
 *
 * SIGNED OUT IS A COMPLETE STATE. Nothing else in the app asks about this, so
 * the honest thing for the panel to say when it fails is "the rest still
 * works", which it does.
 */

import { canSignIn } from '../hooks/useGenConAccount';
import { useState } from 'react';

import type { AuthState } from '../hooks/useGenConAccount';

interface Props {
  state: AuthState;
  onSignIn: (username: string, password: string) => void | Promise<unknown>;
  onSignOut: () => void;
}

/** The name to greet somebody by, out of whatever the page gave up. */
function greeting(profile: { firstName?: string; username?: string; email?: string }) {
  return profile.firstName ?? profile.username ?? profile.email ?? 'your account';
}

export function AccountPanel({ state, onSignIn, onSignOut }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const busy = state.status === 'busy';

  if (state.status === 'in') {
    return (
      <section className="account" aria-label="Gen Con account">
        <h3>Signed in as {greeting(state.profile)}</h3>
        <dl className="account__facts">
          {state.profile.username && (
            <>
              <dt>Username</dt>
              <dd>{state.profile.username}</dd>
            </>
          )}
          {state.profile.email && (
            <>
              <dt>Email</dt>
              <dd>{state.profile.email}</dd>
            </>
          )}
        </dl>
        {state.partial && (
          <p className="account__warn">
            Some details were not where this app expected them on Gen Con’s page, so what is above
            may be incomplete. It is not a sign that anything is missing from your account.
          </p>
        )}
        <button type="button" className="account__out" onClick={onSignOut}>
          Sign out
        </button>
        <p className="account__note">
          Signing out makes this app forget the session. Your Gen Con session stays open on their
          side until it times out — sign out on gencon.com too if you are on a shared computer.
        </p>
      </section>
    );
  }

  // A shell with no sign-in host has no server to sign in through, and a
  // form that cannot work is worse than an absent one — it looks like the
  // password was wrong. See `accountBase`.
  if (!canSignIn()) {
    return (
      <section className="account" aria-label="Gen Con account">
        <p>
          Signing in to Gen Con needs a small server, and this app does not carry one — a browser
          cannot reach gencon.com directly, so the website does it through its own.
        </p>
        <p className="account__note">
          Everything else here works without it: the map, the schedule, the hotels and the key dates
          never ask who you are.
        </p>
      </section>
    );
  }

  return (
    <section className="account" aria-label="Gen Con account">
      <h3>Sign in to Gen Con</h3>

      {/* Before the fields. Somebody who reads only the first thing should
          still have been told the thing that matters. */}
      <div className="account__warn">
        <p>
          <strong>This is not Gen Con’s website.</strong> It is a personal trip planner, and your
          password would go to <em>this app’s</em> server, which signs in to gencon.com on your
          behalf.
        </p>
        <p>
          The password is used for that one request and is never written down — no database, no log,
          no file. What is kept is the session Gen Con hands back, in a cookie this app’s own scripts
          cannot read. Gen Con offers no way to do this without your password; if there were one,
          this panel would use it.
        </p>
        <p>
          You do not have to. The map, schedule and key dates all work signed out, and nothing else
          in the app asks.
        </p>
      </div>

      <form
        className="account__form"
        onSubmit={(submit) => {
          submit.preventDefault();
          if (!busy) void onSignIn(username, password);
        }}
      >
        <label htmlFor="gc-user">Gen Con username or email</label>
        <input
          id="gc-user"
          name="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(change) => setUsername(change.target.value)}
          disabled={busy}
        />

        <label htmlFor="gc-pass">Password</label>
        <input
          id="gc-pass"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(change) => setPassword(change.target.value)}
          disabled={busy}
        />

        <button type="submit" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {/* Each failure says what to do next, and only "rejected" is about the
          password — the others would send somebody off to reset a working one. */}
      <p className="account__status" role="status">
        {state.status === 'rejected' && 'Gen Con did not accept that username and password.'}
        {state.status === 'blocked' && `${state.says} Try again in a few minutes.`}
        {state.status === 'broken' && `${state.says} The rest of the app still works.`}
      </p>

      <p className="account__note">
        There is no “remember me” on purpose: a stored password would be a credential this app keeps,
        which is the thing the design exists to avoid.
      </p>
    </section>
  );
}
