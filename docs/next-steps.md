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

**What it bought.** Empty floors 15 → 3, rooms with no doorway 29 → 14 and
then 7 (§3), floor changes 19 → 75, and building pairs needing a long straight
line 2 → **0**.
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

## 3. One room has no doorway — was twenty-nine, then fourteen, then seven

**Measured.** `roomDoor` finds nothing for 6 of 149 rooms, which then use their
centre — the inaccuracy the doorway work existed to remove:

```
circle-centre-mall, escape-room-venue, indiana-rep-stage   single-room venues
                                                           Gen Con does not
                                                           colour, so no
                                                           corridor is drawn
block-party-street, makers-market                          a street and a
                                                           corridor: no inside,
                                                           and their centre is
                                                           where you are going
jw-rooms-206-207           36 m from the nearest drawn circulation
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

**Three of the four that were left have since gone, and each was a different
fault.** Lucas Oil's two were a *half-turn out* — read off a sheet Gen Con
draws with south at the top, without turning it — so both sat in the stadium's
south corner where the sheet puts them in the north-east one. Exhibit Hall G
was neither a rectangle fault nor a threshold one: its outline is right and
nothing draws a corridor against any of its four walls, so its way out is
across Hall H, and the rule is now that an exhibit hall may open through
another exhibit hall. The halls are one floor with air walls across them; the
booth numbers say so by running straight through from the 100s to the 3000s.
`REACH` went 25 → 35 to reach across it, which over the whole campus gains that
one doorway and moves no other by half a metre.

The last one, `jw-rooms-206-207`, is 36 m from the JW's drawn 2nd-floor
circulation and needs a better rectangle. The three single-room venues need a
plan Gen Con does not publish.

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

## 7. Booths — done, and the last piece was not in any file

Gen Con publishes who is at which booth, unauthenticated and paginated:

```
https://www.gencon.com/api/v1/exhibitor_profiles?page=N&per_page=100
```

`scripts/fetch-exhibitors.mjs` reads it into `src/data/exhibitors.ts` — **846
locations, 780 exhibitors, 794 of them numbered** — one row per *place* rather
than per exhibitor, since a publisher with four booths, a demo hall and a
meeting room is six places somebody might be looking for.

**The hall was the hard half, and no source has it.** 573 of those rows say
`Exhibit Hall : Booth 1637`, and there are eleven exhibit halls. Three sources
were checked and none of them says which:

```
the schedule      `Exhibit Hall Booth #1229`, twice in 27,467 events naming
                  a hall outright and never otherwise
the map API       `lg`/`lt` coordinates on a tile pyramid whose tiles are a
                  star field — laid out area by area, not a plan. The booth
                  cloud is aspect 1.84 against 1.49 for the halls it would
                  have to be, and laid on them each of the eight ways a
                  rectangle can be, the best fit puts 72% of booths inside a
                  hall where a real plan would put all of them
the printed map   a true plan of the grid, drawn to scale, that letters no
                  hall at all (§8)
```

**What closed it was somebody who has walked the hall.** Four divides, as booth
numbers either side of an air wall:

| between | and | is the wall between |
|---|---|---|
| 500s | 600s | J and K, above · I, below |
| 1300s | 1400s | I · H |
| 2200s | 2300s | H · G |
| 2723 | 2727 | G · F — the only one inside an aisle rather than between two |
| 331 | 339 | K · J — and it crosses the aisles, see below |
| 429 | 439 | K · J — the same wall, two aisles along |

That is knowledge, not a derivation, so it is checked rather than trusted. The
schedule names a hall exactly twice in 27,467 events — `Exhibit Hall J : Booth
#174` and `Exhibit Hall G` with `Booth #2667` — and both agree with the table.
They are the check worth having because they had no part in writing it: read
the other way round, with I below the 500s rather than above, booth 174 lands
in Hall I and the schedule says J. There is one reading of these divides the
data supports.

A third confirmation fell out of it: a row reading `Exhibit Hall G` in its words
and `Booth #2667` in its table resolves to Hall G both ways.

**The fifth wall is a different shape, which is why it is two rows.** The other
four run between aisles: an aisle is wholly in one hall and the number alone
decides it. Halls J and K are stacked one behind the other at the same end of
the building, so the wall between them runs *across* the aisles — every aisle
from the 100s to the 500s is cut in half, and a booth's hall depends on how far
along its aisle it stands. A booth number is an aisle and then a position, so
the test is `number % 100`: from 32 up is Hall J, below it Hall K.

