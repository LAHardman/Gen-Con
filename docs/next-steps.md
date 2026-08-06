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

## 2. Three floors have no walkable surface — was fifteen

**Measured.** Floors whose circulation nothing has drawn, after reading the
campus sheets:

```
Indiana Rep, Escape Room, Circle Centre    their only floor
```

All three are venues Gen Con does not colour as its own on the campus sheets,
so there is nothing to read. Everything it does colour is now drawn.

Nine floors were filled from Gen Con's own campus tiles, which cover every
building on all five campus levels rather than only the two the convention
centre uses: the JW's 1st, 2nd and 3rd, the Hyatt's, the Hilton's and Le
Méridien's 1st, the Embassy's 2nd, and all three of the stadium's (§2b).

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

**What it bought.** Empty floors 15 → 3, rooms with no doorway 29 → 14 (§3),
floor changes 19 → 50, and building pairs needing a long straight line 2 → **0**.
Every pair on the campus now walks a drawn floor, a skywalk or a surveyed
pavement, and every room of a building reaches every other room of it.

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

## 2b. Lucas Oil — done, and it had six levels where the building has three

Gen Con's campus sheets draw the stadium in full. Which of its storeys each
sheet shows is not written on the sheet, but it can be read off the letterings,
because each one names its neighbours:

| Sheet | What it draws | Pinned by |
|---|---|---|
| level 0 | Halls 1–2, Meeting Rooms 1–12, the field | UP TO STREET LEVEL → 1 |
| level 1 | North Plaza, the concourse ring, the club lounges | DOWN TO EVENT SPACES → 0; UP TO TERRACE LEVEL → 4 |
| level 2 | the LS-numbered suites | the lift on 0 and 1 letters it LOWER SUITE LEVEL |
| level 3 | Club Lounge (upper level) | DOWN TO CLUB LOWER LEVEL → 1 |
| level 4 | Terrace / Upper Suite, Bud Light Zone | DOWN TO NORTH PLAZA → 1 |

**`venues.ts` had six levels for a building with three of them.** Halls 1–2,
Meeting Rooms 1–12 and the field are all one storey — Gen Con's level 0 — and
were authored as "Level 1", "Meeting level" and "Field level". Registering the
sheets against those names would have given three names to one floor and made
the router charge a staircase to walk between them. So the seven rooms were
re-homed onto the three storeys the sheets show: Event level, Concourse level,
Lower Suite level.

Levels 3 and 4 are drawn and are **not** registered, because no room in
`venues.ts` sits on either and a floor with no rooms cannot be keyed.

---

## 2c. What reading those floors broke, and how

Worth its own section, because it is the nastiest failure mode this repository
has: **drawing a floor can remove routes that existed before.** A room on a
floor nobody drew is a loose point — it has no square to stand on, so it goes
out to the street and routes badly but routes. Draw that floor and it gains a
square, and if no staircase reaches that square it is stranded with nothing to
fall back to.

Reading the JW's 2nd and 3rd floors did that to 114 pairs of its own rooms, and
reading Lucas Oil's did it to the whole stadium above the event level. Three
separate causes, each silent:

1. **A stray cell.** Lucas Oil's event level came out as 513 cells and one
   isolated speck of trace noise. An isolated cell is the *nearest* open cell
   to whatever sits beside it, so the drawn escalator up to the concourse
   snapped to it and the whole stadium above became unreachable. `walkable.ts`
   now sweeps any connected run under 8 cells at floor construction, which is
   where the rule `doorsOf` already used belongs.
2. **One link per overlap.** The inference put a single link at the centre of
   the largest piece of the overlap between two floors. Lucas Oil's lower suite
   ring is drawn as thirteen runs that do not touch, so twelve of them had no
   way off. Each piece big enough to be a room now gets its own.
3. **Two placements of one building.** The JW's 1st floor was *fitted* from a
   screenshot and its 2nd and 3rd *georeferenced* off the campus tiles. The two
   readings of its main escalator landed 14 m apart and the floors overlapped by
   32 m² in all, so no stair could be found between them and the White River
   Ballroom had no way upstairs. Its 1st floor now comes from the campus tiles
   too: floors that agree with each other beat a floor drawn four times finer.

