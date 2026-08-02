import { useEffect, useMemo, useRef, useState } from 'react';
import { buildEventSearchIndex, search, type SearchHit } from '../data/search';
import { VENUES_BY_ID, type Room } from '../data/venues';
import { formatTimeRange, type EventIndex } from '../data/events';

interface Props {
  index: EventIndex | null;
  /** Take the map to this room and open it. */
  onPick: (room: Room) => void;
}

const RESULT_LIMIT = 8;

export function SearchBar({ index, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Prepared once per feed: searching 27,000 titles per keystroke is fine,
  // lowercasing them per keystroke is not.
  const eventIndex = useMemo(() => buildEventSearchIndex(index), [index]);
  const hits = useMemo(() => search(query, eventIndex, RESULT_LIMIT), [query, eventIndex]);

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
    onPick(hit.room);
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
            const venue = VENUES_BY_ID[hit.room.venueId];
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
                  <span className="search__hit-main">
                    {hit.kind === 'room' ? hit.room.name : hit.event?.title}
                  </span>
                  <span className="search__hit-sub">
                    {hit.kind === 'room'
                      ? `${venue?.shortName ?? venue?.name ?? ''} · ${hit.room.level}`
                      : `${hit.room.shortName ?? hit.room.name} · ${venue?.shortName ?? venue?.name ?? ''}${
                          hit.sessions && hit.sessions > 1
                            ? ` · ${hit.sessions} sessions`
                            : hit.event
                              ? ` · ${formatTimeRange(hit.event)}`
                              : ''
                        }`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