32 is where the two given crossings put it. Between 331 and 339, and between
429 and 439: both say the line is somewhere in the low thirties to 39, and 32
is the tightest line satisfying both. Which side is J is not something either
crossing says — that is booth 174 again, at position 74 and called Hall J by
the schedule, doing a second job it was never meant for.

Ten stands straddle the wall rather than falling either side of it — 132, 133,
135, 136, 137, 234, 237, 533, 535, 537. They are counted as Hall J, and being
wrong about them costs nothing: a stand *on* the wall is reachable from both
halls, which is the one case where a coin toss is not a coin toss.

**What it bought.**

```
events resolving to no room     130 → 50   of 27,467
stand locations placed on the map  47 → 621  of 846
exhibit-hall stands placed          0 → 573  of 573
```

Placing Community Row, the Makers Market, the Block Party and the three blocks
of tables in Hall I — see §8 — took the stand total on to **846 of 846**.

The 79 exhibit-hall events that used to be the largest group of unmatched are
all placed, and so is every stand in the hall. Searching a publisher now takes
you to the hall: "Kenzer" finds Exhibit Hall I.

**What it also disproved.** `venues.ts` called Hall J "Open Gaming" and Hall K
"Family Fun", and drew both in the gaming colour rather than the exhibit one.
Neither name appears in the schedule, the stand list or the printed plan —
they were somebody's recollection. What the stand list says is that 127 trade
stands are in that stretch, which is not what a hall of free tables looks like.
Both are now plain exhibit halls, and the Family Fun Pavilion is an alias of
Hall H, where it actually is. `booths.test.ts` asserts the category off the
stand list rather than off a hand-written list, so the next name somebody
remembers has to survive the data.

---

## 8. What is left, and what each thing is waiting on

Everything below has been measured rather than estimated, and none of it is
waiting on more code.

**Booth to hall — closed, by somebody who has walked the hall.** See §7. Five
divides did it, the fifth cutting across the aisles rather than between them.
All 573 exhibit-hall stands are placed.

The printed map is not that source and it is worth writing down why, because
§7 predicted it would be. It was fetched by hand — `files.gencon.com` is
refused by this environment's egress policy, the gateway answering 403 to the
CONNECT before any request is made — and read. **It letters no hall.** It is
one page, a two-page programme spread: the upper three quarters the booth grid,
the lower quarter the exhibitor index, which is
the same information `exhibitors.ts` already holds, plus a "Sponsor Locations
Outside Exhibit Hall" block giving hall letters for about thirty *demo spaces*,
which is the same information again.

Three things about it, so nobody opens it hoping for more:

  - **The booth numbers on the plan are vector art, not text.** Its text layer
    holds 1,914 items and every one is the index or one of a dozen big labels.
    They have since been read anyway — see §9 — by clustering the outlines.
  - **The only lettered regions are the Art Show, Authors Avenue, Entrepreneurs
    Avenue and the Family Fun Pavilion**, plus the Exhibitor Services Desk and
    five entrance arrows.
  - **The plan and `venues.ts` disagreed about where the halls are, and the
    plan was right.** The schedule puts booth 174 in Hall J and 174 is at the
    extreme left of the plan; the Family Fun Pavilion, which `venues.ts` called
    Hall K, is centre-right — yet `venues.ts` had J and K adjacent at the east
    end. Two halls that share a wall are not at opposite ends of their own
    plan. What was wrong was the *name*: the Family Fun Pavilion is the bottom
    right corner of Hall H, which is centre-right, which is exactly where the
    plan draws it. J and K are adjacent after all, stacked rather than side by
    side.

    That much held. The wider conclusion — "nothing on the plan contradicts
    `venues.ts`'s geometry any more, so a geometric fit is now attemptable" —
    did not, and §9 is what disproved it.

