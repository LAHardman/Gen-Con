/**
 * Finding a room, or an event, from what somebody types.
 *
 * Two things are searchable and they behave differently. A room is a place,
 * and its useful names are the ones printed on it and the ones the schedule
 * calls it — "Hall B", "White River", "104" — so its aliases are searched
 * alongside its name. An event is a thing happening in a place, so a hit on
 * one is really a hit on the room it is in, and the same title runs many times
 * in the same room: those collapse to one result with a session count rather
 * than filling the list with repeats of "Learn to Play".
 *
 * Scoring is deliberately explainable rather than clever. Everything is ranked
 * by how a match was made, best first, and ties break on the shorter name —
 * typing "hall b" should put Exhibit Hall B above Exhibit Hall B's events, and
 * "104" should offer both buildings that have a room 104 rather than guessing.
 */

import { ROOMS, VENUES_BY_ID, type Room } from './venues';
import type { ConEvent, EventIndex } from './events';

export interface SearchHit {
  /** Stable across renders, for list keys and keyboard selection. */
  key: string;
  kind: 'room' | 'event';
  room: Room;
  /** The soonest session, when this hit came from an event. */
  event?: ConEvent;
  /** How many sessions share this title in this room. */
  sessions?: number;
  score: number;
}

/** Lower is better. Ordered by how directly the text was matched. */
const SCORE = {
  roomNameStart: 0,
  aliasExact: 1,
  roomNameWord: 2,
  roomNameAnywhere: 3,
  venueStart: 4,
  eventTitleStart: 5,
  eventTitleAnywhere: 6,
};

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** True when `needle` starts a word in `haystack`, not just any position. */
function startsWord(haystack: string, needle: string) {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    if (at === 0 || !/[a-z0-9]/.test(haystack[at - 1])) return true;
    from = at + 1;
  }
}

interface RoomKeys {
  room: Room;
  name: string;
  aliases: string[];
  venue: string;
}

/** Built once: every string that should find a given room. */
const ROOM_KEYS: RoomKeys[] = ROOMS.map((room) => ({
  room,
  name: normalise(room.name),
  aliases: [room.shortName, ...(room.aliases ?? [])].filter(Boolean).map((a) => normalise(a!)),
  venue: normalise(VENUES_BY_ID[room.venueId]?.name ?? ''),
}));

function scoreRoom(keys: RoomKeys, query: string): number | null {
  if (keys.name.startsWith(query)) return SCORE.roomNameStart;
  if (keys.aliases.some((alias) => alias === query)) return SCORE.aliasExact;
  if (keys.aliases.some((alias) => alias.startsWith(query))) return SCORE.roomNameStart;
  if (startsWord(keys.name, query)) return SCORE.roomNameWord;
  if (keys.aliases.some((alias) => startsWord(alias, query))) return SCORE.roomNameWord;
  if (keys.name.includes(query)) return SCORE.roomNameAnywhere;
  if (keys.venue.startsWith(query) || startsWord(keys.venue, query)) return SCORE.venueStart;
  return null;
}

/**
 * The events worth searching, prepared once per feed rather than per keystroke.
 *
 * Only events that resolved to a room are here: an event the map can't place
 * has nowhere to take you, so offering it would be a dead end.
 */
export interface EventSearchIndex {
  entries: Array<{ room: Room; event: ConEvent; title: string }>;
}

export function buildEventSearchIndex(index: EventIndex | null): EventSearchIndex {
  const entries: EventSearchIndex['entries'] = [];
  if (!index) return { entries };
  for (const [roomId, events] of index.byRoom) {
    const room = ROOMS.find((candidate) => candidate.id === roomId);
    if (!room) continue;
    for (const event of events) entries.push({ room, event, title: normalise(event.title) });
  }
  return { entries };
}

export function search(
  rawQuery: string,
  events: EventSearchIndex,
  limit = 8,
): SearchHit[] {
  const query = normalise(rawQuery);
  if (query.length < 2) return [];

  const hits: SearchHit[] = [];

  for (const keys of ROOM_KEYS) {
    const score = scoreRoom(keys, query);
    if (score !== null) hits.push({ key: `room:${keys.room.id}`, kind: 'room', room: keys.room, score });
  }

  // One hit per title per room, keeping the soonest session and counting the rest.
  const grouped = new Map<string, SearchHit>();
  for (const { room, event, title } of events.entries) {
    const score = title.startsWith(query)
      ? SCORE.eventTitleStart
      : startsWord(title, query)
        ? SCORE.eventTitleStart + 0.5
        : title.includes(query)
          ? SCORE.eventTitleAnywhere
          : null;
    if (score === null) continue;

    const key = `event:${room.id}:${title}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.sessions = (existing.sessions ?? 1) + 1;
      if (Date.parse(event.start) < Date.parse(existing.event!.start)) existing.event = event;
    } else {
      grouped.set(key, { key, kind: 'event', room, event, sessions: 1, score });
    }
  }
  hits.push(...grouped.values());

  hits.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const aText = a.kind === 'room' ? a.room.name : (a.event?.title ?? '');
    const bText = b.kind === 'room' ? b.room.name : (b.event?.title ?? '');
    return aText.length - bText.length || aText.localeCompare(bText);
  });

  return hits.slice(0, limit);
}
