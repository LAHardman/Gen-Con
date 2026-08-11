# Gen Con Trip

A trip planner for the Gen Con convention: a real map of downtown Indianapolis
with the convention venues on it, and the event schedule attached to the rooms
those events happen in. Double-click a room to see what's on there and when.

## Put it on a phone

The app is a web page, so the easiest way onto a phone is to publish it once and
then just open the link. Nobody has to keep a laptop running.

**First, check which route applies.** GitHub Pages only serves *private*
repositories on a paid plan. If this repository is private and the account is on
the free plan, repository **Settings → Pages** will not offer a source at all —
the only Pages screen you can reach is the account-level one, which just does
domain verification. Two ways round it:

| If the repository is | Use |
| --- | --- |
| Public, or the account has GitHub Pro/Team | **GitHub Pages** — `.github/workflows/deploy.yml` is already set up for it |
| Private, on the free plan | **Cloudflare Pages**, **Netlify** or **Vercel** — all build private repositories for free |

### With GitHub Pages

1. Repository **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. **Actions → Deploy to GitHub Pages → Run workflow**.

The first run takes around fifteen minutes, because it imports the schedule from
scratch. It prints the address when it finishes:
`https://<your-username>.github.io/<your-repo>/`

After that it looks after itself: pushes to the default branch republish, and a
weekly job tops up the schedule. Event pages are cached between runs, so those
later runs are quick.

### With Cloudflare Pages, Netlify or Vercel

These connect to a private repository and build it themselves, so the code stays
private and there is still nothing to run locally. Point the host at this
repository and give it:

- **Build command:** `npm run fetch:events -- --limit 4000 && npm run build`
- **Output directory:** `dist`

They don't keep `.cache/` between builds the way the GitHub workflow does, so
every build re-imports those event pages. Drop the `--limit`, or the whole
`fetch:events` half of the command, to trade schedule coverage against build
time.

### Then, on any phone

4. Open the address the host gives you, in Safari or Chrome.
5. Tap **Share → Add to Home Screen**.

It now opens like an app — full screen, its own icon, no browser chrome. To put
it on somebody else's phone, send them the same link; there is nothing to
install and no account to make.

Note that the published site is public whichever host you use, even when the
repository is private. It is a convention map, so that is usually the point.

**What a first visit costs.** 191 KB of JavaScript and CSS, gzipped, and
442 KB of schedule — 27,467 events, which every host above serves compressed.
The schedule does not hold up the map: it loads alongside and the app is a map
before it arrives. Two things came out of that file that were pure repetition —
the importer's own `pulledAt`, which the app never read, and `url`, which is
the same thirty characters in front of a number the id already carries — and
between them they were 1.9 MB raw and 93 KB gzipped.

**It works without signal, after one visit that has it.** Gen Con is fifty
thousand people in four buildings all holding a phone, and the one thing worse
than an app that needs a network is an app that *had* the answer and threw it
away on a refresh. A service worker (`public/sw.js`) keeps two caches:

- **the app** — the page, its JavaScript, its stylesheet and the 9.1 MB of
  events — served stale-while-revalidate, so a reload answers from the cache
  immediately and fetches a fresh copy behind you. On a connection that is
  present but hopeless, waiting for the network to fail is most of the wait.
- **the map tiles**, cache-first and capped at 900, because a tile of a city
  block does not change during a convention and panning downtown at every zoom
  would otherwise fill the origin's storage quota and get everything evicted.

The JavaScript is split along the same grain — the libraries, the floor plans,
the routing graph, the room table, the stand list — because the worker caches
by URL and the filenames carry a content hash. Before that, a one-line change
to a component invalidated all 710 KB of it, Leaflet and React included; now it
invalidates 15 KB. On a *first* visit the split buys nothing (every chunk is
preloaded, and eight files cost marginally more than one); it is the second
visit it is for.

Nothing is precached by name — the built filenames carry a content hash, so a
list would be wrong on the next deploy. Instead the page tells the worker what
it just loaded. That hand-over is not a nicety: a worker does not control the
page that installs it, so on a first visit every asset goes straight past it,
and the app then *looks* cached because the browser's own HTTP cache is
answering — until it isn't. Verified by loading the built site once, clearing
the HTTP cache, going offline and reloading: the map draws, the schedule is
there, and a room opens with its sessions.

## Working on it locally

```bash
npm install
npm run events:sample   # placeholder schedule so the UI has data (optional)
npm run dev             # http://localhost:5173
```

The dev server binds to every interface, so a phone on the same Wi-Fi can open
the **Network** address it prints — useful when you are changing the app and
want to see it on a real device.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server, bound to all interfaces so you can open it on a phone |
| `npm run check` | Types and tests — the same gate CI runs |
| `npm run test` | Tests once |
| `npm run test:watch` | Tests, re-running as you edit |
| `npm run build` | Type-checks, then builds to `dist/` |
| `npm run preview` | Serves the production build |
| `npm run check:geometry` | Checks no room leaves its building or sits on another |
| `npm run plans:venues` | Re-reads the hotel hallways out of `plans/venues/` |
| `npm run plans:campus` | Fetches Gen Con's own floor-plan tiles into `plans/campus/` |
| `npm run fetch:events` | Imports the real schedule from the event database |
| `npm run fetch:exhibitors` | Re-reads the stand list — who is at which booth |
| `npm run data:distances` | Re-measures every room to every other, for the walking estimates |
| `npm run fetch:events -- --inspect` | Reports what the source site actually looks like |
| `npm run fetch:events -- --limit 500` | Stops after 500 event pages; the rest resume next run |
| `npm run fetch:events -- --no-details` | Catalogue only — fast, but events get no location |
| `npm run events:sample` | Writes an obviously-fake schedule for offline development |

`dist/` is fully self-contained and uses relative paths, so it also works
dropped on any static host, or bundled into a native shell with Capacitor if it
ever needs app-store distribution.

### Tests

Vitest, reading the same `vite.config.ts` the app is built with, so there is one
build configuration rather than two that can drift. Tests sit next to the code
they cover as `*.test.ts` / `*.test.tsx`, and jsdom is the environment
throughout — the pure modules don't care, and the components and hooks need a
document.

`npm run check` is what CI runs on every push and every pull request: types,
then tests, before anything is built or deployed.

Covered today: the directions feature and everything under it
(`navigation.ts`, `route.ts`, `walkable.ts`, `vertical.ts`, `geo.ts`,
`useDeviceLocation.ts`, `useWarmCampus.ts`), the searching (`search.ts`,
`SearchBar`), the drawing (`MapView`, `NavPanel`, `RoomDialog`), the app's own
state (`App.tsx`), the import, and the generated data tables — `connections.ts`,
`venue-plan.ts`, `pavements.ts`, `exhibitors.ts`. Those tables are keyed by
strings a human wrote (`icc/Level 2`), and a key naming a floor its building
calls something else draws *nothing*, silently, which looks exactly like a
sheet that was never read. So the tests assert the keys resolve, and they
assert it against the tables rather than through the lookups that filter bad
keys out — a check made through the lookup cannot fail.

**The map is tested on the DOM Leaflet produced.** Everything `MapView` does is
imperative Leaflet inside effects, and Leaflet fails by drawing *something*: a
layer never added, a shape on the wrong pane, a handler bound to the wrong
thing — none of them throw and the map still looks like a map. Every layer,
class and handler is real. The taps matter most: there are three meanings for a
click — open a building, open a room, answer the question the directions panel
is asking — and the third silently changes the other two.

What jsdom cannot give is a **size**: every container is zero by zero, so
Leaflet picks a zoom out of nothing and every room comes out big enough to
label. So the rule deciding that — zoomed in far enough, *and* big enough on
screen, *or* the room you have tapped — is asked directly, on a map built to
put a given room at a given pixel size. That is not a way round the limitation;
it is the only way to put a case either side of a threshold, and it is what
catches width and height being swapped, or the pair of them collapsing into a
test of area.

**The router is tested twice over, and the two are not interchangeable.**
`route.test.ts` runs over the real campus and asserts the properties a route
must have; it is what catches regressions, and it localises nothing — a break
in A\* reads as "the JW is unreachable". `walkable.toy.test.ts` and
`vertical.toy.test.ts` run over floors drawn in the test file, small enough to
count the answers by hand: a corridor bent into a U, two squares meeting at one
corner, a speck of trace noise, a staircase read twice from two storeys. Every
assertion in both is mutation-tested.

**The import is tested too, against real pages.** The HTML scraper and the room
matcher both fail by quietly returning `null` rather than by throwing, which
made them the riskiest code here: a source redesign that renamed one row label
would drop that field from every event and the run would still report success.
`scripts/lib/parse-events.test.mjs` runs against three pages saved off the live
site under `__fixtures__/`, and `src/data/events.test.ts` runs the matcher over
every one of the twenty-two distinct `Location` strings a full import contains.
Vitest's `include` covers `scripts/**/*.test.mjs` for the first of those, so
the scripts are tested where they live.

**The importer's four decisions about its own cache are tested too**, which
took extracting them: `fetch-events.mjs` takes a lock and starts fetching on
import, so nothing in it could be called from a test without that happening.
`scripts/lib/import-plan.mjs` now holds what a run may keep, where a full pull
resumes from, whether it may say it finished, and which fields the feed carries
— all pure, all silent when wrong, and in different directions. Keeping too
much means a full pull that refreshes nothing; too little means one that can
never finish; finishing early means events skipped for good; and shipping the
wrong fields means either a bigger download for nothing or a room that has
quietly gone blank.

**The warm-up is tested by counting the work, not the answer.** Whether the
router resumed a half-built graph or threw it away and started again is
invisible in the route — same legs, same metres, twice the time — so
`useWarmCampus.test.ts` counts grid searches instead, and asserts that the
build is divided finely enough to be interrupted at all.

**The search is tested on order, not membership**, since that is where it goes
wrong invisibly: the list is full, every entry is a real room, and the only
sign is that you keep looking past the first one. Written against the real
rooms rather than a fixture, because the cases that matter are collisions the
campus actually has — two buildings that both number a room 104, a hotel with a
Grand Hall and a Grand Bar, a theatre whose street address begins 140. That
last one was a live bug the tests found: typing `140` offered the Indiana
Repertory Theatre above the convention centre's Meeting Room 140, because an
alias *prefix* scored better than an exact alias.

**The service worker is driven directly**, in `src/sw.test.ts`: it is loaded
into a scope built for the purpose and its handlers are called. More machinery
than a test usually deserves, and it is there because caching *nothing* leaves
an app that works perfectly — online — right up to the reload that matters. It
found its own bug: `cache.add` refuses a cross-origin tile, because it insists
on a readable 200 and an opaque response reports status 0, so the tile cache
stayed empty while every other cache filled.

**The plan build refuses rather than warning.** `plans/campus/` is gitignored,
and a rebuild without it wrote a `venue-plan.ts` that parsed, type-checked and
rendered while missing ten floors and the convention centre's staircases —
the quietest failure here, because its output is a valid file. It now exits 1
and leaves the old file alone, naming every floor that would have gone;
`--without-campus` is the way to mean it. The decision is `refuseToWrite` in
`scripts/lib/plan-sources.mjs`, kept out of `venue-plans.mjs` because that
script reads and writes on import and could not otherwise be asked.

## The map