**Every stand is placed — 846 of 846**, and 50 events of 27,467 still resolve
to no room. The last six stand areas took six separate answers, and none of
them was in any file:

  - **Community Row** — Sagamore Ballroom hallway, ICC Level 2. Its four
    Educator Row tables are the same run: the stand list numbers Community Row
    1–15 and Educator Row 16–19, so they are one corridor with two names, and
    `venues.ts` carries both as aliases of one room.
  - **Makers Market** — the connector between the convention centre and the
    stadium, which is a venue of its own on the map because the ICC's
    OpenStreetMap footprint has the arm and its floor plans do not.
  - **Block Party** — West South Street, closed Wednesday to Sunday, drawn
    kerb to kerb from the two pavement ways OSM maps either side of it. The
    2025 Block Party map Gen Con published labels a "Pedestrian Connector" at
    the edge of the party, and the connector above comes down to the ground at
    the north-east corner of this block — the two agree, which is the only
    independent check there is on the extent.
  - **Art Show, Authors Avenue and the Entertainers Spotlight** — 137 tables,
    all three in Exhibit Hall I. The printed plan draws them as one block
    between the 600s and the 1100s and letters no hall on it, which would have
    made this a reading of vector art. It is not: 18 rows of the schedule read
    `Exhibit Hall I` in the room and `Authors Avenue` in the table, which
    places the middle of the block from a source that had no part in reading
    the plan. Found by grepping the feed for the three names — worth doing
    before assuming a field is silent, since this one had been searched for
    halls and not for these.
  - **The stadium field** — four publisher demo spaces filed under an area of
    one word, `Field`. A reading rather than a telling, and the only one left:
    there is exactly one Field on the campus.

**Three floors with nothing walkable — waiting on a plan.** The Indiana Rep,
the Escape Room and Circle Centre are single-room venues Gen Con does not
colour as its own on the campus sheets, so there is nothing to read. Their
rooms keep their centres and their routes say so. Nothing short of a floor plan
for each changes this, and each is one room. The Block Party and the connector
have no walkable floor either, but for a reason that needs no fixing: a street
and a corridor have no inside to search over, and falling back to the centre of
either is where somebody walking there is going.

**One room with no doorway — was four.** `jw-rooms-206-207`, 36 m from the JW's
drawn 2nd-floor circulation. The other three are done, and they were three
different faults wearing the same symptom:

  - **Lucas Oil's exhibit halls and meeting rooms** were a *half-turn out*.
    Their rectangles put both in the stadium's south corner; the sheet puts
    Halls 1–2 and Meeting Rooms 1–12 in the north-east one. That is what
    happens when a rectangle is read off a plan Gen Con draws with south at the
    top and nobody turns it round — the room lands in the building, in a
    plausible place, 180° from where it is. Re-read off
    `plans/campus/level-0.png` the right way up, fitted so both stay inside the
    surveyed footprint and clear of the field's traced outline, and both now
    have doors.
  - **Exhibit Hall G** was neither a rectangle fault nor a threshold one. Its
    outline is the architect's and correct: it is enclosed by Hall F to the
    north, Hall H to the east and the outer wall on the other two sides, and
    the plan draws no circulation against any of them. Its nearest walkable
    square is 30.5 m away with 23.5 m of Hall H in between, and the crossing
    test was refusing it — rightly, by the rule it had. The rule is now that an
    exhibit hall may open through another exhibit hall, which is the building:
    the halls are one floor with air walls across it, and the booth numbers run
    straight through from the 100s to the 3000s without restarting at a hall
    boundary. `REACH` went 25 → 35 to reach across; measured over every room on
    the campus that gains Hall G's doorway and moves no other by half a metre.

**Five buildings inferring every floor change — waiting on a source that draws
their shafts.** The Crowne Plaza, the Hilton, the Omni, the Embassy Suites and
Le Méridien: 75 floor changes across the campus, 25 of them read off a drawn
shaft, and none of those 25 in these five. Both sources were measured (see the
comment in `venue-plans.mjs`) and neither shows a mark on both storeys of an
adjacent pair. The remaining idea is the campus tiles at z6 rather than z5,
which is four times the detail — and four times 1,024 tiles per level, past
`MAX_TILES`, and it needs `CAMPUS_GEO` re-derived, which the guard added in §6
will stop the run over. Worth doing only if somebody wants those five buildings
badly enough to pay for it; the routes already say the stairs are inferred.

**The forecourt hop.** Still 25–90 m of straight line between a door and the
nearest surveyed footway, at every building. OpenStreetMap `entrance=` nodes
would shorten it where they exist. It is the smallest of these.

---

## 9. Reading the booth map, and putting the stands on the ground

**What was wanted.** The exhibit hall drawn as booths rather than as six halls,
since the booth number is on every sign in the building and the hall letter is
on none of them.

### Reading it

`scripts/read-booth-map.mjs` reads Gen Con's printed exhibit-hall map, which
has no text on it. The page is 4,495 filled paths, of which 2,099 are digit
outlines. The digits are scan-filled into coverage rasters,
clustered by mean absolute difference, and ten clusters come out far larger
than the rest — 330 down to 82. Those are the ten digits; what they are was
read off a rendering of the cluster means, which is the one step a person did.

