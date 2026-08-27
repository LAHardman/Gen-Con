/**
 * Reading the data pack: the manifest, the schema gate, and the rule for a
 * copy that can never fetch again.
 *
 * `scripts/build-pack.mjs` is the writing half — it assembles `public/pack/`
 * from the same JSON files the bundle compiles in as its snapshot. This is
 * the reading half, used by any copy of the app checking whether the pack
 * on its origin (or, one day, on the native shells' pack host) carries
 * newer tables than the ones it holds.
 *
 * THE RULE UNDERNEATH EVERYTHING: the snapshot is the floor, never taken
 * away. A manifest that cannot be read, a schema from a future this copy
 * does not understand, a table whose bytes do not match their hash — every
 * one of those answers "keep what you have", because a copy of this app
 * that is never updated again must keep working indefinitely, and the worst
 * trade available is a working snapshot exchanged for a half-understood
 * download. Refusing to read is cheap; misreading is a broken app with no
 * way back.
 */

/** The schema this build understands. Must match `scripts/build-pack.mjs`. */
export const PACK_SCHEMA = 1;

export interface PackTable {
  /** First 16 hex characters of the table's SHA-256. */
  hash: string;
  bytes: number;
}

export interface PackManifest {
  schema: number;
  generatedAt?: string;
  tables: Record<string, PackTable>;
}

/**
 * A manifest out of untrusted bytes, or null.
 *
 * Null rather than a throw, and null rather than a best effort: the caller's
 * next move on any failure is the same — keep the snapshot — so one answer
 * covers a 404 page served as JSON, a truncated download, and a manifest
 * from a schema this build predates. Unknown fields are ignored, which is
 * what lets additive growth never strand an old reader.
 */
export function readManifest(raw: unknown): PackManifest | null {
  const manifest = raw as Partial<PackManifest> | null;
  if (!manifest || typeof manifest !== 'object') return null;
  if (typeof manifest.schema !== 'number') return null;
  // A future schema is a manifest written for readers that do not exist yet
  // in this copy's world. Refusing it wholesale is the contract that makes
  // bumping the schema safe for the copies that can never update.
  if (manifest.schema !== PACK_SCHEMA) return null;
  if (!manifest.tables || typeof manifest.tables !== 'object') return null;
  const tables: Record<string, PackTable> = {};
  for (const [name, table] of Object.entries(manifest.tables)) {
    const entry = table as Partial<PackTable> | null;
    if (!entry || typeof entry.hash !== 'string' || !/^[0-9a-f]{16}$/.test(entry.hash)) return null;
    if (typeof entry.bytes !== 'number' || entry.bytes <= 0) return null;
    tables[name] = { hash: entry.hash, bytes: entry.bytes };
  }
  return { schema: manifest.schema, generatedAt: manifest.generatedAt, tables };
}

/**
 * Which tables are worth fetching: named by the remote manifest, absent or
 * different in what this copy holds. Tables this build has never heard of
 * come back too — a newer pack may carry a table this code reads once it
 * exists — and the caller simply ignores names it has no reader for.
 */
export function staleTables(
  held: Record<string, PackTable>,
  remote: PackManifest,
): string[] {
  return Object.entries(remote.tables)
    .filter(([name, table]) => held[name]?.hash !== table.hash)
    .map(([name]) => name);
}
