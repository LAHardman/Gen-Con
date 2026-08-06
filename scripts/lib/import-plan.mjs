/**
 * The decisions an import makes about its own cache, with no I/O in them.
 *
 * `fetch-events.mjs` takes a lock and starts work on import, so nothing in it
 * can be called from a test without a network fetch happening. These three
 * functions are the part of it worth checking, and they are pure: given what
 * the last run left behind, they say what this run may keep, where it resumes
 * from, and whether it may say it finished.
 *
 * Every one of them is a decision that fails *quietly* if it is wrong. Keeping
 * too much means a full pull that never refreshes anything; keeping too little
 * means one that can never finish; moving the watermark too early means events
 * skipped for good. None of those throws, and the run reports success either
 * way — which is why they are here rather than inline.
 */

/**
 * Which cached records this run may keep.
 *
 * Two kinds of run, and they are opposites:
 *
 * **A full pull** exists to catch the edits the source's change sets never
 * mention, so it may not trust anything it already holds. Not quite anything:
 * a record fetched *since this same pull began* is one this pull has already
 * refreshed. Keeping those is what stopped an interrupted full pull from
 * starting over every time and so never finishing — the failure that made this
 * worth writing down. A full pull with no `since` keeps nothing, which is
 * correct for one that is genuinely starting now.
 *
 * **A top-up** trusts the cache except where the source has said otherwise:
 * `invalidate` is what a change set touched, `drop` is what it deleted.
 */
export function keepFromCache(cached, { refresh = false, since = null, invalidate, drop } = {}) {
  const held = cached instanceof Map ? [...cached.keys()] : Object.keys(cached);
  const record = (code) => (cached instanceof Map ? cached.get(code) : cached[code]);

  if (refresh) {
    const keep = new Set(
      since ? held.filter((code) => (record(code)?.pulledAt ?? '') >= since) : [],
    );
    return { keep, held: held.length, kept: keep.size, stale: 0, dropped: 0 };
  }

  const invalid = invalidate ?? new Set();
  const deleted = drop ?? new Set();
  let stale = 0;
  let dropped = 0;
  const keep = new Set();
  for (const code of held) {
    if (deleted.has(code)) dropped += 1;
    else if (invalid.has(code)) stale += 1;
    else keep.add(code);
  }
  return { keep, held: held.length, kept: keep.size, stale, dropped };
}

/**
 * When the full pull now running began.
 *
 * Three cases, and the middle one is the one that took a second attempt:
 *
 *  - A marker on disk: a full pull is already in progress and this run is
 *    carrying it on.
 *  - No marker, no watermark, but records in the cache: a full pull that was
 *    interrupted *before the marker existed*. Its own records date it, and the
 *    oldest of them is the closest thing to when it began. Adopting it rather
 *    than starting fresh is what lets a pull interrupted twice still finish.
 *  - Anything else starts now. In particular a run that has a watermark has
 *    finished a pull before, so a cache with no marker is a completed one and
 *    this is a new full pull rather than a resumed one.
 */
export function resumeFrom({ marker = null, watermark = null, earliestPulledAt = null, now }) {
  if (marker) return { startedAt: marker, resumed: true };
  if (!watermark && earliestPulledAt) return { startedAt: earliestPulledAt, resumed: true };
  return { startedAt: now, resumed: false };
}

/**
 * Whether this run may say it got everything.
 *
 * Checked rather than assumed, because the watermark is what the *next* run
 * reads to decide what it still owes. Moving it early means the next run skips
 * change sets covering events this one never actually read, and those events
 * keep whatever the feed last said about them for ever.
 *
 * A `--limit` run that happens to close the last gap therefore counts, and one
 * that doesn't, doesn't — the cap is not the question, coverage is.
 *
 * Not knowing is not the same as having got everything, so a call that does not
 * say counts as incomplete. The cost of that being wrong is one extra run; the
 * cost of the other default being wrong is events skipped for good.
 */
export function pullComplete({ failed, missing } = {}) {
  if (typeof failed !== 'number' || typeof missing !== 'number') return false;
  return failed === 0 && missing === 0;
}
