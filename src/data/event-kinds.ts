/**
 * What Gen Con's nineteen event-type codes are called.
 *
 * The feed stores the code alone — `BGM`, `RPG`, `ZED` — because that is all
 * that is needed to tell one from another, and 27,467 copies of "Non-Collectible
 * / Tradable Card Game" is not a string anybody should be downloading. But a
 * filter somebody has to *choose* from cannot be a list of three-letter codes:
 * `ZED` is Isle of Misfit Events and `SPA` is not a spa.
 *
 * These are not guesses. Gen Con's own API returns `event_type` as
 * `"BGM - Board Game"` — the code and the name in one field — and the importer
 * splits it. Each of these was read back off that API rather than inferred:
 * eighteen came out of a sweep of the catalogue and `FLM` needed a search of
 * its own, being 39 events out of 27,467.
 *
 * A code that appears in a feed and not here is shown as itself. That is the
 * right failure: a new category next year should read as an unfamiliar code
 * rather than vanish from the filter.
 */

export const EVENT_KINDS: Readonly<Record<string, string>> = {
  BGM: 'Board Game',
  CGM: 'Non-Collectible / Tradable Card Game',
  EGM: 'Electronic Games',
  ENT: 'Entertainment Events',
  ESC: 'Escape Rooms',
  FLM: 'Film Festival',
  HMN: 'Historical Miniatures',
  KID: 'Kids Activities',
  LRP: 'LARP',
  MHE: 'Miniature Hobby Events',
  NMN: 'Non-Historical Miniatures',
  RPG: 'Roleplaying Game',
  SEM: 'Seminar',
  SPA: 'Supplemental Activities',
  TCG: 'Tradable Card Game',
  TDA: 'True Dungeon Adventures!',
  TRD: 'Trade Day Events',
  WKS: 'Workshop',
  ZED: 'Isle of Misfit Events',
};

/** What to call a type code, falling back to the code itself. */
export function kindName(code: string | undefined): string {
  if (!code) return 'Event';
  return EVENT_KINDS[code] ?? code;
}