Grouping them into numbers took two corrections worth keeping:

  - **Lines by proximity, not by rounding.** Glyph baselines on one line differ
    by a hundredth of a point — "1" is not the same height as "4" — so sorting
    on the raw value interleaves the digits of a number. Rounding to a grid
    fixes that and breaks any line that straddles a boundary, which lost 89
    numbers.
  - **Advance, not gap.** "1" is 1.2 pt narrower than every other digit, so the
    *gap* after a 1 is the same size as the gap between two numbers and no
    threshold on it can separate them. The distance from one glyph's left edge
    to the next is 2.7 pt inside a number and 6.4 pt between two, which needs
    no tuning at all.

**559 of 565, or 98.9%.** The check is `exhibitors.ts` — 726 booth numbers from
a different Gen Con system, pulled on a different day, by a script that has
never seen the PDF. Nothing in the pipeline was tuned against it.

### Placing them

The map is on a strict 12 pt = 10 ft module, so it is to scale — and it is a
plan of the whole exhibit floor. That last part took two goes to get right.

**The first answer was wrong, and confidently.** The hall letters `booths.ts`
infers from the numbering do not match the building: Halls F and G come out
side by side on the sheet and are stacked in the ICC's own plans. From that it
followed that no single transform could exist, that one fitted over all 524
stands landed 73% of them in the right hall and could not do better, and that
the sheet must be six real blocks arranged for a page. So each hall's block was
laid into its own outline separately — six rigid placements chained together at
the walls — and the whole apparatus of seams, chains and a named 34 m anomaly
existed to hold that together.

**What settles it is measuring the drawing rather than reading its labels.**
The sheet draws the floor as one filled polygon. At the printed module that
polygon is 282.2 m across; the six halls together are 282.5 m. Laid down as one
rigid piece it covers them with an IoU of 0.957, against 0.831 for the next way
up, and every stand lands inside. What disagrees with the building is the hall
letters, not the drawing — and during the convention the walls those letters
name are not there at all.

`scripts/fit-booths.mjs` is now one transform: eight ways up and an offset, at
the module's true scale, which is never fitted. Three things agree on which:

  1. **The silhouette.** The carpet's outline against the halls', and that is a
     shape rather than a rectangle — a 175 m chamfer down one side and a step
     at one end.
  2. **Containment.** Every stand inside the halls. Worth nothing alone: it is
     satisfied by shrinking the sheet until it fits anywhere, which is what a
     free scale does. The scale is fixed, so it is not free here.
  3. **The aisle structure**, which the fit never uses. A booth number is an
     aisle and a position along it, and the J/K wall cuts *across* the aisles —
     so position must run north-south and aisle number east-west.

And the five **EXHIBIT HALL ENTRANCE** markers are checked, not fitted: carried
through the transform they land 0.1 to 2.7 m from a hall wall, which is where a
hole in a wall belongs. `walkable.ts` has never seen the PDF.

**Where it landed.**

```
carpet over halls                IoU 0.957   next way up 0.831
stands inside a hall             565/565     100%
along an aisle, north-south      r = 1.000
across the aisles, east-west     r = 0.980
transposed, which it must not be r = 0.31
entrances from a hall wall       0.1 – 2.7 m
overlapping stands               0
```

### Two bugs that were making the map look wrong

The user's report was that the booths "look very off" and that none of them
should overlap. Both causes were in the reader, not the fit.

**The floor is an L, and the reader cut it with a horizontal line.** `y > 300`,
commented "the grid is the upper three quarters; below it is the exhibitor
index". The right-hand third of the floor comes down 140 points further than
the left and the index fills the notch beside it, so that cut also threw away
**205 stands**. It is now a point-in-polygon test against the carpet, which the
sheet draws over the index's white background rather than under it.

**A stand's outline is four separate strips, not a rectangle.** Only some of
them come out of the content stream as one closed path, so "the rectangle
nearest this number" found one rectangle for several numbers — 150 of them
carried more than one, and **316 stands were written on top of each other**.
Nothing looks for a rectangle now: every line on the sheet is rasterised, the
digits left out of it, and each stand grows out from its number until it meets
a line or another stand. They grow *together*, which is what makes overlapping
impossible rather than unlikely — two stands can meet, they cannot pass.

