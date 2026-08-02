import { useState } from 'react';
import { CATEGORY_STYLES, type RoomCategory } from '../data/venues';

const ORDER: RoomCategory[] = [
  'exhibit',
  'gaming',
  'ballroom',
  'meeting',
  'amenity',
  'lodging',
  'venue',
];

interface Props {
  showAmenities: boolean;
  onToggleAmenities: () => void;
}

export function Legend({ showAmenities, onToggleAmenities }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`legend${open ? ' legend--open' : ''}`}>
      <button
        type="button"
        className="legend__toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Legend
      </button>
      {open && (
        <ul className="legend__list">
          {ORDER.map((category) => {
            const style = CATEGORY_STYLES[category];
            return (
              <li key={category}>
                <span
                  className="legend__swatch"
                  style={{ background: style.fill, borderColor: style.stroke }}
                />
                {style.label}
              </li>
            );
          })}
          <li className="legend__amenities">
            <label>
              <input type="checkbox" checked={showAmenities} onChange={onToggleAmenities} />
              <span className="map__amenity map__amenity--restroom legend__wc">
                <span>WC</span>
              </span>
              Restrooms
            </label>
            {/* Said here rather than left to be inferred from an empty map. */}
            <small>
              From the convention centre’s plans, and from the pictograms on Gen Con’s plans of
              the hotels. Water fountains aren’t marked — no plan shows them.
            </small>
          </li>
        </ul>
      )}
    </div>
  );
}
