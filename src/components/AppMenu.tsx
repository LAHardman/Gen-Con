/**
 * One button that opens the way to everywhere else.
 *
 * WHY THIS REPLACED THE TABS. Two tabs fit in a header. Three start to crowd
 * the search box, and the header is already carrying a title, a count, a basemap
 * switch and whatever room is selected — on a 430-pixel phone that is the whole
 * width. A tab strip is also a promise that the list is short and will stay
 * short, which stops being true the moment a page is added.
 *
 * IT IS A MENU AND BEHAVES LIKE ONE. Escape closes it, a pointer anywhere else
 * closes it, choosing closes it, and the button says whether it is open — the
 * four things that make the difference between a menu and a div that appears.
 * The current page is marked rather than hidden, because a menu that omits
 * where you already are makes you count the remaining items to work out where
 * you are.
 *
 * THE BUTTON IS THE ICON AND NOTHING ELSE. Where you are is a fact about the
 * app, not about the menu, so it is printed beside the title where it stays put
 * — a name that lives inside the control changes width as you move between
 * pages and drags the rest of the header with it. The button still *says* the
 * page in its accessible name, because three lines drawn in a box announce
 * nothing, and a screen reader should not have to go looking for the label.
 */

import { useEffect, useId, useRef } from 'react';

export interface MenuPage<T extends string> {
  id: T;
  label: string;
  /** What the page is, in a few words, under its name in the menu. */
  detail: string;
  /** A count worth seeing from the outside — the schedule's, today. */
  badge?: number;
}

interface Props<T extends string> {
  pages: ReadonlyArray<MenuPage<T>>;
  current: T;
  open: boolean;
  onToggle: (open: boolean) => void;
  onChoose: (page: T) => void;
}

export function AppMenu<T extends string>({ pages, current, open, onToggle, onChoose }: Props<T>) {
  const id = useId();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);

  // Opening moves focus into the menu, so a keyboard lands on the first page
  // rather than back at the top of the document.
  useEffect(() => {
    if (open) firstRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (key: KeyboardEvent) => key.key === 'Escape' && onToggle(false);
    const onPointerDown = (pointer: PointerEvent) => {
      if (!boxRef.current?.contains(pointer.target as Node)) onToggle(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, onToggle]);

  const here = pages.find((page) => page.id === current);

  return (
    <div className="menu" ref={boxRef}>
      <button
        type="button"
        className={`menu__button${open ? ' menu__button--open' : ''}`}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="menu"
        // The page's name is in the accessible name even though it is no
        // longer printed inside the button: three lines drawn in a box say
        // nothing to a screen reader.
        aria-label={`Menu — ${here?.label ?? 'Pages'}`}
        onClick={() => onToggle(!open)}
      >
        <span className="menu__bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      {open && (
        <div className="menu__sheet" id={id} role="menu" aria-label="Pages">
          {pages.map((page, index) => (
            <button
              key={page.id}
              ref={index === 0 ? firstRef : undefined}
              type="button"
              role="menuitem"
              aria-current={page.id === current ? 'page' : undefined}
              className={`menu__item${page.id === current ? ' menu__item--current' : ''}`}
              onClick={() => {
                onChoose(page.id);
                onToggle(false);
              }}
            >
              <span className="menu__item-name">
                {page.label}
                {page.badge ? <span className="menu__item-count">{page.badge}</span> : null}
              </span>
              <span className="menu__item-detail">{page.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