Sizes are then left as measured rather than rounded to whole booths. Rounding
up is exactly how two stands sharing a wall end up inside each other; snapping
to the 12-point module was tried and put seven overlaps back, because the
numbers are printed near their stands' edges and the lattice cannot be phased
from them. Left alone, 99.4% of the measured sides land within a tenth of a
booth of whole — which makes the module something the reading *demonstrates*
rather than something imposed on it.

**And the reader now refuses to write a bad reading.** Widening the region
changed what went into the clustering, which reordered the clusters, which put
`DIGITS` out of order under them. That produced a file that was 26% right,
still parsed, still had 565 plausible entries, and said nothing. Agreement with
`exhibitors.ts` is checked before writing and anything under 95% throws. A
`--digits` flag — documented for months and never implemented — now writes the
cluster means out as a picture so the order can be read again.

**What a stand's position is worth.** The geometry is the printed plan's own at
true scale, rigidly placed: neighbouring stands are neighbours, an aisle is an
aisle, no two stands overlap, and what error there is, is one registration
error shared by the whole floor rather than something that accumulates across
it. Enough to walk to, not a survey.

**What would still improve it.** A plan of the exhibit floor in the building's
own geometry would remove the fit entirely. Short of that, the six numbers
`exhibitors.ts` does not recognise are the remaining reading failures — three
of them four-digit numbers in the 2000s that came out three digits — and each
one is a stand in the wrong place.

---

## 10. Keeping it current, year on year

Most of this data is Gen Con's and changes annually. What follows is what
refreshes itself, what does not, and what will go stale without saying so.

### Refreshes itself

| what | how | when |
|---|---|---|
| The schedule (`public/events.json`) | `deploy.yml` imports it at build time and never commits it | every Monday, and on every deploy |
| The stand list (`src/data/exhibitors.ts`) | `refresh.yml` re-runs `fetch:exhibitors` and opens a pull request if it changed | the 1st of each month |

The stand list refresh is a pull request rather than a commit because a bad
year is not obvious: Gen Con's API returning half a table, or a table for a
convention that has not been laid out yet, both look exactly like data.

Both sources are now Gen Con's own. The schedule used to come from
`gencon.eventdb.us` — one person's hobby site, scraped from HTML — which was
flagged here as the single point of failure in the whole chain. §13 is how that
was closed.

It is monthly rather than yearly on purpose. Exhibitors sign up all through the
year, so a yearly pull would be stale for eleven months of it — and nothing
here can know the date Gen Con rolls over to the next convention, so the only
way to catch it is to keep looking.

Two properties make this safe to schedule, and both are easy to lose:

  - **`fetch-exhibitors.mjs` sorts its rows and stamps no date into what it
    writes.** An unchanged Gen Con therefore produces a byte-identical file and
    no pull request. It used to write `Source: Gen Con LLC, <today>`, which
    would have opened an empty pull request every month for ever.
  - **No test asserts how many stands Gen Con lists.** Two did — `toHaveLength(846)`
    and `toHaveLength(127)` — and both would have failed on the first refresh
    that worked correctly. A check that cries wolf on every legitimate change
    gets bumped rather than read, so these now assert a floor, and the
    assertions that carry the meaning (*nothing is unplaced*) are untouched.

### Needs a person, once a year

**The exhibit hall's booths.** They are read off Gen Con's printed exhibit hall
map, a PDF published once a year, and `files.gencon.com` does not resolve from
CI. So when the new one appears:

```
node scripts/read-booth-map.mjs <the new PDF>   # -> src/data/booth-plan.ts
node scripts/fit-booths.mjs                     # -> src/data/booth-place.ts
```

Both refuse to write an answer they cannot stand behind — the reader wants 95%
agreement with `exhibitors.ts`, the fit wants its silhouette, containment,
aisle and no-overlap checks — so the failure mode is a script that stops and
says why, not a map that is quietly wrong.

The one step neither can do is `DIGITS`: which cluster is which digit is read
off a picture by a person. Run the reader with `--digits` to write that picture
out. Expect to redo it whenever the glyphs going in change, because the
clustering reorders under them.

**You will be told when this is due.** A new Gen Con's booth numbers against
last year's map drops the agreement rate through the floor in
`booth-plan.test.ts`, the monthly refresh's check goes red, and the pull request
says so in as many words. That is the reminder.

### Will go stale silently

