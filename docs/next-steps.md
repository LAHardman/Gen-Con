# Next steps: the gaps directions still has

Written after the walking router landed, from measurements rather than
impressions. Every number here came from running the code over the real data;
the script fragments that produced them are in each section so they can be
re-run rather than believed.

Ordered by how much of the app is wrong without them, not by how interesting
they are to build.

---

## 1. Outdoors has no network at all — the largest gap by far

**Measured.** Over every pair of buildings, routing one room to another:

| | Pairs, before doors | after |
|---|---|---|
| Routed entirely under cover | 12 | 12 |
| Need an outdoor straight line | 152 | **170** |
| Get no route at all | **18** | **0** |
| Total | 182 | 182 |

So roughly 7% of building-to-building journeys get the thing the router was
built to give. The rest are answered, but with a straight line between two
doors, because the only outdoor connections in the repository are the eleven
skywalks and the tunnel, and those join the convention centre to five hotels and
nothing else.

**Done: the 18 with no route at all.** They were a defect rather than a data
gap. Outdoor edges used to be created only *from* a node with no cell — a loose
point outdoors — so two rooms that both sat on drawn floors in buildings no
skywalk joined got no edge between them at all and `walkBetween` returned null.
Every venue now has door nodes on the lowest floor whose circulation is drawn,
one per connected piece of it, and any two indoor nodes can be joined by
walk → door → outdoor → door → walk.

Two things had to come with it. Doors compete with skywalks, and an
uncorrected straight line wins nearly every time — Exhibit Hall B to the
Marriott Ballroom came out as 389 m across the street against 500 m over the
bridges — so the search runs twice, once over measured surfaces only and again
with the straight lines switched on, and an outdoor leg is charged the 4/π
detour a grid of blocks really costs. And one door per *floor* was not enough:
the JW's ground floor is drawn as several disconnected runs, so a single door
stranded everything outside the piece it landed in and made the hotel
unreachable from all thirteen other buildings. `route.test.ts` holds both.

**What to do next:**

1. **Pull the pedestrian network from OpenStreetMap.** `footway`, `sidewalk`,
   `crossing`, and `highway=pedestrian` over the campus bounding box, by the
   same Overpass query that produced `footprints.ts`. That turns 170 straight
   lines into real routes and is the single biggest improvement available.
2. **Snap the doors to it.** A door node joins the pavement graph at its nearest
   footway vertex, and the outdoor leg stops being straight.

Until (1), keep the leg dashed and keep the wording. A straight line called a
straight line is honest; a straight line called a route is not.

---

## 2. Fifteen floors have no walkable surface

**Measured.** Floors whose circulation nothing has drawn:

```
Lucas Oil Stadium   all six floors
JW Marriott         2nd, 3rd
Hyatt Regency       1st
Hilton              1st
Embassy Suites      2nd
Le Méridien         1st
Indiana Rep, Escape Room, Circle Centre   their only floor
```

No route can cross these, and a room on one falls back to its centre rather
than a doorway (see §3). The JW is the one that bites: the skywalk enters it on
the 2nd floor, which has no surface, so **the JW cannot be routed into at all**
despite being skywalk-connected to the convention centre.

**What to do.** Gen Con's campus sheets now place correctly (§4 of the README),
and they cover every building on all five campus levels — not just the two the
convention centre uses. Registering the remaining `venueId/level` pairs in
`CAMPUS_SHEETS` would give most of these floors their circulation for free.
Lucas Oil is the exception: no published plan names its spaces, which is why its
rooms are schematic in the first place.

Do the JW's 2nd floor first. It is one line of `CAMPUS_SHEETS` and it connects a
whole hotel to the network.

---

## 3. Twenty-nine rooms have no doorway

**Measured.** `roomEntrance` finds nothing for 29 of 146 rooms, which then use
their centre — the inaccuracy the doorway work existed to remove:

