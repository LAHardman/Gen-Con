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

/**
 * A table's compiled constants, with any the pack carries laid over them.
 *
 * The generated tables — floor plans, booths, pavements, hotels — are big
 * literals with derivations built on top, so rather than move each one into
 * its own JSON source (eleven generators rewritten, eleven chances to break
 * a byte-stable output), the build extracts them into the pack and this
 * lays a newer copy back over them at runtime. The compiled literal stays
 * the source of truth in the repository and the snapshot in the binary; the
 * pack is a distribution artifact derived from it.
 *
 * THE REFUSAL RULE IS PER KEY, and deliberately shallow: a key the compiled
 * table does not have is ignored, and a key whose JavaScript shape differs
 * — an array where an object belongs, a string where a number does — is
 * ignored too, leaving the compiled value standing. Whole-table rejection
 * would be wrong here: these tables are independent constants that happen
 * to share a file, and one bad key is no reason to throw away the rest. A
 * deeper check is not attempted, because the honest floor is that the pack
 * comes from this project's own build and is hash-verified before it is
 * ever stored — this is the last guard, not the only one.
 */
export function fromPack<T extends Record<string, unknown>>(name: string, compiled: T): T {
  const held = packTable<Record<string, unknown>>(
    name,
    (raw): raw is Record<string, unknown> =>
      !!raw && typeof raw === 'object' && !Array.isArray(raw),
  );
  if (!held) return compiled;

  const out = { ...compiled };
  for (const key of Object.keys(compiled)) {
    const value = held[key];
    if (value === undefined || value === null) continue;
    const mine = compiled[key];
    if (Array.isArray(mine) !== Array.isArray(value)) continue;
    if (typeof mine !== typeof value) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}