And one thing the drawings could not do alone: a drawn shaft used to suppress
the inference entirely between two floors. That is right about precedence and
wrong about coverage — the JW's 1st floor is two runs and only one has a stair
beside it. The inference now still runs for any piece no drawn shaft serves.

`route.test.ts` holds the lot, by asserting that every room of a building
reaches every other room of it. All four are mutation-tested; the weaker
version of that test — one room per floor — caught only two of them.

---

## 3. Fourteen rooms have no doorway — was twenty-nine

**Measured.** `roomEntrance` finds nothing for 14 of 146 rooms, which then use
their centre — the inaccuracy the doorway work existed to remove:

```
Crowne Plaza 5 · Convention Center 2 · Lucas Oil 2 · JW Marriott 2
Indiana Rep 1 · Escape Room 1 · Circle Centre 1
```

Half of them went with the floors §2 and §2b filled, as expected: the two are
one piece of work and should be measured together.

What is left is no longer a floor problem — every one of these rooms is on a
floor that *is* drawn, except the three single-room venues. They are rooms
whose outline sits further than `roomEntrance`'s 12 m search from any
circulation, which for the stadium and the Crowne Plaza is mostly because their
room rectangles are schematic rather than traced. Widening the search would
find a doorway on the wrong wall; the fix is better rectangles.

---

## 4. The routing engine — done

`route.ts` has `route.test.ts` over the real campus, and `walkable.ts` and
`vertical.ts` now each have a file of their own over floors made up for the
purpose: `walkable.toy.test.ts` and `vertical.toy.test.ts`.

The two kinds do different jobs and both are needed. The campus tests assert
what a route must be and are what actually catch regressions — every pair of
buildings answered, every room of a building reaching every other room of it,
the cover preference obeyed in both directions. What they cannot do is say
where a fault is: a break in A\* shows up there as "the JW is unreachable".

The toy floors are drawn in the test file — a corridor bent into a U, two
squares meeting at one corner, a straight run, a speck of noise — and are
small enough to count the answers by hand. They are supplied by mocking
`venue-plan`, because `surfaceOf` reads `VENUE_HALLS[venueId/level]` and has no
other input, so that is the seam the real data comes through.

**Every assertion in both files is mutation-tested.** Between them they catch:
a diagonal cutting a blocked corner; string-pulling removed; line of sight
ignoring what it crosses; `nearestOpen` ignoring its radius; `roomEntrance`
judging a wall by its corners alone; `doorsOf` back to one door per piece; two
marks 35 m apart read as one shaft; a shaft reported at one reading rather than
between them; one inferred link per pair of floors rather than per piece; no
minimum overlap; a drawn shaft suppressing the inference outright; a guess
added beside every drawn shaft; floors joined that are not adjacent.

One note on the frame: a `vi.mock` factory is hoisted above the imports, so it
cannot call `toLatLng` and repeats the origin and the two scales instead. Both
files open with a test that the repeated frame agrees with `walkable.ts`'s —
without it a drift would move every shape in the file and leave every test
passing against a different building.

**`merge` turned out to be the busiest thing in `route.ts`.** It was recorded
here as live code with no coverage, and at the time no route on the campus
folded a single leg. The pavements changed that: a footway junction every few
metres means the Marriott run comes out of the search as a dozen legs that all
say "Along the pavement", and `merge` now folds about seven times per route.
`route.test.ts` asserts no two consecutive legs are the same thing, which is
the property the panel depends on.

---

## 5. The two riskiest modules — done, and one claim here was wrong

The HTML scraper (`scripts/lib/parse-events.mjs`) and the room matcher
(`src/data/events.ts`) both fail by quietly returning `null`, which is why they
were the riskiest things here: a source redesign that renamed one row label
would drop that field from every event, and the run would finish, report
success and publish a schedule with no locations in it.

`scripts/lib/parse-events.test.mjs` runs against three real pages saved under
`__fixtures__/` — an event page, a catalogue page cut down to four game systems
from 2.8 MB, and the day/time index. `src/data/events.test.ts` runs the matcher
over the real location strings: there are only twenty-two distinct `Location`
values across a full import, and all of them are in the test.

Vitest's `include` now covers `scripts/**/*.test.mjs` as well as `src`, so the
scripts are tested where they live rather than being given hand-written
declarations to be importable from `src`.

**A claim in this document was wrong.** It recorded that a full 27,467-event
import "leaves **nothing** unmatched". Measured, it leaves 130 — 0.47% — and
every one of them is a place the map has not got rather than a matcher failure:

