# Code review: testing and structure

A review of where this codebase is hardest to change safely, and what to add
first. Ordered by risk × cost-to-fix, not by file.

The short version: the code is unusually well documented and the module
boundaries are mostly right. What's missing is a *verification layer* — there
is no test framework, no linter, and no CI gate beyond `tsc --noEmit`. That
matters more here than in most apps, because the two most fragile parts (an
HTML scraper pointed at somebody else's hobby site, and a fuzzy string matcher
tying 27,000 events to 74 rooms) are exactly the parts whose breakage is
silent.

---

## 1. Testing

### 1.1 There is no test framework at all

```
$ grep -rn "vitest\|jest" package.json   # nothing
```

Vite is already here, so Vitest is a two-line addition with no new config
language to learn:

```jsonc
// package.json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "check": "npm run typecheck && npm run test"
}
```

Add `"include": ["src", "scripts", "vite.config.ts"]` handling for tests, and
wire `npm run check` into CI (see §1.6).

### 1.2 Start with `scripts/lib/parse-events.mjs` — highest value by a wide margin

This module is already written the way testable code looks: every extraction
step is an exported pure function taking a string and returning data
(`parseStart`, `parseDurationMinutes`, `parseMoney`, `parseCount`,
`parseEventType`, `mapFields`, `readFieldTable`, `parseEventPage`,
`parseCataloguePage`, `parseDayIndex`, `parseChangeList`, `parseChangeSet`). It has
no tests.

It is also the module most likely to break *without anyone noticing*, because
its failure mode is not an exception — it's `null`, which
`writeFeed`/`indexEvents` quietly filter out. A source-site redesign that drops
40% of events looks identical to a good run in the logs.

Two layers worth adding:

**Unit tests over the value parsers.** These are cheap and catch real edge
cases that are currently unguarded:

| Function | Cases worth pinning |
|---|---|
| `parseStart` | all four accepted shapes; `"Saturday August 01, 2026 - 10:00 am"` reading the month from `August` not `Sat`; midnight (`12:00 am` → `00:00`); noon (`12:00 pm` → `12:00`); weekday-only with and without `context.dayDates`; unparseable input → `null` |
| `parseClock` (via `parseStart`) | `25:00` and `10:75` rejected rather than rolled over |
| `parseCount` | `"162/180"` → `162`; `"-18/180"` → `-18` (the wait-list case the comment calls out) |
| `parseDurationMinutes` | `"2h30m"`, `"90 min"`, bare `"4"` → 240 |
| `parseEventType` | `"FLM - Film Festival"` → `"FLM"`; a bare type passes through |
| `mapFields` | first-match-wins and the `claimed` set — that a single label cannot be claimed by two fields |
| `parseChangeList` | the `events.csv` timestamp; that the five sets printed twice (nav drop-down and body) are deduplicated by id; sets sorted newest first |
| `parseChangeSet` | codes attributed to the heading above them, not the page — a set with all three sections must not put deleted codes in the added bucket |

**Fixture tests over the HTML parsers.** Save one real `event.php` page, one
`categoryAll.php` page and one `dayTimeList.php` page into
`scripts/lib/__fixtures__/`, and assert the parsed output. This is the
regression test for the thing the module's own docblock says is the risk:

> Fields are mapped by matching those row labels … only renaming the labels
> themselves would [break the import].

A fixture test turns that from a hope into an assertion. It also gives
`FIELD_PATTERNS` a safety net when someone widens a pattern and accidentally
lets `/hall/` (the `room` pattern) claim a label meant for something else.

### 1.3 Then `src/data/events.ts` — the matcher and the clock

`roomIdForEvent` is the second silent-failure surface. Today its only
validation is a `console.info` in `useEventFeed` telling a developer that N
events didn't match. Nothing checks that events match the *right* room.

Worth pinning as tests, using a handful of literal `ConEvent` objects:

- The case the docblock exists for: `{locationText: 'ICC', roomText: 'Room 103'}`
  and `{locationText: 'JW', roomText: 'Room 103'}` must resolve to *different*
  rooms. This is the invariant most likely to regress when someone adds an
  alias.
- Longest-key-wins: `"Exhibit Hall J"` beats `"Hall"`.
- Token-boundary matching in `containsPhrase`: `"201"` must not match `"2010"`.
- Single-room venue fallback: an event at Lucas Oil with unrecognised room text
  still lands on the stadium.
