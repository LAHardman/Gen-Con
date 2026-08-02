import { VENUES_BY_ID, VENUE_LEVELS } from '../data/venues';

/**
 * Which floor of a building the map is showing.
 *
 * A flat map has one surface and a building has several, so the rooms on them
 * land on top of each other — the convention centre's 201–212 directly over
 * 101–117, the JW's three floors of meeting rooms in one stack. Drawing them
 * all at once turns every multi-storey venue into a pile. So the map draws one
 * floor at a time, and this is how you change it.
 *
 * It names the building it belongs to, because it appears when you are looking
 * at one and follows you to the next: without the name, "2nd floor" on its own
 * doesn't say whose. A building with a single floor has nothing to switch, so
 * nothing is shown for it.
 */
interface Props {
  venueId: string | null;
  level: string | null;
  onPick: (venueId: string, level: string) => void;
}

export function FloorPicker({ venueId, level, onPick }: Props) {
  const levels = venueId ? (VENUE_LEVELS[venueId] ?? []) : [];
  if (!venueId || levels.length < 2) return null;

  const venue = VENUES_BY_ID[venueId];

  return (
    <div className="floors" role="group" aria-label={`Floor of the ${venue?.name ?? 'building'}`}>
      <p className="floors__venue">{venue?.shortName ?? venue?.name}</p>
      {/* Top of the list is the top of the building, as a lift's buttons are. */}
      {[...levels].reverse().map((each) => (
        <button
          key={each}
          type="button"
          className={`floors__level${each === level ? ' floors__level--active' : ''}`}
          aria-pressed={each === level}
          onClick={() => onPick(venueId, each)}
        >
          {each}
        </button>
      ))}
    </div>
  );
}