These are hand-sourced, from somebody who has walked the building, and nothing
in the repository can tell you they have gone out of date:

  - `HALL_DIVIDES` and `ACROSS_THE_AISLES` in `booths.ts` — the booth numbers
    either side of each air wall. If Gen Con re-letters or re-walls the exhibit
    hall, every stand still gets a hall and everybody walks confidently to the
    wrong end of a building four hundred metres long.
  - The booth ranges written into room prose in `venues.ts` — `Booths 1400–2299`
    and so on. Prose, so nothing checks them.
  - `RESOLVED` in `offsite.ts` — four venues geocoded by hand.

### If the printed map ever stops being published

The booths can come from the API instead. Every exhibitor location carries a
`navigateTo` holding a coordinate on Gen Con's own interactive map, and those
are a real plan: aisle number runs with one axis at r=0.977 and position along
an aisle with the other at r=0.950. One similarity transform lays all 569 of
them on to the building at a **median of 1.6 m** against the placement read off
the printed map, 98% within 6 m, and it wants a rotation of 179.0° where the
printed map wants 180° — two independent sources agreeing.

That is a fallback rather than the primary source, because it gives a point per
*let* stand and the printed map gives every stand's footprint and the ones
nobody has taken. But it needs no PDF and no person, and it is already being
downloaded by `fetch-exhibitors.mjs` on the way past.

It is also worth recording that this repository claimed the opposite for
months — that those coordinates "sit on a star field rather than a plan" —
and that the claim was never measured.

---

## 11. Running as an app on a phone

Already a progressive web app before this: manifest, standalone display,
service worker, offline caching. What was missing was the two things that make
"install it and forget about it" actually true.

### The icon iOS was not using

`index.html` pointed `apple-touch-icon` at `icon.svg`. **iOS does not read SVG
there.** It does not warn; it falls back to a screenshot of the page, so the
thing on the home screen is a grey rectangle of map. On a phone the icon is the
app, so this was the most visible thing wrong with it.

`public/icon-180.png` is now that icon, rendered from the same SVG. Opaque and
square-cornered on purpose — iOS applies its own rounded mask, so a rounded
transparent source comes out rounded twice with pale corners. The manifest also
gained 192 and 512 PNGs and a maskable 512 with the die inside the safe circle,
because Android crops maskable icons to a circle at 80% and would otherwise
shave the corners off it.

### Picking up a new build

The worker already called `skipWaiting()` and `clients.claim()`, so a new
deploy took over "on the next load". That sounds like enough and is not: an
installed app is opened from the home screen and resumed from the app switcher,
and **neither is a navigation**. The browser checks for a new worker when the
page loads, and an app that is never closed never loads again. Somebody could
carry a build from before the convention started for the whole convention.

So `registerServiceWorker.ts` now asks on every resume and reloads once when a
new worker takes over. Two guards, and both are load-bearing:

  - `clients.claim()` fires `controllerchange` on the **first** install too,
    going from no worker to one. Reloading for that means every first visit to
    the site reloads itself in front of the person.
  - The reload happens **once**. `controllerchange` can fire again while the
    page is on its way out, and an app that reloads itself in a loop cannot be
    used and cannot easily be got rid of.

### What the end-to-end test found, which the unit tests could not

The unit tests prove `registerServiceWorker.ts` does its part — mutation-tested,
each guard caught by exactly one test. They cannot prove the browser does its
part, so this was also driven for real in Chromium: deploy a new `sw.js`, resume
the app, see whether it lands on the new build.

The first attempt **failed**, and was worth the trouble. The new worker reached
`installed` and stopped, and no amount of asking moved it — including telling it
to `skipWaiting()` explicitly. Against a minimal worker on the same browser the
same test passed, which ruled out the sandbox; against our worker with the page
not sending its hand-over message it also passed, which found the cause.

**A worker cannot be replaced while the old one has an `event.waitUntil()`
outstanding**, and `handOver` opens one to cache everything the page fetched. So
the new build waits behind it. Warm — which is the state anybody updating is
actually in — that is about **10 seconds** from resume to running the new build.
Cold, where the hand-over is pulling the shell and 9 MB of events, the same
measurement is **35 seconds**, but a first visit is not an update.

Not fixed, deliberately: bounding the hand-over would trade a few seconds of
update latency against the offline guarantee it exists to provide, and the
offline guarantee is worth more. Recorded here because "it updates on resume" is
true and "it updates instantly" is not.

### What this still is not

Nothing here gets a notification to a phone that is not running the app. Web
push exists and iOS has supported it for installed web apps since 16.4, but it
needs a server to push from, and this has no server — it is a static site on
GitHub Pages. Anything that has to reach somebody who is not looking at the app
would need one.

