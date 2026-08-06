/**
 * Types for `pavements.mjs`, which is plain JavaScript like every script here.
 *
 * Hand-written rather than generated: it is one predicate, and `allowJs` over
 * `scripts/` would pull every other script into the app's type-check for no
 * benefit.
 */
export declare const WALKABLE: RegExp;
export declare function onTheGround(tags?: Record<string, string>): boolean;
