/**
 * The menu, driven the way somebody uses one.
 *
 * What separates a menu from a div that appears is the four ways out of it —
 * Escape, a pointer elsewhere, choosing something, and the button saying
 * whether it is open. Each of those is a bug nobody files: the menu still opens
 * and the pages still work, it just will not go away.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppMenu, type MenuPage } from './AppMenu';

afterEach(cleanup);

const PAGES: ReadonlyArray<MenuPage<'map' | 'plan' | 'dates'>> = [
  { id: 'map', label: 'Map', detail: 'The campus' },
  { id: 'plan', label: 'Schedule', detail: 'Your four days', badge: 3 },
  { id: 'dates', label: 'Key dates', detail: 'Badges and tickets' },
];

function show(current: 'map' | 'plan' | 'dates' = 'map', open = false) {
  const onToggle = vi.fn();
  const onChoose = vi.fn();
  const view = render(
    <AppMenu pages={PAGES} current={current} open={open} onToggle={onToggle} onChoose={onChoose} />,
  );
  return { onToggle, onChoose, view };
}

const button = () => screen.getByRole('button', { name: /^Menu —/ });

describe('the button', () => {
  it('says where you are, for anybody who cannot see three lines in a box', () => {
    show('dates');
    expect(button().getAttribute('aria-label')).toBe('Menu — Key dates');
  });

  it('prints nothing inside itself, so it never changes width', () => {
    // The page name is printed beside the title instead. A label that lives in
    // the button makes the button resize as you move between pages, and drags
    // the rest of the header along with it.
    show('dates');
    expect(button().textContent).toBe('');
    // And the icon it does draw is hidden from the accessible name, or the
    // label above would have three empty spans read out after it.
    expect(button().querySelector('.menu__bars')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('says whether the menu is open', () => {
    show('map', false);
    expect(button().getAttribute('aria-expanded')).toBe('false');
    cleanup();
    show('map', true);
    expect(button().getAttribute('aria-expanded')).toBe('true');
  });

  it('asks to open when pressed, and to close when pressed again', () => {
    const shut = show('map', false);
    fireEvent.click(button());
    expect(shut.onToggle).toHaveBeenCalledWith(true);
    cleanup();
    const opened = show('map', true);
    fireEvent.click(button());
    expect(opened.onToggle).toHaveBeenCalledWith(false);
  });
});

describe('the sheet', () => {
  it('offers every page, with what each one is', () => {
    show('map', true);
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items.map((one) => one.textContent)).toEqual([
      'MapThe campus',
      'Schedule3Your four days',
      'Key datesBadges and tickets',
    ]);
  });

  it('marks where you already are rather than leaving it out', () => {
    // A menu that omits the current page makes you count what is left to work
    // out where that is.
    show('plan', true);
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    const current = items.filter((one) => one.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain('Schedule');
  });

  it('chooses and closes in one press', () => {
    const { onChoose, onToggle } = show('map', true);
    fireEvent.click(screen.getByRole('menuitem', { name: /Key dates/ }));
    expect(onChoose).toHaveBeenCalledWith('dates');
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('closes on Escape', () => {
    const { onToggle } = show('map', true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('closes when the pointer goes down anywhere else', () => {
    const { onToggle } = show('map', true);
    fireEvent.pointerDown(document.body);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('stays open when the pointer goes down inside it', () => {
    const { onToggle } = show('map', true);
    fireEvent.pointerDown(screen.getByRole('menu'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('puts the keyboard on the first page when it opens', () => {
    show('map', true);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Map/ }));
  });
});

/**
 * A panel that covers the map, the search box and the button that opened it is
 * a mode rather than a hint, and owes three things a dropdown does not.
 */
describe('being a drawer rather than a dropdown', () => {
  it('puts something over everything behind it, and closing it is that thing', () => {
    const { onToggle } = show('map', true);
    const scrim = document.querySelector('.menu__scrim')!;
    expect(scrim).toBeTruthy();
    // Hidden from a screen reader: it is the visual half of "out of reach",
    // and the Escape key is the other half.
    expect(scrim.getAttribute('aria-hidden')).toBe('true');
    fireEvent.pointerDown(scrim);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('carries its own way out, because the hamburger is underneath it', () => {
    const { onToggle } = show('map', true);
    const close = screen.getByRole('button', { name: 'Close menu' });
    fireEvent.click(close);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('keeps the keyboard inside itself', () => {
    // Tab off the end of a panel you cannot see past and the focus ring is
    // somewhere with nothing to look at — the next Enter presses a button
    // nobody can see.
    show('map', true);
    const items = screen.getAllByRole('menuitem');
    const last = items[items.length - 1];
    last.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close menu' }));

    // And backwards off the front, round to the end.
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('leaves Tab alone in the middle, where the browser is already right', () => {
    show('map', true);
    const first = screen.getByRole('menuitem', { name: /Map/ });
    first.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    // Nothing moved it: the browser will, and a trap that also does the
    // ordinary case skips whatever it did not think of.
    expect(document.activeElement).toBe(first);
  });
});