- Genuinely unknown location → `null`, i.e. it lands in `unmatched` rather than
  on an arbitrary room.

And the time functions, which are pure and currently unverified:
`dayKey`, `eventEndMs` (the `durationMinutes ?? 60` default, and `end` winning
over duration), `isHappeningAt` at both boundaries (start inclusive, end
exclusive), `formatTime` against an offset-bearing string.

`formatTime` has one live edge case: for a `-00:30`-style offset,
`Math.sign(Number('-00'))` is `-0`, so the minutes term vanishes and the offset
is read as zero. It cannot bite at UTC-04:00, but it is the kind of thing that
should be a test rather than a thing someone has to re-derive.

### 1.4 Data-invariant tests over `src/data/venues.ts`

1,247 lines of hand-authored data with 74 rooms and 75 alias entries is where
typos live, and TypeScript checks none of the relationships. These are fast to
write and catch a whole class of "the room silently vanished from the map" bug:

- Every `room.id` and `venue.id` is unique.
- Every `room.venueId` resolves in `VENUES_BY_ID` (currently `roomBounds` would
  throw on a typo, at render time, in production).
- Every label in a `room.plan` resolves to a ring in `PLAN_SHAPES` — a typo'd
  label today just silently falls back to the schematic rectangle, which looks
  plausible and is wrong.
