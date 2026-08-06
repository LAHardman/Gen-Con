# Next steps: the gaps directions still has

Written after the walking router landed, from measurements rather than
impressions. Every number here came from running the code over the real data;
the script fragments that produced them are in each section so they can be
re-run rather than believed.

Ordered by how much of the app is wrong without them, not by how interesting
they are to build.

---

## 1. Outdoors — done, and what it cost

**Measured.** Over every pair of buildings, routing one room to another:

| | Before doors | With doors | With pavements | With §2's floors |
|---|---|---|---|---|
| Routed entirely under cover | 12 | 12 | 12 | 12 |
| Follows surveyed pavement | — | — | 168 | **170** |
| Needs a long straight line | 152 | 170 | 2 | **0** |
| Gets no route at all | **18** | 0 | 0 | 0 |
| Total | 182 | 182 | 182 | 182 |

Every pair on the campus now walks either a floor somebody drew, a skywalk, or a
pavement somebody surveyed. The last two straight lines were journeys to Lucas
Oil, and they went when the Embassy Suites got a ground floor to leave by.

**What was done.**

1. *Door nodes.* Every venue has ways out on the lowest floor whose circulation
   is drawn — one per connected piece of it, and several around a large
   building. That fixed the 18 with no route. It also had to be several rather
   than one: the convention centre is 400 m across, and with a single door every
   route out of it left by the same corner and the walk to the street was long
   enough to beat the skywalks on distance while being far less use.
2. *The pavements.* `npm run fetch:pavements` pulls the ground-level footway
   network from Overpass — 664 junctions, 831 runs, 32 km — and `route.ts`
   walks it. The skywalks are excluded even though OpenStreetMap has them,
   because `connections.ts` already holds them with the floor each lands on.
3. *The doors join it.* Each door reaches the nearest footway in each quarter of
   the compass, up to 90 m. That hop is the only straight line left in an
   ordinary route.

**What it cost, and this is a real change in behaviour.** With outdoor routes
made of surveyed pavement rather than bearings, the old rule — a measured route
always beats a guessed one, so never go outside if a skywalk exists — stopped
being justified. It is replaced by a stated preference: take the covered route
when it is within a quarter as long, and the shortest otherwise
(`WORTH_STAYING_IN` in `route.ts`). All 12 covered pairs survive that, but
individual room pairs move: Exhibit Hall B to the Marriott Ballroom is now 217 m
across the street rather than 500 m over a skywalk dogleg through the Westin.

If that preference is wrong for August, it is one constant.

**What is left outdoors.** The dashed forecourt hop is 25–90 m at most
buildings and it crosses ground nobody has drawn — sometimes a plaza, sometimes
a street. Mapping the actual entrances, or tracing the forecourt paths, would
remove the last guess from an outdoor route. It is a much smaller prize than
the network was.

---

## 2. Nine floors have no walkable surface — was fifteen

**Measured.** Floors whose circulation nothing has drawn, after reading the
campus sheets:

```
Lucas Oil Stadium                          all six floors
Indiana Rep, Escape Room, Circle Centre    their only floor
```

Six were filled from Gen Con's own campus tiles, which cover every building on
all five campus levels rather than only the two the convention centre uses:
the JW's 2nd and 3rd, the Hyatt's, the Hilton's and Le Méridien's 1st, and the
Embassy's 2nd. Registering them is a line each in `CAMPUS_SHEETS`.

**One thing had to be fixed first, and it is the reason this was not one line.**
`trace` walks the whole classified image, which is right for a screenshot of one
hotel — the sheet *is* the hotel — and wrong for a sheet of a mile of downtown.
The JW's 2nd floor came out as every cream corridor between Georgia Street and
the stadium: eighteen shapes spanning 1138 by 858 metres, 22,419 m² of "hotel"
against a building of 2,400, and 752 m² of Rooms 201–205 landing outside the
JW. A georeferenced sheet is now clipped to the venue's surveyed footprint
before anything is traced from it, and the pixels are cut rather than the
finished shapes — a corridor running from one building into the next is one
component either way, and only a cut divides it.

