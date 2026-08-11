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
 *
 * IT IS A FULL-HEIGHT DRAWER, WHICH MAKES IT A MODE. A panel hanging off the
 * header is a hint; one that runs floor to ceiling has covered the map, the
 * search box and the button that opened it, so it owes three things a dropdown
 * does not. A scrim, so the thing behind is visibly out of reach rather than
 * merely obscured. Its own close button, because the hamburger is now
 * underneath it. And a focus trap, because Tab out of a panel you cannot see
 * past leaves the keyboard somewhere the eye has no way to follow.
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
  const titleId = `${id}-title`;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);

  // Opening moves focus into the drawer, so a keyboard lands on the first page
  // rather than back at the top of the document.
  useEffect(() => {
    if (open) firstRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (key: KeyboardEvent) => {
      if (key.key === 'Escape') {
        onToggle(false);
        return;
      }
      if (key.key !== 'Tab') return;
      /*
       * The trap. Everything behind the drawer is covered, so tabbing off the
       * end of it would move the focus ring somewhere with nothing to look at
       * — and the next Enter would press a button nobody can see.
       */
      const stops = sheetRef.current?.querySelectorAll<HTMLElement>('button, [href]');
      if (!stops || stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const on = document.activeElement;
      if (key.shiftKey && (on === first || !sheetRef.current?.contains(on))) {
        key.preventDefault();
        last.focus();
      } else if (!key.shiftKey && on === last) {
        key.preventDefault();
        first.focus();
      }
    };
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
        <>
          {/* Under the drawer and over everything else: the map is still there
              and is visibly not what you are working with. Closing on it is
              the gesture people already have for a drawer. */}
          <div
            className="menu__scrim"
            aria-hidden="true"
            onPointerDown={() => onToggle(false)}
          />

          <div className="menu__sheet" ref={sheetRef}>
            <div className="menu__sheet-head">
              <span className="menu__sheet-title" id={titleId}>
                Pages
              </span>
              {/* The hamburger is underneath the drawer now, so the way out
                  has to be inside it. */}
              <button
                type="button"
                className="menu__close"
                aria-label="Close menu"
                onClick={() => onToggle(false)}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>

            <div className="menu__list" id={id} role="menu" aria-labelledby={titleId}>
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
          </div>
        </>
      )}
    </div>
  );
}
