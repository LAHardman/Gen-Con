/**
 * The controls for narrowing 27,467 events, shared by both searches.
 *
 * ONE COMPONENT FOR BOTH, because they are the same question asked in two
 * places. The map's search and the schedule's differ in what they do with a
 * result — take you there, or put it on your Saturday — and not at all in how
 * you find it.
 *
 * FOLDED AWAY UNTIL ASKED FOR. Nine dimensions of filtering above a search box
 * would bury the search box, and most searches are still somebody typing a
 * title. The button says how many are active, so a list narrowed by filters
 * that are out of sight can never look like a list that simply found nothing.
 *
 * NOTHING HERE INVENTS A FACET. The pickers are built from the feed — see
 * `filterChoices` — so a type or an age band this year's catalogue does not use
 * is not offered, and one it adds appears without anybody editing a list.
 */

import { useId, useMemo, useState } from 'react';
import {
  activeCount,
  formatLength,
  NO_FILTER,
  SORT_LABEL,
  type EventFilter,
  type FilterChoices,
  type SortKey,
} from '../data/filters';
import { kindName } from '../data/event-kinds';
import { dayName } from '../data/plan';
import { VENUES_BY_ID } from '../data/venues';

interface Props {
  filter: EventFilter;
  sort: SortKey | undefined;
  /** Days the feed knows about, in order. */
  days: readonly string[];
  choices: FilterChoices;
  onChange: (filter: EventFilter) => void;
  onSort: (sort: SortKey | undefined) => void;
}

const SORT_KEYS: SortKey[] = ['start', 'end', 'length', 'cost'];

/** Times somebody actually plans around, rather than a clock face of options. */
const TIMES: Array<{ label: string; from?: number; to?: number }> = [
  { label: 'Any time' },
  { label: 'Morning', from: 0, to: 11 * 60 + 59 },
  { label: 'Afternoon', from: 12 * 60, to: 16 * 60 + 59 },
  { label: 'Evening', from: 17 * 60, to: 20 * 60 + 59 },
  { label: 'Late', from: 21 * 60, to: 24 * 60 },
];