---

## 12. Surviving the server going away

Driven rather than reasoned about, against the built app in Chromium, with a
server that could be told to break in two different ways.

```
server up             177 rooms · 27,467 events · search   (the baseline)
server answers 500    177 rooms · 27,467 events · search
server gone entirely  177 rooms · 27,467 events · search
cold start, no server 177 rooms · 27,467 events · search
```

The last row is the one that answers the question people actually ask, and the
first three do not quite. They reload a page that is *already open*, which
leaves room to wonder how much was surviving in memory. For the last one the
browser is shut down completely between the two halves and the server is stopped
in between, so nothing survives but what was written to disk — and then the app
is opened cold, against nothing. It comes up whole, and **zero requests fail**,
because the worker answers from the cache before the network is tried at all.

Both outages, because they are not the same failure. A host that is **gone**
refuses the connection and every fetch rejects, which is the same shape as
being offline. A host that is **broken** answers 500 to everything, which is
worse: a worker that cached what it was handed would overwrite a working app
with an error page and never recover from it. `sw.js` already checked
`response.ok` before caching, so that hole was closed before this — but it is
the difference between an app that survives an outage and one an outage
destroys permanently, so it is now measured rather than assumed.

What is *not* in that screenshot is the basemap: the building plans are vector
and live in the JavaScript bundle, so they always draw, but the tiles behind
them are a third-party CDN and only appear if they were cached first.

### What was actually missing

Nothing about the strategies. **The storage they live in.** Everything the
worker caches is *best effort* by default, which is a term of art: the browser
may delete the whole origin's storage when the device is short of space,
without asking and without telling anybody. Eight megabytes of schedule plus a
tile cache is exactly the large, idle storage a browser looks at first — and it
is precisely the copy that is the whole answer when the site is not there to
re-download from.

`keepStorage()` now asks for durable storage, which is only cleared
deliberately. Three things worth knowing about it:

  - It is asked for on **every load**, not once, because a browser weighs how
    much an app is used and a first visit is the least likely moment to be
    granted. `persisted()` makes that free once it has been.
  - **The browser decides.** Chrome and Safari grant it silently to an app that
    has been installed or used enough; a fresh profile is refused, which is what
    the test above sees. Installing the app to the home screen is the thing that
    earns it. A refusal changes nothing — the app keeps the cache it had, on the
    terms it had it.
  - It is not a promise that the data is permanent. Somebody clearing site data
    still clears it.

### The one case nothing here can help with

**Getting the app on to a device that has never had it**, once the host is gone.
There is no local copy yet and nowhere to fetch one. Everything above protects a
phone that has already been here once; nothing protects a new phone, a cleared
browser, or a friend who wants a copy.

There is no code fix. The options are all "somewhere else to get it from": a
second static host, or a copy of the built app saved to the device as a file and
opened directly. The second needs no server ever again, and no account — it is
also the only one that survives the repository itself disappearing.

### A mistake in the tests, recorded because it nearly shipped

`keepStorage`'s "carries on when asking throws" test passed without ever
reaching the throw: the stub had no `persist`, so the guard on the line above
returned first. Removing the entire `try`/`catch` from the source did not fail a
single test. It was only caught by mutating the source to see which tests
noticed — which is the only thing that distinguishes a test that checks
something from a test that runs something.

---

## 13. The schedule, from Gen Con instead of from a scrape

This began as a different question — whether the app could pull events straight
from Gen Con when the site hosting it is down — and the answer to that one is
**no, and not for a reason any amount of code fixes.**

### Why the direct pull is impossible

A browser may not read a cross-origin response unless the server says it may,
and Gen Con's does not:

```
Overpass (control)      Access-Control-Allow-Origin: *
gencon.com/api/...      no such header
gencon.eventdb.us       no such header
```

The control matters. Everything external is unreachable from the sandbox this
was tested in, so a browser fetch failing proves nothing on its own — Overpass
returning the header through the same code path is what makes the absence of it
on Gen Con's endpoints evidence rather than noise.

There is no way round it from inside the app. A CORS proxy is a server, so
"works when the server is down" would then mean "works when a different server
is up". Redundancy needs a second origin; it cannot be conjured from none.

### What the question turned up instead

Gen Con has a catalogue API, and the app was not using it.
`/api/event_search` returns structured JSON with `start_date`, `end_date`,
`location`, `room_name` and `table_number` — the last three being exactly what
the room matcher needs and exactly what the scraper had to recover from prose.

