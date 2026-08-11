/**
 * The sign-in panel, judged on what it admits rather than on what it does.
 *
 * Signing in works or it does not, and the Function's tests cover that. What
 * only exists here is whether somebody standing in front of this form has been
 * told the truth before they type: that this is not Gen Con, that the password
 * goes to a third party, and that they can walk away and still have an app.
 *
 * Those sentences are the feature. A panel that quietly collects a password for
 * another site — however honestly the server then behaves — is teaching the
 * habit that phishing runs on, so the warnings are asserted like behaviour,
 * because that is what they are.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountPanel } from './AccountPanel';
import type { AuthState } from '../hooks/useGenConAccount';

afterEach(cleanup);

const show = (state: AuthState) => {
  const onSignIn = vi.fn();
  const onSignOut = vi.fn();
  render(<AccountPanel state={state} onSignIn={onSignIn} onSignOut={onSignOut} />);
  return { onSignIn, onSignOut };
};

const panel = () => screen.getByRole('region', { name: 'Gen Con account' });

describe('what it says before anybody types', () => {
  it('says it is not Gen Con', () => {
    show({ status: 'out' });
    expect(screen.getByText(/This is not Gen Con’s website/i)).toBeTruthy();
  });

  it('says where the password goes and what happens to it', () => {
    show({ status: 'out' });
    const text = panel().textContent ?? '';
    expect(text).toMatch(/your password would go to/i);
    expect(text).toMatch(/never written down/i);
    expect(text).toMatch(/no database, no log/i);
  });

  it('says the app works without signing in at all', () => {
    // The sentence that makes this a choice rather than a gate.
    show({ status: 'out' });
    expect(panel().textContent).toMatch(/You do not have to/i);
    expect(panel().textContent).toMatch(/all work signed out/i);
  });

  it('puts the warning above the fields, not below them', () => {
    // Read-only-the-first-thing is how forms are used. A disclosure under the
    // submit button is one nobody has read at the moment it mattered.
    show({ status: 'out' });
    const warning = panel().querySelector('.account__warn')!;
    const form = panel().querySelector('.account__form')!;
    expect(warning.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers no way to remember the password', () => {
    // The one thing that would turn a session somebody chose into a credential
    // this app keeps.
    show({ status: 'out' });
    expect(screen.queryByLabelText(/remember/i)).toBeNull();
    expect(panel().querySelector('input[type="checkbox"]')).toBeNull();
    expect(panel().textContent).toMatch(/no “remember me” on purpose/i);
  });
});

describe('the form itself', () => {
  it('hands both fields over and does not show the password', () => {
    const { onSignIn } = show({ status: 'out' });
    fireEvent.change(screen.getByLabelText(/username or email/i), {
      target: { value: 'dicegoblin' },
    });
    const password = screen.getByLabelText(/^password$/i);
    expect(password.getAttribute('type')).toBe('password');
    fireEvent.change(password, { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledWith('dicegoblin', 'hunter2');
  });

  it('cannot be submitted empty, or twice while it is working', () => {
    show({ status: 'out' });
    expect(screen.getByRole('button', { name: 'Sign in' }).hasAttribute('disabled')).toBe(true);
    cleanup();
    show({ status: 'busy' });
    expect(screen.getByRole('button', { name: /Signing in/ }).hasAttribute('disabled')).toBe(true);
  });
});

describe('telling somebody what went wrong', () => {
  it('blames the password only when the password was the problem', () => {
    // A block reported as a rejection sends somebody off to reset a working
    // password, and they never find out why it did not help.
    show({ status: 'rejected' });
    expect(screen.getByRole('status').textContent).toMatch(/did not accept that username/i);
  });

  it('says a block is not about the password', () => {
    show({ status: 'blocked', says: 'Gen Con’s bot protection blocked the sign-in.' });
    const said = screen.getByRole('status').textContent ?? '';
    expect(said).toMatch(/bot protection/i);
    expect(said).not.toMatch(/did not accept/i);
  });

  it('says the rest of the app still works when its own server is unreachable', () => {
    show({ status: 'broken', says: 'Could not reach the app’s own server.' });
    expect(screen.getByRole('status').textContent).toMatch(/rest of the app still works/i);
  });
});

describe('once signed in', () => {
  const IN: AuthState = {
    status: 'in',
    profile: { firstName: 'Sam', username: 'dicegoblin', email: 'sam@example.com' },
    partial: false,
  };

  it('greets by name and shows what it read', () => {
    show(IN);
    expect(screen.getByRole('heading', { name: /Signed in as Sam/ })).toBeTruthy();
    expect(screen.getByText('dicegoblin')).toBeTruthy();
    expect(screen.getByText('sam@example.com')).toBeTruthy();
  });

  it('says a half-read page is half-read, not a half-empty account', () => {
    show({ ...IN, partial: true });
    expect(screen.getByText(/may be incomplete/i)).toBeTruthy();
    expect(screen.getByText(/not a sign that anything is missing/i)).toBeTruthy();
  });

  it('does not claim to have signed you out of Gen Con', () => {
    // It clears this app's cookie. Gen Con's own session outlives it, and
    // saying otherwise is the sort of half-truth people act on.
    const { onSignOut } = show(IN);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
    expect(panel().textContent).toMatch(/stays open on their side/i);
  });

  it('shows no password field once there is a session', () => {
    show(IN);
    expect(screen.queryByLabelText(/^password$/i)).toBeNull();
  });
});