The basemap is real: live tiles of downtown Indianapolis, with real streets and
buildings, rendered through [Leaflet](https://leafletjs.com/). Three key-free
tilesets are wired up (CARTO dark, light and Voyager) and switchable from the
header. Each carries the attribution its terms require — Leaflet renders it in
the corner, and it must not be removed.

**The street names are drawn on top of the buildings, not under them.** Each
tileset is taken in two halves — the map without its writing, and the writing on
its own — and the second is drawn above everything the app puts on the map. It
has to be: the rooms and floor plans are opaque enough to bury a street name,
and once you have zoomed into a building the streets around it are exactly what
you need to leave it by. Taking the split tileset rather than adding names over
a map that already has them is also what keeps every name drawn once.

They arrive at zoom 17, not before. Over the whole campus a full set of street
names is a screenful of type telling you what you already know — that this is
downtown Indianapolis — and it buries the buildings, which at that zoom are the
only thing there is to pick.

That is why the third option is CARTO's street rendering rather than
OpenStreetMap's own raster, which it used to be: OSM's bakes its names into the
tile, so there is no way to lift them clear of the buildings. Same data either
way.

**And the lines are drawn to be followed.** A dark tileset puts its streets a
few percent off its own background, which vanishes under a map with this much
drawn over it, so the dark basemap's contrast is lifted as a whole — the roads
are somebody else's raster and can't be restyled one line at a time. The plan's
own lines are heavier to match: a corridor's edge and a building's outline each
read at the zoom you would use them at.

**A room is a wash of colour, not a box.** The colour says what sort of room it
is; the floor plan underneath says where the walls are. It used to be outlined
in a bright version of the same hue, which welded a run of meeting rooms into
one loud shape and buried the drawing it sat on. Now the fill is muted and the
outline is the map's own background — so where two rooms of a sort meet you see
the seam between them rather than one block with a line in it.

| Gesture | Result |
| --- | --- |
| Drag / one-finger drag | Pan |
| Scroll wheel or trackpad | Zoom |
| Pinch | Zoom |
| Click / tap a building | Open it, and go there |
| Click / tap a room | Open its details and schedule |
| Click / tap the map | Close the building again |
| Type in the search box | Find a room or an event |
| The arrow in an open room's title bar | Directions to that room |
| Click anywhere while directions are asking | Use that room, or that point, as an end of the route |

**Buildings keep their insides to themselves until you open one.** Fourteen sets
of rooms over one downtown is a mess nobody can read, and at the zoom you see
the whole campus at, none of them are legible anyway — so the campus view is
buildings, streets and skywalks, and clicking a building takes you into it and
draws its rooms, its floor plan, its restrooms and its floor picker. Clicking
the map puts it away.

Leaflet's double-click-to-zoom is deliberately disabled, and a room opens on one
click. There is nothing else a click on a room could mean, and making people
find that out by double-clicking helped nobody.

**Nothing should vanish while you drag.** Leaflet draws every vector into one
SVG sized to the screen plus a margin, and redraws it only when a drag ends — so
at the stock margin of a tenth of the screen, any real drag runs off the edge of
what was drawn and the rooms disappear until you let go. The whole campus is a
few hundred shapes, so the margin is six-tenths instead, over three times the
area, which outruns a drag for what it costs. The tiles keep a wider ring of
neighbours for the same reason.

### Search

The box in the header searches rooms and events together as you type, and
picking a result flies the map to that room and opens it — so an event result
takes you to the place it happens, which is the only thing you can actually
walk to.

Rooms match on everything they are called: the name, the short name on the map,
and every alias the schedule uses. So `104` offers the JW's rooms 101–104 *and*
the convention centre's 101–117, because both buildings have one, and guessing
between them would be worse than showing both. Events match on title, and the
same title running twelve times in one room collapses to one result that says
so rather than twelve identical rows.

Ranking is by how the match was made — a room whose name starts with what you
typed, then an exact alias, then a word inside a name, then event titles — and
ties break on the shorter name. Arrow keys move, Enter picks, Escape closes.

### Who is at which booth

`npm run fetch:exhibitors` reads Gen Con's own exhibitor browser —
`https://www.gencon.com/api/v1/exhibitor_profiles`, public and paginated — into
`src/data/exhibitors.ts`: **845 locations, 779 exhibitors, 793 of them
numbered**. One row per *place* rather than per exhibitor, because a publisher
with four booths, a demo hall and a meeting room is six places somebody might
be looking for.

Each row also keeps the id its description is fetched by and Gen Con's own tags
for it — 792 of the 845 carry at least one, out of a vocabulary of 116, stored
as indices into a shared list because the strings repeat and 47.8 KB of them
becomes 12.3 KB. The importer additionally opens the per-exhibitor record for
**Food & Drink** alone, which is where the vendor's own website is; that is 43
extra requests rather than 845, and it is the only group whose own page is worth
linking to instead of gencon.com.

`area` and `spot` are Gen Con's own words, split on the spaced colon it writes
them with — `Exhibit Hall` / `Booth 1637`, `ICC : Hall B` / `Archon Studio`,
`Block Party` / `Food Truck 3`. Not on any colon: at least one exhibitor has an
unspaced one in its name, and splitting on that files Wizards of the Coast
under "the Gathering".

**Search knows the names.** 47 of those locations name a room the map draws,
and they name it in the same words the schedule does, so the same matcher reads
both — Halls A–E, the two meeting-room blocks, the Sagamore Ballroom and Lucas
Oil's West Club Lounge. Typing "Asmodee" finds Hall E and Room 233. Exhibitor
names rank *below* a room's own names, so "hall b" still finds Exhibit Hall B
rather than the thirteen publishers standing in it.

**Three places the stand list names that no plan draws.** Community Row is the
hallway outside the Sagamore Ballroom; the Makers Market is the connector
between the convention centre and the stadium; the Block Party is South Street,
closed to traffic. None of the three is a room on any floor plan, so each is
constructed — but constructed out of geometry that already exists rather than
placed by eye, which is the difference between drawing it and guessing it:

| | drawn as | out of |
|---|---|---|
| Community Row | a 94 × 5.7 m corridor on Level 2 | the gap between two blocks the plan *does* draw — the Sagamore stops at y 50.4, the 201–212 rooms start at y 56.3 |
| Makers Market | a venue of its own | the convention centre's OSM footprint carries a 23 × 119 m arm south to the stadium that its floor plans leave out; this is that arm |
| Block Party | a venue of its own | the two pavements OSM maps either side of West South Street, way/1229666665 and way/667563570 |

The Block Party is the one venue here that is not a building, and the room
pop-up says so: the kerbs are surveyed but how much of the street the closure
covers is not published anywhere, so the block drawn is the block the party is
named for. `NOT_A_BUILDING` in `venues.ts` is what makes it say that.

**The other 573 say `Exhibit Hall : Booth N`, and there are eleven exhibit
halls.** No source names one. The schedule does it twice in 27,467 events and
never otherwise; the map API's coordinates sit on a star field rather than a
plan; and Gen Con's own printed exhibit-hall map letters no hall on it. It has no
text on it at all — its numbers are outlines — but 565 of them have since been
read and every one placed, as one rigid piece: see §9 of `docs/next-steps.md`.

The letters are worth being careful about, because the drawing and the
numbering disagree and the drawing is right. Halls F and G come out side by
side on the sheet and are stacked in the ICC's own plans, and a good deal of
machinery was once built on the assumption that this made the sheet a page
layout rather than a plan. It is a plan: its floor outline is 282.2 m across
against the halls' 282.5 m. During the convention the walls those letters name
are taken out anyway, which is why the map draws the booths and not the halls.

What closed it is five divides — the booth numbers either side of each air
wall, from somebody who has walked the hall. `src/data/booths.ts` holds them,
and holds the checking with them, because a table like that reversed does not
fail: every booth still gets a hall, every hall still has booths, and everybody
walks confidently to the wrong end of a building four hundred metres long. The
two rows where the schedule *does* name a hall are at opposite ends of the grid
and both agree; read the other way round, one of them lands in the wrong hall.

Four of the five walls run *between* aisles, so an aisle is wholly in one hall.
The fifth does not. Halls J and K are stacked one behind the other at the same
end of the building, so the wall between them cuts every aisle in the 100s-to-
500s stretch in half, and a booth's hall there depends on how far *along* its
aisle it stands rather than on which aisle it is. It was given as the two
places it crosses — between 331 and 339, and between 429 and 439 — and booth
174, the one the schedule calls Hall J, is what fixes which side is which.

That took events resolving to no room from **130 to 50** of 27,467, and stands
placed on the map from **47 to 621** of 846 — every one of the 573 in the
exhibit hall. Searching "Kenzer" now finds Exhibit Hall I. Placing Community
Row, the Makers Market, the Block Party and Hall I's three blocks of tables
took it to **every stand Gen Con lists**. The test for that asserts the
*unplaced list is empty* rather than a total, so it stays true across a refresh
that adds ten more — which is why the figures above are a past run's and the
current count is 845.

### Getting between buildings

Downtown Indianapolis is stitched together above ground, and in August that is
not a curiosity — the skywalks are how most people get from a hotel to a game
without going outside, and none of it shows on a map of the streets. So the map
draws them, as a dashed line over everything else, with the tunnel running south
from Union Station drawn the same way in a colder colour.

Be clear about what these are: the **spans**. OpenStreetMap has each bridge and
the tunnel as a way of its own, but not the corridors inside the buildings that
join them up, so this is not a route you can trace end to end. It is where a
covered crossing exists — which is the part you can't work out by looking at the
street. `src/data/connections.ts` has the query that produced them and the OSM
way id of each, so any of them can be checked.

**They belong to a floor.** The network runs at the second level throughout, so
a span drawn across a building you have open is either the way to the next hotel
or a line over your head — and which one it is depends on the floor you are on.
So an open building draws only the spans that reach it, and only while it is
showing the floor they reach it on: the convention centre's five appear on Level
2 and none on Level 1. With nothing open they all draw, because that view is the
campus and where the covered crossings are is the most useful thing on it. The
floors are named building by building in `connections.ts`, since every building
names them differently — the convention centre's skywalk level is its Level 2,
Union Station's is the mezzanine over the Grand Hall.

**Some of them land on a car park.** Four spans reach exactly one Gen Con venue
and used to join nothing, which left the JW Marriott and the Hyatt Regency with
no covered route anywhere — and that looked for a while like missing data. It
was not. Each of the four comes down on a multi-storey garage that a second span
carries on from: the JW's on the Government Center's, the Hyatt's on the World
of Wonders. That is what these bridges were built for, so the garage is the
middle of the chain rather than the end of it. `LANDINGS` in `connections.ts`
holds those footprints — a building a route passes through and nobody is going
to. There is no plan of the inside and no floor to name, so the crossing is a
straight line and the direction says so: "Through the Government Center car
park".

Inside a building the map draws the **hallways** — the prefunction space and
corridors, as open floor a shade lighter than the fabric either side. Those used
to be styled as the gap between the rooms and were nearly invisible, which is
backwards: on a map for finding your way to a game, the corridor is the route
and the rooms are what it passes.

The convention centre's come free, from the same PDFs its rooms do — one of the
colours its legend keys is "Prefunction / Hallways". Nothing else on the campus
has a PDF. What there is instead is Gen Con's own plan of each hotel as a
picture, and those are drawn to a palette just as strict, so `venue-plans.mjs`
reads them the same way from pixels: pale cream is what you walk on, tan is a
room you can book, darker brown is back of house. Fourteen floors across eight
hotels come out of it, plus the JW Marriott's ground floor.

Reading them by colour rather than by eye is the point. A corridor is three or
four metres wide and the room rectangles in `venues.ts` are good to about five,
so anything traced by hand would look precise and be wrong at exactly the scale
it is read at. Colour is not a judgement call, and neither is the fit: Gen Con
draws with south at the top, so the whole transform is a half-turn, a uniform
scale and an offset — three unknowns, fitted against the building's own surveyed
footprint by sweeping and then refining on overlap. The script prints what it
got, and it lands between 76% and 89% of the footprint on every sheet.

```
node scripts/venue-plans.mjs              # all of them, writing src/data/venue-plan.ts
node scripts/venue-plans.mjs westin-2     # one, with its fit reported
```

Each hall is a polygon with holes: a hotel floor's circulation is one connected
thing that runs around the rooms, so drawing only its outside would cover them
over. Sampled afterwards, 90–100% of what is drawn falls inside the building it
belongs to on thirteen of the fourteen floors — Union Station is the exception
at 76%, because its plan draws the train shed and its OpenStreetMap footprint
does not.

**The same reading also tightens the rooms — where it can prove it should.** The
plans colour the rooms as well as the halls, so a room's hand-placed rectangle
can point at the shape drawn underneath it and take that instead. Fed in
straight, that made the map worse rather than better: `check:geometry` went from
clean to twenty findings, thirteen rooms poking out through a wall and seven
pairs newly on top of each other. The plan and OpenStreetMap are two independent
tracings of one building and they disagree at the edges by a metre or two, so a
shape that reads better against the drawing can read worse against everything
else the map draws.

So a traced outline has to earn the swap. It is taken only when it is no worse
than the rectangle it replaces on the two things that go visibly wrong — leaving
the building, with no slack at all because the footprint is surveyed, and
landing on the room next door, with a wall's thickness of it. **16 of 94 rooms**
clear that bar, and the check is clean afterwards. The rest keep their
rectangles and the script says why for each: mostly *spills further outside the
building than its rectangle does*, sometimes *would sit on the room next door*.
A ballroom the plan draws as one space with three authored sections in it is
refused earlier and for a different reason — one outline shared three ways would
be three rooms the map could no longer tell apart.

**The sheets need not be tidy.** Some of them are phone screenshots of Gen Con's
online map, statusbar and all, and the classifier does not care: the palette is
the palette, and anything that isn't one of the five colours — street, park,
browser chrome — never enters the fit. What a sheet does have to do is frame the
whole building, because the fit is against the whole footprint; a screenshot of
half a floor cannot be placed.

**There is a better source than screenshots, and the fetcher for it is here.**
`gencon.com/map` is a Leaflet map like this one, and it serves its floor plans
as a tile pyramid — one set per campus level, 256-pixel squares, at
`<cdn>/maps/v9/floor-<level>/<z>/<x>/<y>.png`. That is the drawing itself:
whole, at one scale, every floor in one frame, rather than a screenshot cropped
and scaled by whatever was holding the phone. `npm run plans:campus` fetches and
stitches it, and `venue-plans.mjs` reads the result exactly as it reads a
screenshot, because the fit solves for scale and offset either way.

It probes for the zoom levels and tile ranges rather than assuming them, caches
every tile, and asks for four at a time with a pause between — it is somebody
else's CDN. Set `GENCON_TILES` to point it elsewhere.

Nine floors come from it: the JW's three, the Hyatt's, the Hilton's and Le
Méridien's 1st, the Embassy's 2nd — which is its street entrance, lettered so on
the sheet — and all three of Lucas Oil's. The JW's 1st floor is taken from here
rather than from its own screenshot even though that is four times finer,
because a fitted sheet and a georeferenced one are two different placements of
the same building: with its 1st fitted and its 2nd georeferenced, the two
readings of its main escalator landed 14 m apart, the floors overlapped by 32 m²
in all, and no staircase could be found between them at all. **A campus sheet is clipped to
the venue's surveyed footprint before anything is traced from it**, because it
draws a mile of downtown rather than one building: unclipped, the JW's 2nd floor
came out as every cream corridor from Georgia Street to the stadium, nine times
the hotel. The pixels are cut rather than the finished shapes, since a corridor
running from one building into the next is one component either way.

**Nothing is invented to fill a gap.** Three floors have no sheet, and all three
belong to venues Gen Con does not colour as its own — the Indiana Rep, the
escape room, Circle Centre. They show their rooms and no corridors, which is
what their source supports.

### Floors

A flat map has one surface and a building has several, and the rooms on them
land on top of each other: the convention centre's 201–212 sit directly over
101–117, and the JW has three floors of meeting rooms in one stack. So an open
building draws **one floor at a time**, and the picker on the right of the map
changes which. It appears with the building and names it, because "2nd floor" on
its own doesn't say whose. The floors you aren't on are left as ghosts: faint
enough not to read as rooms, present enough to say there is more here than one
storey.

A building opens on its **ground floor** — where you would come in from the
street, and where the picker's own list starts. Each building holds its own
floor while it is open, and anything that takes you to a room takes you to that
room's floor instead: clicking it, or picking it out of the search box.

Note that a floor here is a floor of *that building*. Gen Con's own level
switcher numbers campus event levels instead, so its "level 3" is at once the
JW's 3rd floor, the Hyatt's 3rd, the Embassy's 5th and the Hilton's 9th.

### Restrooms

Marked with a **WC** dot, and toggled from the legend. They come from two
places, and the difference matters:

- **The convention centre's are measured.** Its plans key spaces by colour and
  one of those colours is "Restrooms", so `plan-geometry.ts` already held 25 of
  them as real outlines — the map just puts a mark in the middle of each.
- **Everywhere else's are read off Gen Con's plans**, which draw a pictogram
  rather than a shape, so the mark is where the pictogram is. Same schematic
  grade as those buildings' rooms.

They follow the same floor rule as the rooms: only the floor a building is
showing has its restrooms drawn, because a toilet on the wrong storey is not a
useful direction.

**A pair gets one mark, put between them.** A plan draws the men's and the
women's as two rooms, because they are two rooms — but they are one place to go,
off the same bit of corridor, signed together, and two marks a few metres apart
answer a question nobody asked. The threshold comes from the drawings: measured
across the convention centre, the distance from a restroom to its nearest
neighbour falls in two lots, 23–29 m for a pair either side of one entrance and
34 m and up for the next facility along the concourse. Thirty metres sits in the
gap between them, and takes the campus from 43 marks to 35.

**Water fountains are not marked, and that is not an oversight.** No plan shows
them. The convention centre's legend has four categories and water is not one;
its drawings carry no `fountain` or `water` label anywhere; Gen Con's own map
draws no such icon. Rather than scatter plausible-looking dots, the map marks
none — `AmenityKind` already allows for water, so the day a source turns up the
entries drop straight into `src/data/amenities.ts`.

### Your own schedule

The **Schedule** tab is the four days of the convention — Thursday to Sunday —
with what you have committed to on each of them, drawn to scale.

**Why a timeline rather than a list.** A list of times can be read; it cannot be
*seen*. What ruins a Saturday is not forgetting an event, it is two of them that
do not fit together — a four-hour game ending at one and a seminar starting at
one in the JW Marriott, six minutes' walk away. On a list those are two tidy
rows. Drawn to scale, with the walk drawn in front of the event it is a walk to,
the gap is either there or it is not.

So each entry is two blocks. The **solid block** is the event, as long as the
event runs. The **lighter band** immediately before it is the walk from the
previous entry's location, occupying exactly the minutes you would be walking —
it is lighter because it is not the commitment, it is what the commitment costs.
Where those minutes are already spoken for, both turn amber and the entry says
so: that is worth knowing on the Wednesday rather than at one o'clock on the
Saturday.

**All four days share one ruler**, measured in minutes past midnight rather than
in milliseconds, so ten o'clock on the Thursday is the same height as ten
o'clock on the Saturday and the four columns scroll together. Four separate
rulers is what this was, and it made the columns incomparable — which defeats
the one thing a four-day view is for: seeing that every morning is committed and
every evening is free. Minutes past 1,440 are allowed, so a game running from
eight until two belongs to the day it started and is drawn continuing off the
bottom of it rather than wrapped round to the top.

The walking times come from the distance table above — the same estimate the
search results show, extra minute included — not from the router. A dozen
entries redrawing on every tick of the clock cannot each afford a 128 ms route.

**Which four days, and which one it is.** Thursday to Sunday, read off the
weekday rather than written down as dates: Gen Con's dates move every year and
its weekdays never have. Wednesday's Trade Day is deliberately out — 191 events
against Thursday's 8,046 — and sessions on it are not offered in the add
search either, because there would be no column for them to land in.

Today's column is marked, and a line across it shows the current time. Both
answer in *Indianapolis* time, taken from the offset the feed's own timestamps
carry: somebody planning from California at ten on Wednesday evening is already
in Thursday where they are standing, and highlighting Thursday for them would
be a day out.

**Adding things.** Two places, and both offer individual *sessions* rather than
titles. The Schedule tab's own search looks across the whole feed; a room's
dialog has a `+` on every session it lists. That distinction matters: the map's
search deliberately collapses eight showings of one game into a single result,
which is right for "take me there" and wrong here, where the whole question is
which showing.

Choosing one opens it in full rather than adding it. A title and a room is not
enough to decide by: whether it costs forty dollars, whether it is 21+, whether
any tickets are left, whether it runs six hours — all of that is in the feed,
none of it fits on a result row, and every one of them is a reason not to add
it. From there you can add it, show it on the map, or start directions to it.

**And a schedule is not only sessions.** Lunch is a commitment, twenty minutes
at a stand is a commitment, and both of them cost the same walk a seminar costs.
So the Schedule tab's search carries the same **Everything · Events · Food ·
Vendors · Places** row the map's does, and choosing anything but a session opens
a small form instead of adding it, because a food truck has no times of its own:
which day, from when, to when. Everything downstream treats what comes out
identically — the walk to it, the block on the day, the clash with the thing
before.

The suggested start is *the end of the last thing already on that day*, rounded
up, because somebody adding lunch to a Saturday with a game running until one
means lunch after the game, and offering them noon makes them redo arithmetic
the page has already done. An end before its start is read as the next morning:
`<input type="time">` hands back a clock and a clock has no date on it, so 11pm
to half past midnight arrives as 1380 → 30, and refusing it would refuse the one
span most likely to be typed at a beer garden.

**Where hours are known they are checked, across the whole span.** The mistake
worth catching is not a locked door at nine in the morning — that one is obvious
— it is planning to eat from half past eight until half past nine at a truck
that shuts at nine, which a check on the start time alone calls fine. It **warns
and does not refuse**, and says which year it is warning from: the only hours
that exist anywhere reachable are 2025's, and refusing a plan on last year's
numbers would refuse a correct plan the moment they change. A vendor nobody
publishes hours for says exactly that, rather than staying quiet and letting "no
warning" mean two different things.

The same truck can go on twice — breakfast and dinner are two commitments — so
an entry's id carries its start time as well as what it is, and removing one
leaves the other alone. Adding the same place at the same minute twice still
collapses to one, which is what a double-tap should do.

**A block on the day has no buttons; the block *is* the button.** It used to
carry a "Map" and a "Remove" of its own, and on a twenty-minute stop — twenty-six
pixels tall in a column a quarter of a phone wide — those two links were the only
thing that fitted, so the block read "Map Remove" and never said what it was.
Now it opens what it is, and the map and the removal live in that panel.
Removing something from a schedule is not an action to be one mis-tap away from
either. That panel reads from the *copy* the plan holds rather than looking the
event back up, so it opens underground, and next year. A planned food stop keeps
the link to the truck's own page there too — the nearest thing to a menu that
exists anywhere, looked up from the bundled catalogue by the id in the entry, so
it is there with no network at one o'clock on South Street.

**Two things at once are drawn side by side.** Overlapping blocks used to be
drawn on top of each other and the shorter one simply disappeared — survivable
while everything came from the feed, and not survivable the moment somebody can
type their own times, because "twenty minutes at a food truck during a four-hour
game" is an ordinary thing to plan and the whole point of drawing it is to see
that it does not fit. Lanes are shared across the *run* of overlapping entries,
so one clash in the morning does not narrow the afternoon, and the overlap is
measured at the height a block is actually drawn rather than the minutes it
holds — two blocks that only overlap once drawn are still two blocks on top of
each other.

**The description is asked for, not assumed.** Gen Con's descriptions run to a
paragraph each; across 27,467 events that is several megabytes on a file a phone
fetches before it can show anything, so the feed drops them. A **Show full
description** button fetches that one event through the same same-origin proxy
the room check uses. Nothing spends that request until it is pressed — opening a
panel on a phone in an exhibit hall should not fetch a paragraph nobody asked to
read, and there the request is as likely to hang as to answer. Where the browser
reports no network it says so instead of spinning.

**And what you commit to is kept.** Adding an event to the schedule fetches its
description once, in the background, one at a time, and stores it with the
entry — so a planned event opens with its description already there, instantly
and with no network at all. That is the whole point: the schedule is what you
read *at* the convention, and an exhibit hall with sixty thousand people in it
is the worst signal on the campus. A dozen descriptions for the dozen events
somebody chose is a few kilobytes, against megabytes for all of them. An event
that genuinely has none is stored as empty, so it is never asked for twice.

### Filtering the catalogue

Both searches filter and sort, over the same controls, because it is the same
question asked in two places. A title search alone answers "is there a thing
called that"; the question in front of somebody planning is narrower — what is
on **Saturday afternoon**, runs **under three hours**, costs **nothing**, and is
**in the convention centre**, and of those which starts soonest.

**What kind of thing, first.** Above everything else is one row —
**Everything · Events · Food · Vendors · Places** — and it decides what the rest
of the panel even means. A cuisine is not a question you can ask of a seminar
and a ticket price is not one you can ask of a taco truck, so rather than nine
controls of which four are dead, the panel shows the ones that belong to
whatever is being looked for. Choosing a kind clears what was asked of the last
one: a day filter left on while switching to Food would silently narrow a list
that has no days in it.

The kinds are exclusive on purpose. Somebody who has pressed **Food** is not
asking whether a room happens to be called that, and mixing the two would put
Exhibit Hall F above a taco truck for the query "f". Choosing one is also a
whole question on its own — 43 vendors is a list you browse, not one you type
at — so the results open on a kind alone, with nothing typed. It is not counted
on the **Filters** button, though, because it hides nothing: a "1" there would
claim something was being held back.

The Schedule tab carries the same row — see **Your own schedule** above for what
happens when you pick something with no times of its own.

**Each kind gets the filters that can be true of it.** This is the whole point
of the row, and getting it wrong is invisible: Vendors and Places used to be
shown the *event* panel, so a booth was offered a day, a ticket price and an age
limit — dimensions that could only ever be false of it — and touching any one of
them emptied the list. That looks exactly like a search that found nothing.

| Kind | What it filters on |
| --- | --- |
| **Everything** | the event dimensions; any of them silences rooms, stands and addresses |
| **Events** | day, start time, length, type, cost, tickets left, age, game system, building, room — and sort by start, end, length or cost |
| **Food** | cuisine (12), dish (26), dietary (5) |
| **Vendors** | sort of stand (7), where (15 areas), tags (74) |
| **Places** | building (16), floor — offered from the buildings already chosen |

Every one of those numbers is read off the live catalogue rather than written
down, so a value Gen Con stops using stops being offered and one it adds appears
without anybody editing a list.

**Vendors: what it is, where it is, what it sells.** The eight kinds are Gen
Con's own word for the sort of stand — Exhibitors (622), Artists (90), Food &
Drink (43), Authors (39), Makers (22), Community Groups (19), Entertainers (8),
Sponsors (2) — and Food keeps its own panel, so Vendors is the other seven. The
areas are also its own words, from `Exhibit Hall` (572) down to `Stadium : West
Club Lounge` (1). The tags are a vocabulary of 116 across the catalogue, 74 of
them outside food, from `Publisher` (347) and `Board Games` (301) down to the
one-offs — which is not a row of buttons on a phone, so that one is a list and
one at a time, for the same reason the game system is a text box. A vendor's own
panel prints them in one row, unsplit: the food tags are filed into cuisine,
dish and dietary because somebody looking for lunch is asking exactly one of
those three, and a stand's are what it is (`Publisher`, `Retailer`), what it
sells (`Board Games`, `Apparel`), what genre (`Fantasy`, `Horror`) and who runs
it (`LGBTQIA Plus Owned`) — four labels Gen Con has not written and nobody has
checked.

**Places: a building and a floor.** The floors are Gen Con's own words too, and
they disagree between buildings — "Level 1" in the convention centre, "1st
floor" in the JW, "Concourse level" at the stadium. One list of all sixteen
would be sixteen strings meaning about six things, so the floor picker offers
only the floors of the buildings already chosen, exactly as the room picker
does. The buildings come from the *rooms* rather than from the feed: the
Connector, Circle Centre and the Block Party hold rooms the map draws and no
sessions at all, and a filter for places that could not offer them would be
hiding places from a search for places. A street address has neither a building
nor a floor, so either filter drops every address — the same rule as an event
filter dropping a room, one level down.

**Food: cuisine, dish, dietary.** Gen Con files every exhibitor under tags of
its own and all 43 Block Party vendors carry them, but the 49 tags in use are
three different questions wearing one coat: what kitchen it is (Korean,
Venezuelan), what comes out of it (Tacos, Crepes, Burger), and what you can
actually eat (Vegan, Gluten Free). Somebody looking for lunch is asking exactly
one of the three, and no rule reads them apart — "Southern" is a cuisine,
"Soulfood" is arguably both, "Quick Eats" is neither — so every tag is placed by
hand in `food.ts`. A tag nobody has filed still shows on the vendor and simply
gets no chip, which is the right failure for a list somebody else edits: next
year's new cuisine appears on the trucks that have it and waits to be filed
rather than vanishing.

**There are no menus, and no amount of work here would produce one.** Gen Con's
API carries no dishes and no prices; the per-exhibitor description is, for 19 of
the 43, the words "Visit us at Gen Con Indy 2026 at Block Party on South
Street". What each vendor does have is its own website, so a vendor's panel
links there instead of to gencon.com — for 15 of them that is a Facebook page,
which is where a food truck actually posts what it is cooking. The same **Show
full description** button is there, reading the exhibitor record rather than the
event one.

**And the hours are last year's, and say so.** They are not published anywhere a
program can reach: no hours field on the exhibitor listing or the per-exhibitor
record; `/api/v1/hours`, `/venues`, `/areas` and `/exhibit_hall_hours` all 404;
the `block-party-street` room has *zero* events, so there is nothing to derive a
span from either. The one place hours appear is the Block Party page on
gencon.com — inside an HTML comment, left over while the 2026 page is written.
Scraping it without checking would have shipped 2025's times as this year's. So
they are written down in `food.ts` in Gen Con's own words with the year attached,
and the panel prints that year: `Thu–Sat 9am–9pm · Sun 9am–4pm (2025 hours)`.
The beer garden keeps its own, which are different. Everywhere else — the
exhibit hall included — gets no hours row at all rather than a guess.

Filter by day, start time, length, type, cost, tickets remaining, age, game
system, and building or room. Sort by start, end, length or cost. A filter is a
question in its own right, so a filter with no words typed opens the list —
"everything free on Saturday" has nothing to type.

**Every option says how many results pressing it would leave**, and the numbers
move as you narrow. Without them a filter list is a list of guesses: press
"Escape Rooms", get nothing, press it again, try "Saturday", get nothing, and
there is no way to tell which of the nine dimensions emptied the list. With them
the dead ends are visible before they are pressed. A zero is dimmed rather than
hidden — seeing it is the point, and a chip that vanished would shift every chip
beside it on each press.

Two things about those numbers. They are **what pressing it produces**, not "how
many have this value": adding a second day to a day filter *widens*, so the
count on an unchosen day goes up rather than down, and the count on a chosen one
is what removing it would leave. And they are counted in **one pass** rather
than fifty — each event is tested against all nine dimensions once and its
failures recorded as a bitmask, so an event failing nothing counts toward every
facet, one failing exactly one counts toward that facet alone, and one failing
two counts nowhere. That takes 27,457 × 9 checks instead of 27,457 × 50:
**10–40 ms**, redone on every press, and only while the panel is open. Typing
makes it faster, because most of the catalogue stops matching the query first.

Three things worth saying about what is there:

- **There is no "tag" field in Gen Con's data.** The two fields that behave like
  tags are the **age requirement**, which is a real five-value facet, and the
  **game system**, which has 1,845 values and so is matched as text rather than
  offered as a list. They are named for what they are rather than dressed up.
- **The type names come from Gen Con's own API**, which returns `event_type` as
  `"BGM - Board Game"` and which the importer splits. All nineteen were read
  back off it rather than guessed — `ZED` is Isle of Misfit Events and `SPA` is
  not a spa. A code that appears in a future feed and not in `event-kinds.ts`
  shows as itself rather than vanishing.
- **The pickers are built from the feed**, so a type or an age band this year's
  catalogue does not use is never offered, and one it adds appears without
  anybody editing a list.

On the map's search, turning on an *event* filter also drops rooms, stands and
street addresses from the results. None of them has a day, a cost or a length,
so "free on Saturday" can be neither true nor false of Exhibit Hall B; offering
it anyway would answer a different question from the one asked. The food filters
are the exception and for the same reason — a cuisine is a question about a
stand, so choosing one narrows the stands rather than silencing them.

**Where it is kept.** `localStorage`, on the device, and nowhere else — this is
a static site that has to keep working when the host that served it is gone, so
a schedule that lived on a server would be a schedule that stopped existing.
Each entry stores a *copy* of the event rather than a reference to it: the feed
is 27,467 events and is fetched, and a plan has to render before it arrives and
whether or not it ever does. It also means Gen Con moving an event cannot
silently empty your Saturday.

### Directions

Open a room and there is an arrow in the dialog's title bar. It closes the
dialog, keeps that room as the destination, and asks the only question left:
where are you starting from? Three answers are offered, and all three end up in
the same place:

- **Your own location**, watched rather than sampled, so the line follows you
  across the campus instead of staying where you first stood. Nothing ever
  *prompts* for a position on load — a venue map has no business asking that
  before you have asked it for anything — and pressing this is the only thing
  that raises the question. Once it has been answered, `useLocationGranted`
  reads the standing permission with `permissions.query`, which shows no
  dialog, and a later visit may use the position without putting the question
  again. Where the answer doesn't come, the panel says why: refused,
  unavailable, timed out indoors, or withheld because the page isn't on HTTPS,
  which is exactly what happens when you open the dev server's LAN address on a
  phone.
- **A room you search for**, over the same index the header's search uses, so
  an event title finds the room it runs in and starts you there.
- **A point on the map**, tapped: a room to start from that room, anywhere else
  to drop a plain coordinate.

Either end can be changed afterwards, and ⇅ swaps them, which is what makes
this navigation *between* two places rather than only to one.

**What is drawn is a walking route wherever the map has floor to walk on.** The
convention centre's prefunction halls and concourses come from its own plans,
keyed by colour as "Prefunction/Hallways"; the hotels' corridors come from Gen
Con's drawings the same way. `walkable.ts` turns those into a grid a metre and a
half across and searches it with A*, and `route.ts` joins the floors together —
stairs within a building, skywalks and the tunnel between them — with a second,
much smaller search over those junctions. A room is not something to route
*through*: you enter it from the corridor, and that doorway is the last step.

So Exhibit Hall B to the Marriott Ballroom comes out as the seven legs it really
is — along Level 1, up to Level 2, over the skywalk to the Westin, through it,
over the second skywalk, and along the Marriott's 2nd floor — rather than a
620 m line through six walls. The panel lists them, and the map draws each leg
on the floor it belongs to.

**The graph is built before anybody waits for it.** Those junctions and the
walks between them are the same on every route, so they are worked out once —
1,642 ms of gridding floors and running A\* — and every route after that costs
about 5 ms. Left to itself all of that lands inside the first tap on
"Directions", on the main thread, with nothing on screen to explain the pause.
So `useWarmCampus` builds it on the browser's idle callbacks instead, a step at
a time: 900 steps, 16 of them over one frame and the longest the 150 ms it takes
to grid the convention centre's Level 1. A route arriving mid-way is not a
wasted warm-up — the part-built graph is kept and the route carries on from
where the warming stopped. Measured in the running app, the first route now
takes **70 ms**.

**How far away something is, before you commit to going.** Every search result
carries a walking time — from the room you have open, from whichever end of the
route is already settled, or, when nothing is chosen and location has already
been allowed, from the doorway you are nearest. That cannot come from the router: a route costs
**128 ms**, and eight results a keystroke would be a second of main-thread work
each time you type a letter. So it comes from a table measured once, at build
time, by that same router — `npm run data:distances` runs 149 single-source
searches over one graph holding every doorway, which takes 2.7 seconds, and
writes `src/data/distances.ts`. A lookup is an array index: **22,201 of them
take 9 ms**.

Room by room rather than by zone, and that was measured rather than assumed.
Grouping the campus into venue-and-floor zones gives 31 of them and a 961-cell
table, which sounds much cheaper until you look at what a zone is: the hotels
really do collapse to one number, and the convention centre's Level 1 holds 20
rooms spanning **1 to 5 minutes** internally. A single number for the floor
where most of Gen Con happens would be wrong by four minutes on the walks that
matter most. The full table is 11,026 pairs, one byte each in 16-metre steps —
**9.3 KB gzipped**, right to eight metres, which is seven seconds' walking.

Three things about what it says:

- **A booth is its hall.** There is no row for stand 1229 and there should not
  be: the halls are one open floor with air walls across them, and the walk is
  to the hall. `hallForBooth` does that step.
- **An extra minute, always.** The table answers "how far is that doorway from
  this one"; somebody reading a search result is asking "how long until I am
  there", which also contains finding the right door, reading a sign, and the
  last stretch inside a room the size of a street. A minute is the smallest
  unit the answer is printed in, so it is the smallest honest admission that
  the two are not the same question. It is deliberately *not* added to the
  route you have committed to — that one is drawn leg by leg and can be read.
- **A position is snapped to the nearest doorway**, and the gap to it charged
  at the same 1.3 the router charges its own unmapped outdoor lines. Standing
  on a room's own doorway picks that room for all 149 of them; 21 m off it, the
  estimate stays within two minutes of the real route on 98.7% of 528 sampled
  pairs.
- **A room you have open wins over where you are standing.** Opening one is
  somebody saying "this is what I am interested in"; standing somewhere is not.

Following a route wants GPS and a reading ten seconds old. These times do not:
they are snapped to a doorway and printed to the minute, so a coarse network
fix two minutes old answers them identically. `useDeviceLocation` takes a
`precise` flag for exactly that, because the difference is hours of battery on
a phone carried round a convention all day.

The build refuses to write a table that disagrees with `walkBetween` on a
sample of its own pairs, and a test re-routes eight more — the two halves of
staleness being a room that was *added* and a room that *moved*.

**A doorway is only a doorway if you can walk out of it.** The door is not in
any of the data; what is in the data is the room's outline and the corridor
beside it, so the point on the outline nearest walkable floor is the doorway to
within the width of a door. The catch is that the *nearest* walkable floor is
not always on the near side of the neighbours: Union Station's B&O room has
circulation 20 m off its wall with two whole railroad rooms in between. So the
line from each candidate to its corridor is stepped along, and one that goes
through another room is thrown away in favour of the next best — with three
metres of tolerance, because the outlines are schematic rectangles that abut
and a door two metres from a corridor clips the room it shares a wall with.
That took the rooms with no doorway from 14 to 7, and the pairs of buildings
routed entirely under cover from 12 to 14.

**Rooms are entered at their doors.** A room's centre is where its label goes;
for a hall the size of Exhibit Hall A that is eighty metres from any door, so a
route measured centre to centre is wrong by the length of the room at both ends.
No source here marks a door — but a room is entered from the corridor beside it,
so the point on its outline nearest walkable floor is one, to within the width
of the door. 117 of the 146 rooms get one; the rest are on floors with no
corridor drawn, and keep their centres because there is nothing to be near.

**Stairs come two ways, and a link records which.** Gen Con's own plans draw the
thing itself — an escalator is a hatched grey block, and beside the big ones the
sheet letters UP TO 2ND FLOOR — so `venue-plans.mjs` reads those out, and a
block read on two adjacent floors in the same spot is one shaft seen twice. That
is a measurement, and **25 of the 75 floor changes are one**, the convention
centre's twelve included.

Where no sheet shows a stair the link is **inferred**, and everything about it
says so: the map draws a dashed ring rather than a pin, and the step reads "the
stairs and lifts are off this stretch" rather than "Up the stairs to Level 2".
A stair has to land on walkable floor on both storeys, so it lies in the overlap
of the two floors' circulation — that much is certain, and where in the overlap
is not. Five buildings still infer every floor change they have — the Crowne
Plaza, the Hilton, the Omni, the Embassy Suites and Le Méridien — and reading
Gen Con's campus tiles for their stairs does not fix it. It was tried and
measured: the tiles do show marks their own screenshots miss, but never on both
floors of a pair, which is what a link needs. The Crowne Plaza's and the
Hilton's ground floors show nothing the reader recognises at all, and the Omni
has one mark on each of its two floors 33 m apart, which is not one shaft seen
twice. `docs/next-steps.md` §6 has the table.

Reading the real ones is not only a labelling improvement. With twelve
escalators to choose between rather than one guessed spot, the router picks the
nearest: Exhibit Hall B to the Marriott Ballroom came down from 620 m and nine
minutes to 500 m and seven.

**Outdoors it follows the pavements**, which are surveyed in OpenStreetMap the
same way the building footprints are. `npm run fetch:pavements` pulls the
ground-level footway network over the campus — sidewalks, crossings, plazas,
steps — and writes `src/data/pavements.ts`: 664 junctions, 831 runs between
them, 32 km of pavement. Of the 182 building-to-building pairs, 168 now walk
real footway.

The skywalks are deliberately **not** taken from OpenStreetMap even though it
has them, tagged as bridges. `connections.ts` already holds them with the floor
each one lands on, and a second copy that knew nothing about storeys would let a
route cross one without ever going upstairs.

Getting from a building onto that network is the part nobody has mapped. Every
venue has door nodes on the lowest floor whose circulation is drawn — one per
connected piece of it, since the JW's ground floor is several disconnected runs
and a single door would strand the rest, and several around a large building,
since the convention centre is 400 m across. Each door reaches the nearest
footway in each quarter of the compass, up to 90 m. **That hop is the only
straight line left in a route**, it is drawn dashed, and the panel says what it
is: the ground between a door and the kerb, which is a forecourt or a plaza and
is not drawn anywhere.

**A route stays under cover unless the street saves real distance.** Gen Con is
the first week of August in Indianapolis and downtown is joined by a mile of
skywalk built for exactly that, so the shortest route is not simply taken: the
covered one wins if it is within a quarter as long. The Sagamore Ballroom to the
Marriott's is 407 m over the bridges against 391 m across Maryland St, and takes
the bridges. Exhibit Hall B to the Marriott Ballroom is 217 m on the pavement
against a 500 m skywalk dogleg through the Westin, and takes the street.

Gen Con's own drawings of the hotels *do* draw the thing itself — an escalator
is a hatched strip in two greys, #616264 and #949599, and the Westin's 2nd-floor
sheet even letters it DOWN TO 1ST FLOOR; a lift bank is a run of dull-yellow
squares. Neither collides with the street grey on the same sheets. Reading them
is a fourth and fifth class in `venue-plans.mjs`'s palette, and is the right way
to finish this.

The convention centre needs Gen Con's tile pyramid rather than a hotel sheet,
and that is live: `npm run plans:campus` fetches it from
`…/maps/v9/floor-<level>/{z}/{x}/{y}.png` and stitches one PNG per campus level.
Level 1 does draw its escalators — two of them, hatched on the Hoosier and
Speedway concourses, each lettered UP TO 2ND FLOOR.

`CAMPUS_GEO`'s three numbers were measured against the z5 sheet, which is 8192
pixels square, and the script checks that before trusting them: fetched at
another zoom they would still all be numbers, and the whole campus would land
somewhere plausible and wrong.

**These sheets are georeferenced rather than fitted**, and the difference is the
difference between knowing and guessing. `fit` puts a hotel screenshot on the
map by taking its coloured area to **be** the building and aligning that box
with the venue's — right for one building, hopeless for a mile of downtown where
the colour is everything and the building is a fortieth of it. Fitted that way
the convention centre lands at 0.05 m/px and 32% overlap, against 76–89% for
every hotel.

But a pyramid level is one rigid drawing — a single scale and offset, south at
the top — so three numbers place every building on it at once. `CAMPUS_GEO` in
`venue-plans.mjs` holds them. They were found by reading two landmarks off the
sheet by eye, Monument Circle and Lucas Oil's bowl, and then refining against
all fourteen surveyed footprints together; the eye only had to get close enough
for the refinement to find the right basin. The result covers 76% of those
footprints, and the two buildings with enough shape to be sure about — the
convention centre and Lucas Oil — both land at **94%**, better than any hotel's
fit. The ones that score badly are the ones Gen Con does not colour as its own
venues: Circle Centre, the Indiana Rep, the escape room.

A campus sheet is read for its stairs and nothing else. The convention centre's
corridors already come from its architect's PDFs — vector, keyed by a printed
legend, the best geometry in this repository — and `walkable.ts` prefers
`VENUE_HALLS` to that detail, so reading them again off a raster would silently
replace a measurement with a worse one. Vertical circulation is the one thing
the PDFs do not have.

The sheets are not committed: they are Gen Con's drawings and eighteen megabytes
of them. A rebuild without them writes a `venue-plan.ts` whose convention centre
has no stairs, which looks perfectly healthy — the only sign is a building that
stops changing floors — so the script warns when they are absent, and a test
asserts they made it in.

**Three things about that pyramid look like a dead source when they aren't.** It
is not a Web Mercator pyramid — it is shallow and starts around z2, in the
`CRS.Simple` style Gen Con's own Leaflet map uses — so a URL built from
slippy-map coordinates asks for an object that never existed. An absent object on
that bucket answers **403, not 404**, so a wrong guess is indistinguishable from
a refusal. And `gencon.com/map` is no longer a floor-plan viewer at all: it
serves Gen Con's "Looking Glass" exhibitor browser, whose tiles at
`/lg/tiles/v1/` are a galaxy backdrop rather than a plan of anything. `v7` and
`v8` still answer; `v10` does not, so `v9` is current.

The fetcher takes the deepest level that stays inside a tile budget rather than
the deepest that exists, and says which it picked. The pyramid is a plain power
of two — z3 is 8×8, z5 is 32×32, z7 is 128×128 — and z7 would be sixteen
thousand requests stitching to 32768×32768, four gigabytes of pixels before
anything read them. z5 puts the whole campus in 8192 pixels and the convention
centre in a couple of thousand, which is the same grade as Gen Con's own
single-building screenshots. `--zoom N` overrides it.

### How venues are positioned

Every venue is drawn as its **real building footprint, surveyed in
OpenStreetMap**. `src/data/footprints.ts` holds the outer ring of each building
as latitude/longitude pairs, pulled from Overpass and simplified to a 2 m
tolerance; the OSM way or relation each one came from is named in a comment
above it. Each venue's `anchor` in `src/data/venues.ts` — the north-west corner
and the size in metres — is the bounding box of that footprint, and rooms are
authored in a local grid and projected from the anchor (`src/utils/geo.ts`).

To refresh a footprint, re-run its Overpass query and replace the ring:

```
[out:json]; relation(9680937); out geom;     # Indiana Convention Center
```

**Accuracy, stated plainly:** the basemap is real, and so are the venue
outlines — those are the shapes of the actual buildings, not estimates. There
are then three grades of interior, and the app says which one you are looking
at in every room pop-up:

| Grade | Venues | What it means |
| --- | --- | --- |
| **Measured** | Convention centre | Halls and meeting rooms are the outlines from the official floor plans, read into real coordinates and drawn as map geometry (below) |
| **Planned** | JW Marriott, Marriott Downtown, Westin, Crowne Plaza / Union Station, Omni Severin, Hyatt Regency, Hilton, Embassy Suites, Le Méridien | Which rooms exist, which floor each is on and how they sit relative to one another all come off a published plan of that building; the outlines are rectangles inside the real footprint rather than measured shapes |
| **Schematic** | Lucas Oil | Rooms are in the right building and the right general part of it, and nothing finer than that is claimed. Its *floors* are measured — Gen Con's campus sheets draw all three, so routes cross the stadium properly — but no sheet labels a bookable space on them, so the rooms stay rectangles |

**One building is not outlined from a survey at all.** Every venue above sits
on its real OpenStreetMap footprint except **Le Méridien**, which OpenStreetMap
has no building for — not under that name, not under the Canterbury it used to
be, not as an untagged shape. The likeliest reason is that the mall relation
next door swallows it: the hotel is built into the west edge of the Circle
Centre block, and the traced outline lands inside Circle Centre's, which is
right rather than a fault to fix. Its outline is therefore traced from Gen
Con's map of it and georeferenced against the Omni Severin drawn in the same
frame, whose surveyed footprint fixes the scale — the fit puts the Omni's far
wall within a metre of where OpenStreetMap has it. It is the one venue whose
shape *and* position are approximate, `TRACED_FOOTPRINT` in `venues.ts` names
it, and its room pop-up says so.

Three venues with no interior worth breaking out — the Indiana Rep, the Escape
Room and Circle Centre — are drawn as their footprint directly.

**One room per named space.** Where a plan letters two rooms separately, the map
draws two rooms: Union Station's eleven railroad rooms are eleven shapes, not a
block called "Railroad Rooms", and the same goes for the Marriott's ten state
and city rooms, the Westin's statehouse rooms and the Omni's universities.
Sections of one divisible ballroom stay together, because that is one room —
`Marriott Ballroom 1–10` is a single shape, as `Sagamore Ballroom` is in the
convention centre. The exception is the JW's White River Ballroom, which its
plans draw as three walled blocks rather than one span, so it is three.

**On the planned venues.** The plans are Gen Con's own, plus the hotel's own
sheet for the JW's 1st floor. Reading them takes one correction that is easy to
miss: **Gen Con draws its floor plans with south at the top.** Its own labels
give it away — Grand Hall *Southeast* is printed above Grand Hall *Northeast* —
and it holds against the buildings whose real positions are known: the plans
put the convention centre north of the Marriott Downtown and Senate Avenue east
of the Westin, and both are the other way round on the ground. So the
rectangles in `venues.ts` are those plans turned through half a turn. Every
room was then checked against the building's real footprint and pulled inside
where a plan reached past it — the plans and OpenStreetMap disagree by a few
metres at some edges, and the footprint wins, because it is the line the map
actually draws.

**Lucas Oil's rooms are the one interior a plan can't help.** Its floors are a
different matter and are read like everybody else's: Gen Con's campus sheets
draw the whole stadium, and its concourse, event level and lower suite ring come
from them. What those sheets do not do is let a drawn space be matched to a
bookable one — the halls are lettered HALL 1 and HALL 2 where the schedule says
Exhibit Halls 1–2, the meeting rooms are numbered individually where it books
them as a block of twelve, and the suites are LS8A upward. So the stadium keeps
the room rectangles it had, from its seating diagram: the names and the side of
the bowl each space is on are right, the positions are not.

**Its levels were also wrong, and the sheets said so.** `venues.ts` gave the
stadium six floors — Field, Level 1, Concourse, Club, Meeting, Suite — where the
building has three that Gen Con draws with rooms on them. Halls 1–2, Meeting
Rooms 1–12 and the field are all one storey, which is why they are all on the
Event level now. Which sheet is which storey is not written on any sheet; it is
read off the letterings, each of which names a neighbour ("UP TO STREET LEVEL",
"DOWN TO EVENT SPACES", "DOWN TO CLUB LOWER LEVEL"), and the five pin each
other. `docs/next-steps.md` §2b has the table.

**A building is outlined by the same source as its interior.** The convention
centre used to be outlined by its OpenStreetMap footprint while its rooms came
from the floor plans, and two independent tracings of one building never quite
agree: the line sat a few metres off its own rooms, and ran on for another 90 m
down the skywalk arm to the stadium, which no floor plan draws. Its outline is
now traced around everything its plans draw, so the line and the rooms inside it
can't disagree. Every other venue keeps its OSM footprint, which is also what
`footprints.ts` still holds for all of them, the convention centre included.

Every room is checked two ways: that it falls inside the building it belongs to,
and that it doesn't sit on another room on the same floor. Both are clean —
sampled over what the map actually draws for each room, which is its plan
outline where it has one and its rectangle where it doesn't, with a shared wall
not counting as a collision.

The convention center's grid is measured in metres, so a room's `rect` reads as
a real distance from the building's north-west corner; the other venues use a
plain 0–100 grid. Note that the convention center's footprint bounding box is
taller than the building: the building proper occupies the first 265 m, and the
rest of the box is the thin skywalk arm running south to Lucas Oil. Rooms have
to stay inside the part the footprint actually covers.

To make an interior exact, run its floor plan through the pipeline below, or
replace the room rectangles with surveyed ones. Nothing else has to change.

### Real floor plans

The convention centre's interior on the map **is** its official floor plan. Not
a picture of one laid over the map — the plan's own geometry, read into real
coordinates and drawn by the app in the app's palette. Exhibit Hall D is the
outline the architect drew for Exhibit Hall D, and the prefunction halls,
service cores, restrooms and airwall lines around it are the shapes the plan
draws for them.

That is worth the trouble because an image overlay never quite works. It
arrives as one flat sheet in somebody else's colours, its paper greys fight the
basemap, and wherever the fit is a metre out the whole sheet looks wrong at
once. Geometry has none of those problems: it takes the map's own styling, sits
under the rooms rather than over the basemap, and a room that is drawn from the
plan can be clicked, labelled and zoomed to like any other.

The pipeline is three scripts in `scripts/`, run over the PDFs in `plans/`:

- **`pdf-to-svg.py`** converts a plan. These are pure vector drawings — no
  raster images inside — so the whole thing survives as paths.
- **`plan-labels.py`** reads the printed type back out with its position. This
  is the piece that makes the rest work: the plans letter every hall and
  meeting room, so a label tells you which shape is room 143.
- **`plan-to-geometry.mjs`** turns both into `src/data/plan-geometry.ts`.

Classification comes from the plans' own legends, which key each space by
colour — exhibit halls and meeting rooms in one, prefunction space, restrooms,
service areas. So the page background, the surrounding streets and the legend
itself simply aren't among the colours that mean anything, and never enter the
output. Each printed label then claims the tightest shape it falls inside, and
a shape answers to every label on it: `HALL A`, `EXHIBIT HALL A`, or each of
`130`–`139` where a block of meeting rooms shares one drawn space and divides
along airwalls. `Room.plan` in `venues.ts` lists the labels a room covers:

```ts
{ id: 'hall-d', plan: ['HALL D'], … }
{ id: 'rooms-130-145', plan: numberRange(130, 145), … }
```

20 of the convention centre's 23 rooms are drawn this way, across 132 shapes.
The three that aren't — registration, Gen Con Central and the food court — are
services the plan doesn't letter, so they keep a schematic rectangle on the
Level 1 concourse.

**One space, one owner.** Level 1 prints a band called `SWING SPACE` between
Halls C, E and F, and colours all three halls straight through it, because that
band is let to whichever of them needs it. Read literally that hands the same
930 m² to three rooms at once: three outlines stacked on each other, a click in
the band landing on whichever hall was drawn last, and Hall E's bounds running
eighty metres west of Hall E. So a space gives up whatever named space is drawn
inside it — the halls keep every wall the architect drew, they simply stop where
the swing space starts, and the band is a room of its own. The cut runs along
the drawing's own walls rather than a raster of them: these plans are square, so
slicing the pair along every coordinate either outline mentions leaves cells
that are wholly in or wholly out. Walls within the same 0.25 m the outlines are
simplified by are taken to be the same wall first, because drawn ones miss each
other by a hair.

**The outline comes from the plans too.** `plan-to-geometry.mjs` traces a line
around everything a venue's sheets draw — every floor, since an upper storey
that oversails is still part of the building — and the map draws that instead of
the OSM footprint. It rasterises at half a metre, closes the raster by a wall's
thickness so the hairline gaps where shapes meet don't read as holes, keeps the
largest connected piece, follows its boundary, and simplifies. The alternative,
unioning several hundred polygons exactly, is a lot of machinery for a line only
ever needed to the nearest metre.

**Georeferencing.** `plans/georeference.json` says where a venue's plans sit in
the world, and `scripts/fit-plan.mjs` derives it: a plan is a scale drawing and
Web Mercator is conformal over a city block, so the only freedom is a uniform
scale and an offset — three numbers, not four. It searches those for the best
overlap with the building's OSM footprint, clipped to the building proper
because the OSM way also carries the thin skywalk arm running south to Lucas Oil
and no floor plan of the convention centre draws that.

**One frame per venue, not per sheet.** The floors of a building are one drawing
issued floor by floor, and the convention centre's two put its walls at the same
page coordinates to a tenth of a point — fitting Level 2's outline onto Level 1's
gives scale 1.00000 and a one-point shift. So they share a single page-to-world
transform and are fitted together, scored as the mean over sheets. Fitted
separately they came out 0.12% apart in scale and 1.4 m apart on the west wall:
small, but it meant two floors of the same room disagreed about where that room
is, and the disagreement was free to grow with any refit. Sharing the frame
makes it impossible rather than small — a page point maps to one place, whichever
sheet it came off.

The shared frame lands at 0.7275 Mercator metres per point. Intersection over
union against the OSM outline is 0.9627 for Level 1 and 0.9666 for Level 2 —
each within 0.002 of what it scored fitted alone, so agreeing costs neither
floor anything measurable. 98.8% of everything the plans draw falls inside the
mapped building, and the plans cover 93.9% of it.

Drawing real floors has one consequence worth knowing: rooms genuinely stack.
The convention centre's rooms 201-212 sit directly over 101-117, because that is
where they are. Each building therefore draws one floor at a time — its ground
floor until you select a room in it, then that room's floor — and selecting a
room fades the rest of its building's floors.

The planned venues in the table above stop short of this pipeline for one
reason: none of their plans can be fitted. The JW's is a line drawing with no
building outline and no scale; Gen Con's are drawn by its own map application
and come out as screenshots, which have pixels rather than paths, and no legend
keying spaces by colour. What they do carry is names and arrangement, and that
is what has been taken from them — the White River Ballroom's ten lettered
sections in three columns with rooms 101–104 alongside, Griffin Hall over them
and the Grand Ballroom over that; the Marriott Ballroom's sections 1–10 filling
its whole floor above the Indiana Ballroom; the Westin's Grand Ballroom sitting
directly over the Capitol; Union Station's eleven railroad rooms in two rows
down the concourse behind the Grand Hall, with the Crowne Plaza's own rooms
running west from them through the old train shed; the Hyatt's Regency and
Cosmopolitan ballrooms stacked on its 2nd and 3rd floors with Network, Concept,
Theory and Vision out on the wings; the Hilton's meeting rooms on its 2nd floor
and the Victory Ballroom alone nine floors up; the Embassy Suites' four rooms
ringing the atrium five floors above its lobby; the Omni's Gates, McClellan and
Fisher halls up on its 2nd floor with the Severin Ballroom left on its 1st.
Lucas Oil's
field is measured: its box is a full NFL field including end zones, centred on
the bowl and turned onto the bowl's own long axis, which the minimum-area
rectangle around the OSM footprint puts 25.6° off the street grid. Its street-
level plan is a seating diagram with no scale, so it can't be fitted — but it
names the spaces and says which side of the bowl each is on, which is where the
East and West Club lounges, the concourses and the gates come from. Their
positions are schematic; their names and their sides are not.

For the remaining venues, neither obvious source gives plans away:

- **OpenStreetMap has no interior rooms** in any Gen Con venue. Across the whole
  campus there are 28 indoor-tagged elements and not one is a room — they are
  skywalk footbridges, four underground corridors, and shop and artwork points.
  The Overpass query that produced the footprints stops at the walls.
- **Gen Con's own plans** are drawn by a JavaScript map application rather than
  served as image files, and they are Gen Con's drawings, not open data.

To add another venue, put its plan PDFs in `plans/`, add a venue entry to
`plans/georeference.json` listing its sheets, and run:

```
python3 scripts/pdf-to-svg.py   plans/<sheet>.pdf plans/<sheet>.svg
python3 scripts/plan-labels.py  plans/<sheet>.pdf plans/<sheet>.labels.json
node scripts/fit-plan.mjs <venue-id>      # reports the frame to paste back
node scripts/plan-to-geometry.mjs
```

Add every sheet of a building under the same venue entry: they get one frame
between them, and each extra floor is another vote on where that frame goes.

Then set `Room.plan` on the rooms it letters. A plan whose colours don't match
the convention centre's needs its legend added to `LEGEND` in
`plan-to-geometry.mjs` — the script says what it kept and what it dropped.

This route needs a vector PDF with a colour-keyed legend. A plan that is only a
photograph or a seating diagram has no geometry to read, and there is no
overlay fallback: the map draws geometry or it draws the schematic rooms.

The plans in `plans/`, and the geometry read out of them, are the venue's
drawings and not open data. `PLAN_CREDIT` puts the source in the map's
attribution; check you are allowed to redistribute a plan before adding one.

## Event schedule

Events come from Gen Con's own catalogue API, `/api/event_search`.
`npm run fetch:events` pulls them into `public/events.json`; the app loads that
file and attaches each event to a room on the map.

They used to come from a third-party site with no API, one HTML page per event:
27,000 requests, a cache and a lock and a resume protocol to survive it, and
every field picked back out of somebody else's markup. Gen Con publishes the
same catalogue as JSON, with `location`, `room_name` and `table_number` as
named fields — which is exactly what the room matcher needs. Same 27,467
events, same 27,417 of them resolving to a room, in about 1,100 requests.

The endpoint pages 25 at a time and stops at 10,000 records, so it is fetched in
five `day[]` slices; those slices sum to exactly the total the unsliced query
reports, and the fetcher checks that identity on every run rather than trusting
it.

The app reads a generated file rather than calling the site directly for two
reasons: a browser can't fetch it cross-origin, and a local file keeps the
schedule working when convention centre Wi-Fi doesn't.

### How the source is laid out

The source publishes each event in two places, and the importer reads both:

| Page | What it gives | Cost |
| --- | --- | --- |
| `changeList.php` | when the database was last rebuilt, and every change set since | 1 request |
| `changes.php?ChangeSet=…` | one change set: events added, deleted, or with tickets back on sale | 1 per unseen set |
| `index.php` | one `category.php` link per event type | 1 request |
| `dayTimeList.php` | the convention's days, with real dates | 1 request |
| `categoryAll.php?EventType=…` | every event in a category: title, code, day, time, cost, tickets — **but no location** | 1 per event type |
| `event.php?GameCode=…` | one event's full record, and the **only** page that says where it happens | 1 per event |

There is no listing table anywhere on the site, and no JSON or CSV export
(`--inspect` probes for six likely endpoints; all 404). The event page holds its
record as a two-column table of label/value rows — `Title`, `Start Date`,
`Location`, `Room`, `Table` — so `scripts/lib/parse-events.mjs` maps fields by
matching those **row labels**, not by column position or DOM path. `--inspect`
prints the labels the site is actually using and how `FIELD_PATTERNS` resolves
each one; that is the list to adjust if the source ever renames them.

The catalogue pass is cheap. The detail pass is not — roughly 27,000 requests
for a full year. Use `--limit` to spread that over several runs, `--no-details`
to skip locations entirely, and `--delay` / `--concurrency` to control how hard
it leans on a hobbyist's server.

### Only the first run pays for it

Two files in `.cache/` mean a later run re-reads almost nothing:

| File | What it holds |
| --- | --- |
| `event-details.jsonl` | every event record pulled, each with the `pulledAt` of the run that read it |
| `import-state.json` | the watermark: the source's own last-rebuilt timestamp, the newest change set, and when this repo last pulled in full |

A run starts at `changeList.php`. The whole site is generated from one
spreadsheet, and that page prints when it was last processed — so while that
timestamp matches the one in `import-state.json`, nothing on the site has
changed, and the run stops there having made **one request**:

```
Source last rebuilt: Sunday August 02, 2026 - 11:51 am EST (change set 345)
  Unchanged since the last pull at 2026-08-02T17:31:42.663Z.
public/events.json is already up to date. Nothing fetched.
```

When it has moved, the change sets published since the last run say which
events were added, deleted, or had tickets go back on sale. Only those are
re-pulled; the deleted ones are dropped from the cache:

```
  2 change set(s) since the last pull; reading them.
  507 event(s) to re-pull, 32 deleted.
```

**What that misses, and why there's still a full pass.** The source only
publishes a change set "when at least one of the three criteria above is met" —
its words. A title, a time, or a *room* edit changes the data without ever
appearing in one. Following change sets alone would let a room move go
unnoticed indefinitely, so a full re-pull falls due every `FULL_REFRESH_DAYS`
(7) regardless, and `--full` forces one at any time. Being more than
`MAX_CHANGE_SETS` (40) behind also triggers one, since reading that many sets
costs more requests than the pull they were meant to save.

Only a run that read everything moves the watermark, and "everything" is
checked rather than assumed: every event in the catalogue has a cached record,
and nothing is still failing. A run that ends short — `--no-details`, or event
pages that never came back — leaves the watermark where it was, so the next run
sees the same work again and finishes it rather than skipping past events it
never actually read. A `--limit` run that happens to close the last gap counts;
one that doesn't, doesn't.

`--limit` also turns a due full re-pull into a top-up, and doesn't reset the
full-pull clock. Throwing the cache away and then reading only `--limit` of it
back would lose more than it refreshed, and the next capped run would do the
same again — which is exactly what the weekly job in
`.github/workflows/deploy.yml` does, at 4,000 pages a run.

### Getting all of them, first time

A first pull is 27,000 requests, and at even a very low failure rate that is
hundreds of events with no location. Two mechanisms rather than one:

- **Per request:** up to five attempts with exponential backoff and jitter, on
  network errors, 429s and 5xxs. A 4xx fails immediately — the page genuinely
  isn't there, and knocking again won't change that. The jitter matters because
  a pool of workers that all fail at once would otherwise march back in step.
- **Per crawl:** whatever still failed is swept up and tried again, up to four
  sweeps, each waiting longer than the last. A source having a bad minute costs
  a pause rather than the run.

Progress is appended to the cache as it lands, so an interrupted crawl keeps
what it got. The file is compacted at the end of a run, because a re-pulled
event otherwise leaves its old line behind.

### Checking a room's events haven't moved

Opening a room re-reads the source for the events still to come in it, and says
what it found:

> **1 of the next 3 events has moved** since the schedule was imported. The
> source now lists: 7 Wonders → Hyatt · Regency Ballroom A

This exists because of the gap above. A change set is published only when an
event is added, deleted, or has tickets go back on sale — a room edit isn't one
of those, so between full re-pulls a move is invisible to the importer. The
room you are standing in front of is the one where that matters.

It checks the **next six** events rather than all of them: a busy room's
schedule runs to hundreds, the ones already over cannot be walked to, and the
source is one person's hobby server.

**It needs a same-origin path to the source.** The event database sends no
`access-control-allow-origin`, which is the same reason the schedule ships as a
generated file rather than being fetched live. A path on the app's own origin
that forwards to it lifts that, because the browser is then talking to itself:

| Host | How |
| --- | --- |
| `npm run dev` | Already configured, in `vite.config.ts` |
| Netlify, Cloudflare Pages | Already configured, in `public/_redirects` |
| Vercel | A `rewrites` entry in `vercel.json` |
| nginx, Caddy | `proxy_pass` / `reverse_proxy` on `/eventdb` |
| **GitHub Pages** | **Not possible** — it serves static files only |

Where the path isn't there the check says it couldn't reach the source, rather
than implying everything is confirmed. Nothing else about the app depends on
it.

### Matching events to rooms

The source separates *where* from *what*: `Location` names the building (`ICC`,
`JW`, `Stadium`, `Crowne Plaza`) and `Room` names the space inside it
(`Hall B : Orange`, `Sagamaore Ballroom 3--5`, `140`). `src/data/events.ts`
resolves them in that order — venue first, then that venue's own rooms.

Resolving the venue first is what keeps the JW Marriott's room 103 apart from
the convention center's: both number their meeting rooms the same way, and a
single flat search cannot tell them apart. Within a venue, matching is
token-aware (so `201` doesn't match `2010`) and prefers the longest match, so
`Exhibit Hall J` beats a bare `Hall`. A building whose interior the map doesn't
break out resolves to its single room, so its events still land on it.

`Venue.aliases` therefore holds `Location` strings and `Room.aliases` holds
`Room` strings. Both lists are tuned to what the site actually publishes,
including its own misspellings — it writes `Sagamaore` for the Sagamore Ballroom
on most records, and `HIlton` for the Hilton on some.

When the feed uses names the map doesn't recognise, the app logs them to the
browser console on load:

```
[gen-con] 412 of 8000 events did not match a room on the map.
Unrecognised locations (17): 416 Wabash : 416 E Wabash St | ICC : Exhibit Hall ...
```

Add those strings to the relevant room's `aliases` and they'll resolve. This is
the intended tuning loop.

### What the importer was last verified against

The importer has been run against the live site, and the aliases above were
tuned to it. It imports the full 2026 catalogue — **27,537 events across 19
event types**, matching the total the site itself reports — with the days and
times it publishes.

Measured over a full import rather than a sample — 27,467 events — **99.53%
resolve to a room on the map**. The source uses 22 distinct `Location` values
and several hundred `Room` values, and 15 of those 22 resolve to a building.

The 130 that do not resolve are all places the map has not got, rather than
matching failures, and they divide cleanly:

| | Events | |
| --- | ---: | --- |
| `Exhibit Hall`, `Exhibit Hall Booth #1229` | 79 | The source does not say which hall, and there are eleven |
| Seven venues that are not on the map | 40 | Janus Lofts, Taxman CityWay, St. Elmo Steak House, 416 Wabash, Victory Field, White River State Park, The Oceanaire Seafood Room |
| Foyers and concourse spots with no room authored | 11 | `North Plaza`, `Georgia Street Entrance`, `3rd Floor Foyer`, `Eerie` |

Only the first is worth acting on, and the action is not in the matcher —
see [Who is at which booth](#who-is-at-which-booth), which has the booth
numbers and still cannot say which hall. `src/data/events.test.ts` holds every
one of the 22 `Location` strings and the room shapes that go with them.

The most interesting of the unmatched is **416 Wabash** (1 event), an address
five blocks east of the campus.

It used to be worse than unmatched. Its `Room` reads
`416 E Wabash St`, and with no venue recognised the matcher searched every room
on the campus and put it in the **convention centre's Wabash Ballroom** — a
confident answer, in the wrong building, with nothing to say it was a guess.
An unrecognised `Location` now only matches venues the map draws as a single
room, whose aliases are that building's own names and street address. Room
names repeat across the campus, which is the whole reason matching resolves the
venue first; with no venue at all, a room-name match is exactly the mistake
that design exists to prevent.

If an import comes back empty, `--inspect` prints the structure it actually
found — the event types linked, the convention's days, a catalogue page's yield,
and an event page's row labels with the field each one maps to:

```bash
npm run fetch:events -- --inspect
```

## As an app on a phone

It installs. Open the published site in Safari or Chrome on a phone and add it
to the home screen: it launches without browser chrome (`display: standalone`),
keeps working with no signal after one visit with one, and picks up new builds
on its own.

  - **The icon** is a PNG as well as an SVG, because iOS does not read SVG for
    `apple-touch-icon` and falls back to a screenshot of the page — which on a
    phone means the app has no icon. `public/icon-180.png` is the one iOS uses,
    opaque and square-cornered because iOS applies its own mask.
  - **Offline** is `public/sw.js`: the app stale-while-revalidate, the map tiles
    cache-first and capped. The first visit needs a network; none after it does.
  - **A dead server** is the same thing from the other end, and it is tested:
    with the host answering 500 to everything, and again with it switched off
    entirely, the app still comes up with all 177 rooms, all 27,467 events and
    working search. `keepStorage()` asks the browser to make that copy durable
    rather than best-effort, so it is not the first thing deleted when the phone
    runs short of space — installing the app is what persuades Chrome and Safari
    to grant it. §12 of `docs/next-steps.md` has the measurements.
  - **Updating itself** is `src/registerServiceWorker.ts`. Every time the app is
    brought back to the foreground it asks whether there is a new build, and
    reloads once if there is. Measured in Chromium: about ten seconds from
    resume to running the new build.

The reason the check is on resume rather than on load is that an installed app
is resumed from the app switcher, which is not a navigation — and a navigation
is the only thing that would otherwise trigger the browser's own check. Without
it somebody can carry a build from before the convention started all week.

## Next year

Two of the three data sources refresh on their own: the schedule is imported at
build time every Monday and never committed, and the stand list is re-pulled
from Gen Con's API on the 1st of each month by `.github/workflows/refresh.yml`,
which opens a pull request only when something actually moved.

The exhibit hall's booths are the annual manual step, because they are read off
a PDF that has to be fetched by hand — two commands, both of which refuse to
write an answer they cannot stand behind. You do not have to remember when it
is due: a new Gen Con's booth numbers against last year's map fail the monthly
refresh's checks, and the pull request says why.

`docs/next-steps.md` §10 has the commands, and the short list of hand-sourced
things that will go stale without telling you.

To take GitHub out of the serving path entirely — private repository, GitHub
Pages switched off, app still building and still updating — `docs/cloudflare.md`
is the step-by-step. It is about twenty minutes and costs nothing.

There is also `worker/` — a Cloudflare Worker that serves `events.json` with
CORS from a second origin, for the one case a cache cannot cover: a device that
has never opened the app, after the site it would have come from is gone. It is
not deployed; §14 and `worker/wrangler.toml` have the six commands, and the app
ignores it entirely unless `VITE_EVENTS_MIRROR` is set.

## Layout

```
src/
  data/
    venues.ts        Venues, anchors, rooms, categories, aliases
    footprints.ts    Real building outlines, from OpenStreetMap
    plan-geometry.ts Floor-plan geometry and outlines (generated)
    events.ts        Event types, venue/room matching, schedule helpers
    event-kinds.ts   Gen Con's nineteen type codes, read off its own API
    amenities.ts     Restrooms, from the plans that draw them
    exhibitors.ts    Every stand, its booth, its tags and its site (generated)
    booths.ts        Booth numbers to halls, and the aisle grid
    food.ts          Which tags are cuisine, dish or dietary — and the hours
    search.ts        Ranking rooms, stands, events and addresses against a query
    filters.ts       The kind, the event dimensions, and what pressing one leaves
    vendors.ts       What a stand is, where it is and what it sells
    plan.ts          The four days, stops, travel, lanes and the shared axis
    navigation.ts    Route ends, distances and what a straight line can claim
    connections.ts   Skywalks and the tunnel, and which floor each belongs to
    walkable.ts      The floor you can stand on, as a grid, and A* over it
    vertical.ts      Where a route changes floor, and how sure that is
    route.ts         Joins the floors into one graph and searches it
    distances.ts     Every room-to-room walk, precomputed (generated)
    nearby.ts        Reads that table — "how far away" without routing
    venue-plan.ts    Hotel hallways, room outlines and stairs (generated)
    basemaps.ts      Tile providers and their attribution
  hooks/
    useEventFeed.ts        Loads public/events.json
    useLocationCheck.ts    Re-reads the source to confirm a room's events
    useDeviceLocation.ts   Watches the device's position, only while asked
    useEventNotes.ts       Fetches one description, when it is asked for
    usePlan.ts             The schedule, in localStorage
    usePlanDescriptions.ts Keeps a planned event's description for offline
  utils/geo.ts       Local-grid ↔ latitude/longitude projection
  components/
    MapView.tsx      Leaflet map, venue/room layers, labels, amenities, routes
    RoomDialog.tsx   Room details and its schedule
    EventDialog.tsx  One event, vendor or planned entry, in full
    AddStop.tsx      When are you going to be there — the only question a stop asks
    SearchBar.tsx    Search box and its results
    EventFilters.tsx The kind row and the filter panel, shared by both searches
    PlanView.tsx     The four-day schedule, on one ruler
    NavPanel.tsx     Directions: the two ends, how to choose them, the distance
    Legend.tsx       Category key and the amenities toggle
plans/
  *.pdf                    The convention centre's own floor plans
  *.svg, *.labels.json     Converted drawing and printed labels
  georeference.json        One page-to-world frame per venue
  venues/*.png             Gen Con's plans of the hotels, as pictures
  campus/                  Gen Con's floor-plan tiles (fetched, not committed)
scripts/
  pdf-to-svg.py            Plan PDF to paths
  plan-labels.py           Printed labels, with their positions
  fit-plan.mjs             Fits a venue's frame to its OSM footprint
  plan-to-geometry.mjs     Plans to map geometry (writes plan-geometry.ts)
  venue-plans.mjs          Reads hotel hallways by colour (writes venue-plan.ts)
  gencon-tiles.mjs         Fetches and stitches Gen Con's floor-plan tiles
  fetch-pavements.mjs      Pulls the footway network (writes pavements.ts)
  lib/png.mjs              PNG decoding, down to 4-bit palette tiles
  fetch-events.mjs         Crawls the source and imports the real schedule
  lib/parse-events.mjs     Catalogue and event-page parsing, and FIELD_PATTERNS
  make-sample-events.mjs   Fake schedule for offline development
```

## Not built yet

A personal schedule of the events you've got tickets for, and offline caching
of tiles so the map works without signal.

Directions are a walking route now, indoors and out (see above), and
`docs/next-steps.md` has the measured gaps and what to do about them. All 182
pairs of buildings get a route — 170 follow surveyed pavement, 12 stay under
cover the whole way — and every room of a building can reach every other room of
it. Only three floors on the campus have no walkable surface drawn, and all
three belong to venues Gen Con does not colour as its own.

The largest gap left is not ours to fix from here. **Four of the twelve skywalk
spans join nothing**: OpenStreetMap has the JW's bridge landing on the Government
Center car park 69 m short of the convention centre, with no elevated way
continuing, and the same is true at the Hyatt and the Marriott. So seven of the
fifteen skywalk-joined pairs of buildings have no covered route — not because a
floor is missing, but because the span itself is not in the source.

After that it is the room rectangles. Lucas Oil's and the Crowne Plaza's are
schematic, which is why most of the fourteen rooms still without a doorway are
theirs: the floor beside them is drawn now, but their outline sits too far from
it to say which wall the door is in.

Room-level detail could go further still. The exhibit halls are one shape each,
though the source names the colour-coded and publisher sections inside them
(`Hall B : Orange`, `Hall E : Asmodee`); breaking those out would put a demo
table on the map rather than a hall. The eight planned venues would each need a
vector plan — one with paths and a colour-keyed legend, not a screenshot —
before their interiors could be measured the way the convention centre's now
are; the arrangement is right in all of them, but the coordinates are still
authored rather than read. Lucas Oil needs something else again: a plan that
names its spaces the way the schedule books them, which none of the five
published for it does — they letter HALL 1 where the schedule says Exhibit
Halls 1–2, and number the meeting rooms one by one where it books all twelve
together.

The convention centre needs no more floors: levels 1 and 2 are the two sheets
in `plans/` and they are the whole of it. Gen Con's own map offers B, 1, 2, 3
and 4, but those number the *event levels of the campus* rather than the floors
of any one building — its level 3 is the JW's 3rd floor, the Hyatt's 3rd, the
Embassy Suites' 5th and the Hilton's 9th all at once. Nothing of the convention
centre is on them.