**What it bought.** Empty floors 15 → 9, rooms with no doorway 29 → 19 (§3),
floor changes the plans draw 19 → 30, and building pairs needing a long straight
line 2 → **0**. Every pair on the campus now walks a drawn floor, a skywalk or a
surveyed pavement.

**What it did not buy, and this is worth recording.** The premise of this
section used to be that the JW's 2nd floor "is one line of `CAMPUS_SHEETS` and
it connects a whole hotel to the network". That is wrong, and the floor was
necessary but not sufficient: **the JW's skywalk does not reach any Gen Con
venue.** In OpenStreetMap its only bridge (way 340480902) runs east from the
hotel and lands on the Indiana Government Center Parking Facility, 69 m short of
the convention centre's outline, and no elevated way continues from there. The
same is true of the Hyatt's (way 340480901) and of the pair at the Marriott
(340480897, 340480908). Four of the twelve spans in `connections.ts` therefore
touch exactly one registered building and join nothing.

That is a hole in the source, not a filter: every `bridge` footway in the campus
bounding box was checked, and the ten not already in `connections.ts` are all
out in the margin — Blackford Street, the IUPUI footbridges, the ones north of
Michigan Street. So seven of the fifteen skywalk-joined pairs of buildings still
have no covered route, and closing that means either finding the missing spans
in another source or drawing them.

---

## 2b. Lucas Oil is drawn after all

Gen Con's campus level 1 draws the stadium in full — the concourse ring, the
East and West Club Lounges, the North Plaza, the lifts, and escalators lettered
UP TO TERRACE LEVEL, DOWN TO EVENT SPACES and TO FIELD & LOWER SUITE LEVEL.
That is far better than the schematic rectangles its rooms are today, and it
would settle the last 8 rooms with no doorway.

It is not registered because **which of its six storeys that sheet is cannot be
read off the sheet.** `venues.ts` names them Field, Level 1, Concourse, Club,
Meeting and Suite; the drawing shows what is plainly the main concourse, but
labels the club lounges on it, and Gen Con numbers campus levels rather than
building storeys. Guessing puts a floor's circulation on the wrong storey, which
is silent — the map draws a healthy-looking floor and routes cross it at the
wrong height.

**What to do:** work out the mapping from the five sheets together (a storey
that letters UP TO X and DOWN TO Y pins itself against its neighbours), then
register all six. This is the largest single piece of interior still missing.

---

## 3. Nineteen rooms have no doorway — was twenty-nine

**Measured.** `roomEntrance` finds nothing for 19 of 146 rooms, which then use
their centre — the inaccuracy the doorway work existed to remove:

```
Lucas Oil 8 · Crowne Plaza 5 · Convention Center 2 · JW Marriott 1
Indiana Rep 1 · Escape Room 1 · Circle Centre 1
```

The ten that went were rooms on the floors §2 filled, exactly as expected: the
two are one piece of work and should be measured together. Lucas Oil's eight go
when §2b is done.

The Crowne Plaza's five and the convention centre's two are worth a look on
their own, since those floors *are* drawn — they are likely rooms whose outline
sits further than `roomEntrance`'s 12 m search from any circulation.

---

## 4. The routing engine is only tested over the real campus

`route.ts` now has `route.test.ts`, which asserts the properties a route must
have across every pair of buildings — no pair unanswered, pavement walked rather
than guessed across, the cover preference obeyed in both directions, a total
that agrees with the legs under it. That is the coverage the door and pavement
work needed and it catches the regressions that work could cause.

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
- **`fetch-pavements.mjs` has no test, and its exclusions are the load-bearing
  part.** If a future Overpass pull stopped filtering `bridge`/`covered`/`layer`,
  the skywalks would enter the pavement network as ground-level footway and the
  router would happily cross one without going upstairs — silently, and looking
  more connected rather than less. A test over a saved Overpass fixture
  asserting that `onTheGround` rejects a bridge would cost very little.
- **`fetch-events.mjs` cannot be unit-tested** because it takes its lock and
  runs on import. Its resume logic is verified by running it. Extracting the
  decision — which cached records a full pull may keep — into an exported pure
  function would make the part that matters testable without unpicking the
  script.
