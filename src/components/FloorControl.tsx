import { VENUE_LEVELS, VENUES_BY_ID } from '../data/venues';

interface Props {
  /** The building the switcher is currently driving. */
  venueId: string;
  /** The floor that building is showing. */
  level: string;
  onChooseLevel: (venueId: string, level: string) => void;
}

/**
 * The floor switcher for one building.
 *
 * Buildings genuinely stack — the convention centre's rooms 201-212 sit
 * directly over 101-117 — so the map draws one floor of each at a time and this
 * picks which. It drives whichever building you last touched, because the
 * levels are the building's own ('Level 2', '3rd floor', 'Club level') and
 * there is no shared numbering to step through them all at once.
 *
 * Drawn bottom-up like the panel in a lift: ground floor at the bottom, so the
 * order on screen is the order in the building. A venue with one floor has
 * nothing to switch, and renders nothing.
 */
export function FloorControl({ venueId, level, onChooseLevel }: Props) {
  const venue = VENUES_BY_ID[venueId];
  const levels = VENUE_LEVELS[venueId] ?? [];
  if (!venue || levels.length < 2) return null;

  return (
    <div className="floors">
      <p className="floors__venue">{venue.shortName ?? venue.name}</p>
      <div className="floors__stack" role="group" aria-label={`Floor, ${venue.name}`}>
        {[...levels].reverse().map((value) => (
          <button
            key={value}
            type="button"
            className={`floors__level${value === level ? ' floors__level--active' : ''}`}
            aria-pressed={value === level}
            onClick={() => onChooseLevel(venueId, value)}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}
