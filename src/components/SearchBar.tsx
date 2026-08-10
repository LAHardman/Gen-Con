import { useEffect, useMemo, useRef, useState } from 'react';
import { hitLabel, hitSpot, search, type EventSearchIndex, type SearchHit } from '../data/search';
import { formatTimeRange } from '../data/events';
import { formatRough, roughMinutes, type Spot } from '../data/nearby';

interface Props {
  /**
   * Prepared once per feed by the app, and shared with the directions panel:
   * searching 27,000 titles per keystroke is fine, lowercasing them per
   * keystroke is not, and doing it twice over is worse still.
   */
  events: EventSearchIndex;
  /**
   * Where to measure from, when anything says. Null while nothing does, and the
   * results carry no time rather than a time from nowhere.
   */
  from?: Spot | null;
  /** Take the map to this room and open it. */
  onPick: (hit: SearchHit) => void;
}

const RESULT_LIMIT = 8;

export function SearchBar({ events, from, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const hits = useMemo(() => search(query, events, RESULT_LIMIT), [query, events]);

  // How far each one is, read out of the table rather than routed: eight real
  // routes would be a second of work per keystroke. See `nearby.ts`.
  const away = useMemo(
    () => (from ? hits.map((hit) => roughMinutes(from, hitSpot(hit))) : hits.map(() => null)),
    [hits, from],
  );

  useEffect(() => setActive(0), [query]);

  // Clicking the map, or anywhere else, puts the list away.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const choose = (hit: SearchHit) => {
    onPick(hit);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!hits.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % hits.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current - 1 + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(hits[active]);
    }
  };

  const showList = open && query.trim().length >= 2;

  return (
    <div className="search" ref={boxRef}>
      <input
        ref={inputRef}
        type="search"
        className="search__input"
        placeholder="Search rooms and events"
        aria-label="Search rooms and events"
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls="search-results"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {showList && (
        <ul className="search__results" id="search-results" role="listbox">
          {hits.length === 0 && <li className="search__empty">Nothing matches “{query.trim()}”</li>}
          {hits.map((hit, position) => {
            const { title, detail } = hitLabel(hit);
            // How many times it runs, or when the next one is: only an event
            // has either, and for one it is the difference between "there is a
            // thing called that" and "you can still get to it".
            const when =
              hit.sessions && hit.sessions > 1
                ? ` · ${hit.sessions} sessions`
                : hit.event
                  ? ` · ${formatTimeRange(hit.event)}`
                  : '';
            return (
              <li key={hit.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={position === active}
                  className={`search__hit${position === active ? ' search__hit--active' : ''}`}
                  onMouseEnter={() => setActive(position)}
                  // Pointer-down elsewhere closes the list, so commit on it here.
                  onPointerDown={(event) => {
                    event.preventDefault();
                    choose(hit);
                  }}
                >
                  <span className="search__hit-main">{title}</span>
                  <span className="search__hit-sub">{`${detail}${when}`}</span>
                  {away[position] !== null && (
                    <span className="search__hit-away">{formatRough(away[position]!)}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
