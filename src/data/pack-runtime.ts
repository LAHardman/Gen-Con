/**
 * The synchronous half of the pack: what the data modules read at load.
 *
 * The data modules (`exhibitors.ts`, `partners.ts`) initialise from a table
 * at import time, synchronously — so anything newer than their compiled
 * snapshot has to be *already in hand* when they load. `main.tsx` arranges
 * that: it reads the stored pack, stashes it here, and only then imports
 * the app. Everything async lives in `pack-store.ts`; this file is the
 * handover point between the two, and deliberately knows nothing about
 * where the tables came from.
 *
 * Each module hands its own type guard to `packTable`, and a stashed table
 * the guard refuses answers null — back to the snapshot. That is the last
 * of the pack's three gates (schema, hash, shape), and the one that knows
 * what the words mean: bytes that arrived intact and parse as JSON can
 * still be the wrong shape, and a copy that can never update again must
 * fall back rather than half-read them.
 */

interface Stash {
  __genconPack?: Record<string, unknown>;
}

/** Called by the boot sequence, before the data modules load. */
export function stashPack(tables: Record<string, unknown>): void {
  (globalThis as Stash).__genconPack = tables;
}

/** The stashed table of this name, if one is held and the guard accepts it. */
export function packTable<T>(name: string, valid: (raw: unknown) => raw is T): T | null {
  const held = (globalThis as Stash).__genconPack?.[name];
  return held !== undefined && valid(held) ? held : null;
}
