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

**What it did not buy, and it turned out not to be a hole in the source.** The
premise of this section used to be that the JW's 2nd floor "is one line of
`CAMPUS_SHEETS` and it connects a whole hotel to the network". That was wrong,
and the floor was necessary but not sufficient: the JW's only bridge (way
340480902) runs east from the hotel and lands 69 m short of the convention
centre's outline. The same was true of the Hyatt's (way 340480901) and of the
pair at the Marriott (340480897, 340480908) — four of the twelve spans touched
exactly one registered building and so joined nothing.

This was written up as a gap in OpenStreetMap. It was not. What each of those
four spans lands on is a **car park**, and a second span carries on off the far
side of it: the JW's bridge lands on the Indiana Government Center Parking
Facility, from which the Marriott's two spans continue east; the Hyatt's lands
on the World of Wonders Garage, from which Le Méridien's continues. That is
what downtown's skywalks were built for — getting from a garage to a building
without crossing a road — so a garage is the middle of a chain rather than the
end of one. The spans were all there; the thing between them was not a venue,
so nothing joined them up.

`LANDINGS` in `connections.ts` is that missing piece: a footprint a span may
come down on, with no plan of the inside and no floors to name. Two spans
reaching the same landing are two halves of one covered walk, and `route.ts`
joins them with a straight line across it, named as one ("Through the Government
Center car park"). Finding another is mechanical: take a span reaching exactly
one venue, ask what building its other end stands on, and check whether a second
span stands on that building too. If not, it is a dead end and a landing there
would chain nothing.

**What it bought.** All 1,008 of the JW's room pairs with the Marriott, the
Westin, the ICC and the Hyatt used to go out into the street; 273 no longer do.
All 48 of the Hyatt's with Le Méridien did; none does now. The rest are covered
routes that exist and lose to the pavement on distance, which is `walkBetween`
working rather than failing — the JW to Exhibit Hall B is 293 m across the road
against 862 m round three hotels.

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

## 3. Seven rooms have no doorway — was twenty-nine, then fourteen

**Measured.** `roomDoor` finds nothing for 7 of 146 rooms, which then use their
centre — the inaccuracy the doorway work existed to remove:

```
circle-centre-mall, escape-room-venue, indiana-rep-stage   single-room venues
                                                           Gen Con does not
                                                           colour, so no
                                                           corridor is drawn
hall-g                     30 m from the nearest drawn circulation
jw-rooms-206-207           36 m
lucas-oil-exhibit-halls    112 m
lucas-oil-meeting-rooms    64 m
```

**What closed the last seven, and it was not a bigger number.** The search
reached 12 m, and this document used to say that widening it "would find a
doorway on the wrong wall". That was worth testing rather than believing.
Measured at 25 m, seven rooms gained a doorway and *one* of them — Union
Station's B&O room — was exactly the predicted failure: circulation 20 m off
its wall with two whole railroad rooms in between, so the nearest walkable
pixel is through both of them and the door leads into somebody else's meeting.

So the rule is no longer a radius. A doorway is only a doorway if you can walk
out of it, and `roomEntrance` now steps along the line from each candidate to
its corridor and throws away any that goes through another room — taking the
next-best instead, which is how the B&O room ends up with a door on a different
wall rather than with none. The reach can then be generous, because the thing
it was guarding against is tested for directly.

It needed a tolerance, and that took a second attempt: most outlines here are
schematic rectangles that abut, so the two-metre line from a door to the
corridor clips the room it shares a wall with. Refusing those cost Union
Station two doorways it had before. Three metres — one grid cell and a little —
separates a shared edge from walking the length of a room.

```
                        roomless   under cover (182 pairs)
 12 m, no crossing test        14                       12
 25 m, no crossing test         7   one door through two rooms
 25 m, crossing test            7                       14
```

Both remaining numbers are unblocked by anything in the code. The three
single-room venues need a plan Gen Con does not publish; the other four need
better rectangles — Lucas Oil's two sit 64 m and 112 m from the floor that is
drawn, which no honest search will cross.

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
matcher — see §7.

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

**Done: `plans/campus/` being gitignored no longer writes a bad file.** The
sheets are Gen Con's drawings and eighteen megabytes of them, so a fresh clone
has none — and a rebuild without them used to *warn* and then write a
`venue-plan.ts` missing ten floors and the convention centre's staircases. That
file parses, type-checks and renders; the only symptoms arrive much later and
somewhere else, as a building that stops changing floors and hotels no route
can reach. A warning scrolls past in a build log.

It now refuses, exits 1, and leaves the existing file alone, naming what would
have gone:

```
plans/campus/ is empty, so this run would write a venue-plan.ts missing
10 floors and the stairs of 2 more — a file that looks
perfectly healthy and cannot route into half the hotels.

  no floor at all   embassy-suites 2nd floor
  ...
  no stairs         icc Level 2

Run `npm run plans:campus` first. To build without them anyway, and get
that file on purpose, pass --without-campus.
```

That list is derived from `CAMPUS_SHEETS` rather than written beside it,
because the old warning said "six whole floors" for as long as there were
nine. The decision is `refuseToWrite` in `scripts/lib/plan-sources.mjs`, kept
out of `venue-plans.mjs` because that script reads and writes on import and
could not otherwise be asked.

---

## 7. Booths — the stand list is here, the halls are not

Gen Con publishes who is at which booth, unauthenticated and paginated:

```
https://www.gencon.com/api/v1/exhibitor_profiles?page=N&per_page=100
```

`scripts/fetch-exhibitors.mjs` reads it into `src/data/exhibitors.ts` — **846
locations, 780 exhibitors, 794 of them numbered**, one row per *place* rather
than per exhibitor, since a publisher with four booths, a demo hall and a
meeting room is six places somebody might be looking for.

**What it bought.** 47 of those locations name a room the map draws, and they
name it in the same words the schedule does, so the same matcher reads both:
Halls A–E, the Level 1 and Level 2 meeting-room blocks, the Sagamore Ballroom
and Lucas Oil's West Club Lounge. Typing "Asmodee" now finds Hall E and Room
233. Exhibitor names rank *below* a room's own names, so "hall b" still finds
Exhibit Hall B rather than the thirteen publishers standing in it.

**What it did not buy, and this was the point of the exercise.** The other 573
are `Exhibit Hall : Booth 1637`, and there are eleven exhibit halls. The plan
was to solve the `lg`/`lt` coordinates each location carries into latitude and
longitude and read the hall off the geometry. That is not possible, and it is
worth writing down why rather than leaving it as a to-do:

`gencon.com/map` is `L.CRS.Simple` over a tile pyramid at `/lg/tiles/v1/`, and
**those tiles are a star field**. The plan is vector overlay, laid out area by
area, each area revealed at its own zoom, with the areas sitting beside one
another rather than where the buildings are. Three measurements say so:

```
lt band        exhibit-hall booths -7.6..34.8, ICC rooms and halls -42..-5.6
               adjacent strips, not one building
aspect         booth cloud 78.2 x 42.4 units = 1.84, surveyed halls = 1.49
best fit       laid on the halls each of the eight ways a rectangle can be,
               the best puts 72% of booths inside a hall. A plan of the same
               rooms would put 100%.
```

The coordinates *are* internally faithful — the booths of one aisle share an
`lg` to within a unit and the aisles step by 2.65 — so what is missing is only
the link to the ground, which is the whole of what a route needs.

Two control points exist and are not enough: the schedule itself writes
`Exhibit Hall J : Booth #174` and `Exhibit Hall G` / `Booth #2667`. Two points
fit four parameters with nothing left to check them against, and the fit they
give covers only the south-east third of the halls — so it is wrong, and two
more control points would not prove the next one right either.

**What would close it** is a source that states the hall: Gen Con's own printed
exhibit-hall map with the letters over the booth grid, or an aisle-to-hall
range published anywhere. Until one turns up, a booth number resolves to an
exhibitor and not to a place, and the 41 events at booths #1229 and #1853 stay
in the unmatched report where they belong.