- No room's `rect` escapes its venue's `grid`.
- Every `room.level` appears in `PLAN_LEVELS[venueId]` where the venue has plans.
- No alias string is claimed by two rooms *within the same venue* (cross-venue
  duplicates are fine and intentional — that's the `Room 103` case).

### 1.5 `src/utils/geo.ts` — trivially testable, currently untested

`offsetLatLng`, `localRectToBounds` and `distanceMetres` are pure maths with
known answers (100 m north of a known point; a rect covering its whole
container round-trips to the anchor's corners). Two or three assertions each.

### 1.6 CI runs no checks

`.github/workflows/deploy.yml` is a deploy pipeline only. `npm run build` does
run `tsc --noEmit`, so type errors block a deploy — but nothing else does, and
there is no check on non-default branches or pull requests.

Add a `check` job that runs on `pull_request` and on `push`, before `build`:

```yaml
check:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: npm }
    - run: npm ci
    - run: npm run typecheck
    - run: npm run test
    - run: npm run lint      # see §2.7
```

and make `build` depend on it. Note the current `build` job's `if:` guard means
pull requests get *no* CI at all today.

### 1.7 The sample feed doesn't exercise the real matching path

`scripts/make-sample-events.mjs` emits `locationText: 'Meeting Room 203'` with
no `roomText`. The real importer emits `locationText: 'ICC'` +
`roomText: 'Room 203'`. Those take **different branches** of `roomIdForEvent` —
the sample data never exercises the venue-first resolution that the real data
depends on, which is the whole reason that function is shaped the way it is.

Since this file is what a fresh session and every new contributor sees first
(the session-start hook writes it automatically), it should mirror the real
feed's shape: split `locationText`/`roomText`, and include a couple of
deliberately unmatchable locations so the `unmatched` reporting path is visible
too.

---

## 2. Structure and consistency

### 2.1 Day/timezone logic is split across three places, and one of them is wrong

The convention's UTC-04:00 offset is baked in at three independent points:

- `scripts/lib/parse-events.mjs` — `CONVENTION_UTC_OFFSET = '-04:00'`
- `scripts/make-sample-events.mjs` — a separate `OFFSET = '-04:00'` plus its own
  `toConventionIso`
- `src/data/events.ts` — `dayKey`/`formatTime` re-derive the offset by parsing
  it back out of the string

The consumer side then breaks the convention. `src/components/RoomDialog.tsx:43`:

```ts
const today = new Date(nowMs).toISOString().slice(0, 10);  // UTC date
```

but `dayKey` returns the *convention-local* date. Between 8pm and midnight
Eastern, these disagree:

```
nowMs = 2026-08-01 21:30 EDT
RoomDialog today  = 2026-08-02
dayKey of event   = 2026-08-01
```

So for the last four hours of every convention day — prime evening-programming
hours — opening a room defaults to the *wrong* day tab. The fix is one line
(`dayKey(new Date(nowMs).toISOString())` is still wrong; it needs a
`conventionDayKey(nowMs)` helper), but the real fix is structural: put the
offset in one exported constant and give `events.ts` a `todayKey(atMs)`
alongside `dayKey(iso)`, so no caller ever reaches for `toISOString().slice()`
again.

### 2.2 `scheduleForDay` is dead, and `RoomDialog` reimplements half of it

`src/data/events.ts:224` exports `scheduleForDay(events, day, atMs)` returning
`{now, upcoming, earlier}`. Nothing imports it. `RoomDialog` instead filters
`dayEvents` itself and computes `live`/`done` inline per row
(`RoomDialog.tsx:61-69, 150-151`).

Either use `scheduleForDay` in the dialog or delete it. Right now there are two
definitions of "is this event past", and only one of them is exported, named,
and documented — while the other is the one that actually renders.

### 2.3 Dead code to remove

| Location | Status |
|---|---|
| `src/utils/text.ts` (whole file, 69 lines) | `fittingFontPx` imported nowhere |
| `src/utils/geo.ts` — `distanceMetres`, `walkingMinutes` | unused |
| `src/data/events.ts` — `scheduleForDay`, `RoomSchedule` | unused (§2.2) |
| `EventIndex.days` | computed on every load, read nowhere |
| `EventFeedState.error` | returned by the hook, never consumed — the UI only shows a generic "failed to load" |
| `src/components/MapView.tsx:350` — `export { ROOMS_BY_ID }` | pass-through re-export; `App.tsx` imports it from `data/venues` |

`noUnusedLocals` is on, which is why none of this is flagged — these are unused
*exports*, which TypeScript can't see. A `knip`/`ts-prune` step, or just ESLint
with `import/no-unused-modules`, closes that gap.

`text.ts` is the interesting one: it's a well-built solution to a label-fitting
problem the map no longer solves that way (labels are Leaflet tooltips now,
sized by CSS). Either delete it or wire it in — leaving it means the next
person changing label rendering has to work out which of the two systems is
live.

### 2.4 The feed's JSON contract is declared in TypeScript but produced by untyped JS

`ConEvent`/`EventFeed` live in `src/data/events.ts`. `tsconfig.json` includes
only `["src", "vite.config.ts"]`, so nothing in `scripts/` is typechecked —
and `scripts/` is what *writes* that JSON. Three consequences already visible:

- `ConEvent.start` is `string`, but `parseEventPage` can emit `start: null`
  (`parse-events.mjs:299`). `writeFeed` filters those out, so the invariant
  holds by accident of a filter in a different file.
- `make-sample-events.mjs` writes `sample: true` on the feed. `EventFeed` has
  no such field, so the app cannot tell fake data from real and the header
  cheerfully reports "336 events" for the sample set.
- Nothing verifies that a hand-edited or stale `public/events.json` matches the
  shape at all beyond `Array.isArray(feed?.events)`.

Two options, in increasing order of effort:

1. Move the feed types into a shared `src/data/feed-types.ts`, add
   `// @ts-check` + a JSDoc `@typedef` import in the scripts, and add
   `"checkJs": true` for `scripts/**` via a second tsconfig. Cheap, catches
   the `null` drift.
2. Define the feed shape once as a small runtime validator (hand-rolled or
   Zod-style) used by both `writeFeed` and `useEventFeed`. Then a malformed
   feed fails loudly at import time rather than producing an app with mystery
   gaps.

Either way, add `sample?: boolean` to `EventFeed` and surface it — a map
showing invented programming should say so.

### 2.5 `MapView` is four imperative effects sharing implicit state

`MapView.tsx` holds five refs and five `useEffect`s that co-ordinate through
them. Specific fragilities:

- Three effects (`[basemapId]`, `[selectedRoomId]`, `[]`) all begin
  `const map = mapRef.current; if (!map) return;` and depend on the
  *map-creation* effect having run first in the same commit. If map creation
  ever early-returns (`!containerRef.current`), the room-layer effect — deps
  `[]` — silently never runs again, and the map renders with zero rooms and no
  error.
- Three `eslint-disable-next-line react-hooks/exhaustive-deps` suppressions
  (lines 308, 318, 328) each hide a real omitted dependency. `hiddenByFloor` is
  redefined on every render and captured by two of them.
- The label effect unbinds and rebinds a tooltip for all 74 rooms on every
  `zoomend` and every selection change.

This doesn't need a rewrite, but it would be much easier to change if the
Leaflet lifecycle were pulled out of the component:

- `useLeafletMap(containerRef, options)` → returns the map (or `null`), owning
  creation/teardown and the custom pane.
- `useRoomLayers(map, {onSelect, onOpen})` → owns the `Map<string, L.Path>`
  and its cleanup.
- `useLayerEffect(map, deps, fn)` — a tiny wrapper that no-ops until the map
  exists and *re-runs when it appears*, which is the bug the current `[]` deps
  can't express.

That last one alone removes the ordering dependency and most of the reason for
the eslint suppressions.

### 2.6 `venues.ts` mixes 1,150 lines of data with the logic that derives from it

The file holds `CATEGORY_STYLES`, the `Room`/`Venue` types, `VENUES`, `ROOMS`,
and then `roomShapes`/`planDetail`/`roomBounds`/`venueOutline`/`venueBounds`
plus the module-level `ROOM_SHAPES` and `CLAIMED` indexes. Adding a room means
scrolling past derivation code; changing `roomBounds` means scrolling past a
thousand lines of data.

A low-risk split that changes no behaviour:

```
src/data/venues.ts        → types + CATEGORY_STYLES + VENUES + ROOMS (data only)
src/data/venue-geometry.ts → ROOM_SHAPES, CLAIMED, roomShapes, planDetail,
                             roomBounds, venueOutline, venueBounds
```

Then the invariant tests in §1.4 have an obvious home, and the data file
becomes something a non-programmer could edit.

Related consistency point: `CATEGORY_STYLES` lives in `venues.ts` but is a
*presentation* concern, imported by `Legend` and `RoomDialog` as well as
`MapView`. `Legend.tsx` then keeps its own hand-maintained `ORDER` array of
categories — a second list that must stay in sync with the first. Give
`CategoryStyle` an `order` field, or move both into `src/data/categories.ts`
and derive the legend order from it.

### 2.7 ESLint is referenced but not installed

Three `eslint-disable-next-line` comments, no `eslint` dependency, no config
file. The comments are documentation of an intent nothing enforces — and they
would go stale silently.

Either install it (`eslint`, `@eslint/js`, `typescript-eslint`,
`eslint-plugin-react-hooks`) and add `"lint": "eslint ."`, or strip the
comments. Installing it is the better call given §2.5: `react-hooks` is exactly
the rule set this codebase's main risk area needs, and it would also have
flagged the `hiddenByFloor` capture.

### 2.8 Smaller consistency items

- **`scripts/` has two languages.** `.mjs` for the event pipeline, `.py` for
  the PDF/plan pipeline (`pdf-to-svg.py`, `plan-labels.py`), with no
  `requirements.txt` or documented interpreter version. Nothing pins how to run
  the Python half; a note in `README.md` §"Real floor plans" or a
  `scripts/requirements.txt` would close it.
- **`plan-to-geometry.mjs` emits TypeScript type declarations as a template
  string** (lines ~503-530), so `PlanRing`/`PlanDetail` are defined inside a
  generator's string literal and nowhere else. Changing those types means
  editing a JS string. Move the type declarations into a hand-written
  `src/data/plan-types.ts` that the generated file imports, and keep only the
  data in the generated output.
- **`useEventFeed` reports unmatched locations via `console.info`.** That's the
  right instinct, but it's invisible in production and untestable. The data is
  already on the returned `index.unmatched` — consider surfacing a count in the
  UI (a dev-only badge) so the signal reaches whoever can act on it.
- **`App.tsx:81-87` nests a three-deep ternary** to pick the header subtitle.
  A small `headerSubtitle(status, index, liveCount)` helper would be both
  readable and directly testable.

---

## Suggested order of work

1. Add Vitest + a CI `check` job (§1.1, §1.6) — nothing else is verifiable until
   this exists.
2. Fix the day-tab timezone bug and centralise the offset (§2.1), with the
   test that proves it.
3. Fixture + unit tests for `parse-events.mjs` (§1.2) — highest silent-breakage
   risk.
4. Matcher and clock tests for `events.ts` (§1.3); venue invariant tests (§1.4).
5. Delete dead code (§2.3); resolve `scheduleForDay` (§2.2).
6. Install ESLint and clear the three suppressions properly (§2.7, §2.5).
7. Split `venues.ts` (§2.6) and extract the Leaflet hooks (§2.5).
8. Share the feed contract with `scripts/` (§2.4); fix the sample feed's shape
   (§1.7).

Steps 1-5 are each an hour or less and cover most of the risk. 6-8 are
refactors worth doing before the next feature lands in `MapView` or `venues.ts`.