The obstacle is a 10,000-record window: it pages 25 at a time and stops at page
400, against a catalogue of 27,467. `day[]` slices it, and the slices are exact:

```
day 29  Wednesday     191
day 30  Thursday    8,046
day 31  Friday      8,241
day  1  Saturday    7,805
day  2  Sunday      3,184
                   ------
                   27,467   = what the unsliced query reports
```

That identity is the method, so the fetcher checks it on every run and refuses
to write if it stops holding — a slice that grows past 10,000 would silently
return a partial schedule, and a partial schedule looks exactly like a complete
one.

### What changed, measured against the feed it replaced

```
                    scraped        API
events               27,467     27,467
resolved to a room   27,417     27,417
with roomText        27,467     27,467
with tableText       24,864     24,864
requests            ~27,000     ~1,100
```

Identical, which is the point — the same events found in the same rooms, from
Gen Con rather than from a third party, in four percent of the requests. The one
real difference was `2026-07-29T09:00:00.000-04:00`: the milliseconds are always
zero and cost 220 KB across the catalogue, on a file a phone downloads before it
can show a single session, so they are trimmed.

`scripts/lib/parse-events.mjs` and its 26 tests went with the scraper. Nothing
referenced them any more, and dead code with a passing test suite is worse than
dead code without one, because it looks maintained.

### What this does and does not buy

It does **not** make the app work when the host is down — §12 already covers
that, and the answer there is the cached copy plus durable storage.

What it removes is the most likely reason for the schedule to be *wrong or
missing in the first place*: a third party's HTML changing shape, or their site
going away. The events now come from the same organisation that runs the
convention, through an interface meant to be read by programs.

The remaining honest gap is unchanged: a first visit during an outage has no
local copy and nowhere to get one. That still needs a second origin.

---

## 14. A mirror for the schedule, on somebody else's free tier

`worker/` is a Cloudflare Worker that serves `events.json` with CORS. It closes
the one hole §12 could not: **a device that has never opened the app**, once the
site it would have come from is gone. No cache helps that device, because it has
no cache.

Nothing here is deployed. It needs an account and a login, which is the one part
that cannot be done for you — `worker/wrangler.toml` carries the six commands.

### A correction, since the first design was wrong

The suggestion this came from was that the worker call Gen Con's API itself and
hand the app one aggregated file. **It cannot.** The catalogue is about 1,100
requests and a Worker on the free plan is capped at **50 subrequests per
invocation** — not per second, per invocation. There is no arrangement of that
design that fits.

So the aggregation stays in GitHub Actions, where it already works and where no
such limit exists, and the worker is a dumb static server: the deploy `PUT`s each
snapshot, the worker serves it.

Which turns out to be the better shape anyway. A worker that talked to Gen Con
would be useless the moment Gen Con changed anything; one that holds a snapshot
keeps serving it **whether or not GitHub Actions still runs, GitHub Pages still
serves, or Gen Con's API still exists**. The failure mode is a schedule that gets
old, which is a great deal better than one that is gone.

### What it refuses

The thing it stores may be the last copy anybody ever sees, so:

  - **No secret configured means closed, not open.** A worker deployed without
    its secret rejects every upload. Treating "no secret" as "no check" is how a
    mirror becomes anybody's to overwrite.
  - **A short feed is refused rather than stored.** A fetch that half worked
    produces a feed that parses, has the right shape, and is missing most of the
    convention. Here that would overwrite the last good copy in existence, so
    anything under a thousand events is turned away and the good one kept.

### How the app uses it

Only when the bundled copy cannot be had at all — a network failure or a 5xx,
which are different failures and only one of them throws. It is a fallback and
not a race, so an ordinary load costs exactly what it did before, and a phone
with no signal is not made to wait on a second host that is equally unreachable.

Inert unless `VITE_EVENTS_MIRROR` was set at build time, so no third-party URL is
baked into a build that has not asked for one.

### What "free in perpetuity" is worth

Nobody can promise it. Cloudflare's free plan has been stable and generous for
years, which is why it is the one suggested — 100,000 requests a day and 1 GB of
KV against one 8.5 MB write a week — and it needs no card. Deno Deploy changed
its own free tier in 2025, which is the argument against picking it.

But the durability here does not rest on that promise. It rests on the worker
having no dependencies: once a snapshot is in KV, serving it requires nothing
else in the world to keep working.