```
 79  the convention centre's "Exhibit Hall" and "Exhibit Hall Booth #1229" —
     the source does not name which hall, and there are eleven
 40  seven venues that are not on the map: Janus Lofts, Taxman CityWay,
     St. Elmo Steak House, 416 Wabash, Victory Field, White River State Park,
     The Oceanaire Seafood Room
 11  foyers and concourse spots no room is authored for — "North Plaza",
     "Georgia Street Entrance", "3rd Floor Foyer", "Eerie"
```

That is a better result than the round number was, and it is checkable. The
first group is the only one worth acting on and the action is not in the
matcher: naming which exhibit hall a booth is in would need the booth numbers,
which the source does not publish.

**Mutation-tested, both files.** Between them they catch: the Location label
renamed at the source; insisting on a `<table>` again (the 2,661 roleplaying
events whose markup loses it); a catalogue session emitted before any title;
the day index assumed rather than read; a ticket count losing its sign; a label
claimed by two fields; searching every room on the campus rather than the
building's; substring matching instead of token boundaries; first match winning
rather than longest; aliases ignored; an unknown building falling through to
every room; a venue with rooms falling back to its first one.

---

## 6. Smaller sharp edges

**Done: `CAMPUS_GEO` is no longer trusted blind.** Its three numbers were
measured against the z5 sheet, which is 8192 pixels square. Fetch the pyramid
at another zoom and they are all still numbers — every building on the sheet
moves together and each lands somewhere plausible and wrong, which is the worst
kind of wrong. `venue-plans.mjs` now checks the sheet's size before using the
constant and stops the run with what to do about it.

**Done: the importer's three decisions are testable.** `fetch-events.mjs` takes
a lock and starts fetching on import, so the only way to check them was to run
it against the live site. They are now pure functions in
`scripts/lib/import-plan.mjs`, with `import-plan.test.mjs` over them, and each
fails silently in a different direction:

```
keep too much    a full pull refreshes nothing and reports success
keep too little  an interrupted full pull starts over every time and can
                 never finish, however often it is run
finish early     the watermark moves past change sets covering events this
                 run never read, and the feed keeps what it last said for ever
```

One thing changed while extracting them: `pullComplete()` with nothing to go on
used to answer "yes, finished". It now answers "no". The cost of that default
being wrong is one extra run; the cost of the other was events skipped for good.

**Measured, and the answer is no: five buildings still infer their stairs, and
the campus sheets cannot fix it.** The question this section asked was whether
their vertical circulation is drawn some other way before anybody widens the
grey rule. It is — partly — and it is still not enough. Registering the campus
tiles for stairs only, which is what the convention centre does, finds marks
their own screenshots miss:

| | 1st / lower floor | upper floors |
|---|---|---|
| Crowne Plaza | **0 marks** | Mezzanine: 3 |
| Hilton | **0 marks** | 2nd: 3, 9th: 1 |
| Omni | 1st: 1 | 2nd: 1 |
| Le Méridien | 0 | 0 |
| Embassy Suites | 0 | 0 |

A link needs a mark on *both* floors of an adjacent pair, and none of these has
one. The Crowne Plaza's and the Hilton's ground floors show nothing the reader
recognises; the Omni has one on each and they are **33 m apart**, which is not
one shaft seen twice. The Hilton's 2nd and 9th are 19 m apart, one metre over
`SAME_SHAFT` — and moving the threshold to catch that would be fitting the
constant to the case rather than to the fit it exists for.

So the entries were written, measured, and taken out again: they produced marks
and no links, which is data that changes nothing. **The remaining work is on the
reader, not the sheet** — the ground-floor sheets are where there is nothing to
pair with, and until one of those yields a mark, these five keep the inference.
That is not a bad answer for a route to give: it says which stretch of corridor
the stairs are off rather than naming one, which is what the plans support.

**Still open: `plans/campus/` is gitignored**, so a rebuild without
`npm run plans:campus` writes a `venue-plan.ts` missing the convention centre's
stairs and nine whole floors. The script warns, and `venue-plan.test.ts` names
every floor it expects rather than counting them, so the gap fails the build
rather than shipping. Committing the sheets is the alternative and costs
eighteen megabytes of somebody else's drawings.