```
Lucas Oil 8 · JW Marriott 7 · Crowne Plaza 5 · Convention Center 2
Hyatt 1 · Hilton 1 · Embassy 1 · Le Méridien 1 · Indiana Rep 1
Escape Room 1 · Circle Centre 1
```

Every one of these is a room on a floor from §2. **Fixing §2 fixes this**; there
is no separate work, and the two should be measured together after each sheet is
added.

The convention centre's two are worth a look on their own, though, since its
floors *are* drawn — they are likely rooms whose outline sits further than
`roomEntrance`'s 12 m search from any circulation.

---

## 4. The routing engine is only tested over the real campus

`route.ts` now has `route.test.ts`, which asserts the properties a route must
have across every pair of buildings — no pair unanswered, a measured route never
passed over for a straight line, a total that agrees with the legs under it.
That is the coverage the door work needed and it catches the regressions that
work could cause.

What it cannot do is localise a fault. It runs over real venue data, so a break
in A\*, in the portal graph or in the grid shows up as "the JW is unreachable"
rather than as "a diagonal cut a blocked corner". `walkable.ts` and
`vertical.ts` still have no tests of their own.

**What to write, cheapest first:**

- `walkable.ts` — a hand-made floor (a corridor with a wall in it), then: A\*
  goes round the wall rather than through it; a diagonal never cuts a blocked
  corner; `smooth` leaves a straight corridor as two points; `nearestOpen`
  returns null past its radius; `roomEntrance` picks the wall the corridor is on.
- `route.ts` — a two-floor toy campus, then: the portal graph prefers the nearer
  of two staircases; a leg's `certainty` reaches its text; `merge` folds
  consecutive same-floor legs. That last one is worth doing precisely because
  nothing on the real campus exercises it — no route there merges anything, so
  `merge` is live code with no coverage at all.
- `vertical.ts` — a drawn pair within `SAME_SHAFT` becomes one link; beyond it,
  two; a floor with drawn marks never falls back to the inference.

None of these need real venue data, which is what makes them cheap.

---

## 5. The two riskiest modules in the repository are still untested

Unchanged from `code-review.md` §1.2–1.3, and still true: the HTML scraper
(`scripts/lib/parse-events.mjs`) and the room matcher (`src/data/events.ts`)
both fail by quietly returning `null` rather than by throwing. A source redesign
that dropped 40% of events would look identical to a good run in the logs.

Worth noting what has changed since that review: the matcher is now measurably
*better* than it claimed — a full 27,467-event import leaves **nothing**
unmatched, against the 99.6% the README records from a 2,739-event sample. That
is a reason to pin the behaviour with tests, not a reason to skip them.

The scraper's tests need fixtures: one saved `event.php`, one `categoryAll.php`,
one `dayTimeList.php` under `scripts/lib/__fixtures__/`.

---

## 6. Smaller sharp edges

- **Three buildings still infer their stairs** — Crowne Plaza, Hilton, Omni.
  Their sheets show no hatched block the reader recognises. Look at whether
  those hotels' vertical circulation is drawn some other way before widening the
  grey rule, which currently risks catching printed rules and shadows.
- **`plans/campus/` is gitignored**, so a rebuild without `npm run plans:campus`
  writes a `venue-plan.ts` whose convention centre has no stairs and which
  otherwise looks healthy. The script warns and a test catches it, but the trap
  is real. Committing the sheets is the alternative and costs eighteen megabytes
  of somebody else's drawings.
- **`CAMPUS_GEO` is pinned to the z5 sheet.** Changing the fetcher's zoom cap
  silently invalidates the scale — halving or doubling it per level. A test that
  asserts the sheet's pixel dimensions before trusting the constant would catch
  that.
- **`fetch-events.mjs` cannot be unit-tested** because it takes its lock and
  runs on import. Its resume logic is verified by running it. Extracting the
  decision — which cached records a full pull may keep — into an exported pure
  function would make the part that matters testable without unpicking the
  script.