export function EventFilters({ filter, sort, days, choices, onChange, onSort }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const active = activeCount(filter);

  const set = (patch: Partial<EventFilter>) => onChange({ ...filter, ...patch });

  /** Adds or removes one value from a list-shaped filter. */
  const toggleIn = (key: 'days' | 'types' | 'ages' | 'venueIds' | 'roomIds', value: string) => {
    const held = filter[key] ?? [];
    set({
      [key]: held.includes(value) ? held.filter((one) => one !== value) : [...held, value],
      // Narrowing to a building throws away a room chosen inside another one,
      // which would otherwise leave a filter that can match nothing at all.
      ...(key === 'venueIds' ? { roomIds: [] } : {}),
    });
  };

  // Only the rooms in the chosen buildings, because 120 rooms in one list is
  // not a picker — and choosing a building first is how anybody would narrow.
  const rooms = useMemo(
    () =>
      filter.venueIds?.length
        ? choices.rooms.filter((room) => filter.venueIds!.includes(room.venueId))
        : choices.rooms,
    [choices.rooms, filter.venueIds],
  );

  const chosenTime = TIMES.findIndex(
    (band) => band.from === filter.startFrom && band.to === filter.startTo,
  );

  return (
    <div className="filters">
      <div className="filters__bar">
        <button
          type="button"
          className={`filters__toggle${active ? ' filters__toggle--active' : ''}`}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((was) => !was)}
        >
          Filters
          {active > 0 && <span className="filters__count">{active}</span>}
        </button>

        <label className="filters__sort">
          <span className="filters__sort-label">Sort</span>
          <select
            value={sort ?? ''}
            onChange={(change) => onSort((change.target.value || undefined) as SortKey | undefined)}
          >
            <option value="">Best match</option>
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {SORT_LABEL[key]}
              </option>
            ))}
          </select>
        </label>

        {active > 0 && (
          <button type="button" className="filters__clear" onClick={() => onChange(NO_FILTER)}>
            Clear
          </button>
        )}
      </div>

      {open && (
        <div className="filters__panel" id={id}>
          <Group label="Day">
            {days.map((day) => (
              <Chip
                key={day}
                on={!!filter.days?.includes(day)}
                onClick={() => toggleIn('days', day)}
              >
                {dayName(day)}
              </Chip>
            ))}
          </Group>

          <Group label="Starts">
            {TIMES.map((band, index) => (
              <Chip
                key={band.label}
                on={index === 0 ? chosenTime <= 0 : index === chosenTime}
                onClick={() => set({ startFrom: band.from, startTo: band.to })}
              >
                {band.label}
              </Chip>
            ))}
          </Group>

          <Group label="Runs for">
            <label className="filters__range">
              <span>at least</span>
              <select
                value={filter.minMinutes ?? ''}
                onChange={(change) =>
                  set({ minMinutes: change.target.value ? Number(change.target.value) : undefined })
                }
              >
                <option value="">any</option>
                {choices.lengths.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatLength(minutes)}
                  </option>
                ))}
              </select>
            </label>
            <label className="filters__range">
              <span>at most</span>
              <select
                value={filter.maxMinutes ?? ''}
                onChange={(change) =>
                  set({ maxMinutes: change.target.value ? Number(change.target.value) : undefined })
                }
              >
                <option value="">any</option>
                {choices.lengths.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatLength(minutes)}
                  </option>
                ))}
              </select>
            </label>
          </Group>

          <Group label="Type">
            {choices.types.map((type) => (
              <Chip key={type} on={!!filter.types?.includes(type)} onClick={() => toggleIn('types', type)}>
                {kindName(type)}
              </Chip>
            ))}
          </Group>

          <Group label="Cost">
            <Chip
              on={filter.maxCost === 0}
              onClick={() => set({ maxCost: filter.maxCost === 0 ? undefined : 0 })}
            >
              Free only
            </Chip>
            <label className="filters__range">
              <span>up to $</span>
              <input
                type="number"
                min={0}
                step={1}
                value={filter.maxCost ?? ''}
                onChange={(change) =>
                  set({ maxCost: change.target.value === '' ? undefined : Number(change.target.value) })
                }
              />
            </label>
            <Chip on={!!filter.ticketsOnly} onClick={() => set({ ticketsOnly: !filter.ticketsOnly })}>
              Tickets left
            </Chip>
          </Group>

          {/*
            The two fields that behave like tags. Gen Con's data has no tag
            field; the age requirement is a real five-value facet and the game
            system has 1,845 values, which is a text box rather than a list.
          */}
          <Group label="Age">
            {choices.ages.map((age) => (
              <Chip key={age} on={!!filter.ages?.includes(age)} onClick={() => toggleIn('ages', age)}>
                {age}
              </Chip>
            ))}
          </Group>

          <Group label="Game system">
            <input
              type="search"
              className="filters__text"
              placeholder="Any system"
              aria-label="Game system"
              value={filter.system ?? ''}
              onChange={(change) => set({ system: change.target.value })}
            />
          </Group>

          <Group label="Building">
            {choices.venueIds.map((venueId) => (
              <Chip
                key={venueId}
                on={!!filter.venueIds?.includes(venueId)}
                onClick={() => toggleIn('venueIds', venueId)}
              >
                {VENUES_BY_ID[venueId]?.shortName ?? VENUES_BY_ID[venueId]?.name ?? venueId}
              </Chip>
            ))}
          </Group>

          <Group label="Room">
            <select
              className="filters__text"
              aria-label="Room"
              value={filter.roomIds?.[0] ?? ''}
              onChange={(change) => set({ roomIds: change.target.value ? [change.target.value] : [] })}
            >
              <option value="">Any room</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </Group>
        </div>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="filters__group">
      <legend>{label}</legend>
      <div className="filters__values">{children}</div>
    </fieldset>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`filters__chip${on ? ' filters__chip--on' : ''}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
