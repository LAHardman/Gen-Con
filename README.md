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

**What still needs signal.** The schedule is baked into the page, so it survives
bad convention Wi-Fi. The map tiles are not — they stream from the tile
provider. Offline tiles are on the list below.

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
| `npm run build` | Type-checks, then builds to `dist/` |
| `npm run preview` | Serves the production build |
| `npm run fetch:events` | Imports the real schedule from the event database |
| `npm run fetch:events -- --inspect` | Reports what the source site actually looks like |
| `npm run fetch:events -- --limit 500` | Stops after 500 event pages; the rest resume next run |
| `npm run fetch:events -- --no-details` | Catalogue only — fast, but events get no location |
| `npm run events:sample` | Writes an obviously-fake schedule for offline development |

`dist/` is fully self-contained and uses relative paths, so it also works
dropped on any static host, or bundled into a native shell with Capacitor if it
ever needs app-store distribution.

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
| Double-click / double-tap a room | Open its details and schedule |
| Single click / tap a room | Select it |
| Type in the search box | Find a room or an event |

Leaflet's double-click-to-zoom is deliberately disabled, because double-click is
reserved for opening room details.

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

Inside the convention centre there is better than that: its plans draw the
prefunction space and hallways, and the map draws them as open floor a shade
lighter than the fabric either side. Those used to be styled as the gap between
the rooms and were nearly invisible, which is backwards — on a map for finding
your way to a game, the corridor is the route and the rooms are what it passes.

### Floors

A flat map has one surface and a building has several, and the rooms on them
land on top of each other: the convention centre's 201–212 sit directly over
101–117, and the JW has three floors of meeting rooms in one stack. So the map
draws **one floor of a building at a time**, and the picker on the right of the
map changes which. It names the building whose floors it is offering — the one
under the middle of the screen, or filling most of it — and follows you as you
move between them. A building with one floor has nothing to switch and shows no
picker. The floors you aren't on are left as ghosts: faint enough not to read as
rooms, present enough to say there is more here than one storey.

Each building holds its own floor, so reading the JW's 3rd doesn't move the
Hyatt. Anything that takes you to a room takes you to its floor as well —
clicking it, or picking it out of the search box.

**A building opens on the floor the convention uses, not its lowest.** That is
the one with most of its rooms on it. The obvious rule is the wrong one here:
the Hyatt's ground floor is a single room, the Embassy's is a single room, and a
building that opens on an empty storey looks like a building with no interior.
The stadium is the exception the count gets wrong — its field is one room and
the concourse ring above it is two — so `opensOn` in `venues.ts` says which.

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

**Water fountains are not marked, and that is not an oversight.** No plan shows
them. The convention centre's legend has four categories and water is not one;
its drawings carry no `fountain` or `water` label anywhere; Gen Con's own map
draws no such icon. Rather than scatter plausible-looking dots, the map marks
none — `AmenityKind` already allows for water, so the day a source turns up the
entries drop straight into `src/data/amenities.ts`.

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
| **Schematic** | Lucas Oil | Rooms are in the right building and the right general part of it, and nothing finer than that is claimed |

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

**Lucas Oil is the one building a plan can't help.** Gen Con draws all three of
its levels, and not one space on any of them is labelled: the bowl, the
concourse ring and the lower-level halls are drawn as unnamed blocks. So the
stadium keeps the interior it had, which comes from its seating diagram — the
names and the side of the bowl each space is on are right, the positions are
not.

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

Events come from the third-party [Gen Con event database](https://gencon.eventdb.us/).
`npm run fetch:events` pulls them into `public/events.json`; the app loads that
file and attaches each event to a room on the map.

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

Of a 2,739-event sample spread evenly across all 19 types, **99.6% resolved to
a room on the map**. The source uses 16 distinct `Location` values and several
hundred `Room` values, and every `Location` but two resolves to a building.

One straggler is left in the sample: **416 Wabash** (1 event), an address five
blocks east of the campus with no building on the map. Nothing else — every
other `Location` resolves to a building, and nothing inside a building the map
knows goes unmatched.

That last one used to be worse than unmatched. Its `Room` reads
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

## Layout

```
src/
  data/
    venues.ts        Venues, anchors, rooms, categories, aliases
    footprints.ts    Real building outlines, from OpenStreetMap
    plan-geometry.ts Floor-plan geometry and outlines (generated)
    events.ts        Event types, venue/room matching, schedule helpers
    amenities.ts     Restrooms, from the plans that draw them
    search.ts        Ranking rooms and events against what you type
    basemaps.ts      Tile providers and their attribution
  hooks/
    useEventFeed.ts       Loads public/events.json
    useLocationCheck.ts   Re-reads the source to confirm a room's events
  utils/geo.ts       Local-grid ↔ latitude/longitude projection
  components/
    MapView.tsx      Leaflet map, venue/room layers, labels, amenities
    RoomDialog.tsx   Room details and its schedule
    SearchBar.tsx    Search box and its results
    Legend.tsx       Category key and the amenities toggle
plans/
  *.pdf                    The venues' own floor plans
  *.svg, *.labels.json     Converted drawing and printed labels
  georeference.json        One page-to-world frame per venue
scripts/
  pdf-to-svg.py            Plan PDF to paths
  plan-labels.py           Printed labels, with their positions
  fit-plan.mjs             Fits a venue's frame to its OSM footprint
  plan-to-geometry.mjs     Plans to map geometry (writes plan-geometry.ts)
  fetch-events.mjs         Crawls the source and imports the real schedule
  lib/parse-events.mjs     Catalogue and event-page parsing, and FIELD_PATTERNS
  make-sample-events.mjs   Fake schedule for offline development
```

## Not built yet

A personal schedule of the events you've got tickets for; walking times
between venues (`walkingMinutes` in `src/utils/geo.ts` is there
for it); and offline caching of tiles so the map works without signal.

Room-level detail could go further still. The exhibit halls are one shape each,
though the source names the colour-coded and publisher sections inside them
(`Hall B : Orange`, `Hall E : Asmodee`); breaking those out would put a demo
table on the map rather than a hall. The eight planned venues would each need a
vector plan — one with paths and a colour-keyed legend, not a screenshot —
before their interiors could be measured the way the convention centre's now
are; the arrangement is right in all of them, but the coordinates are still
authored rather than read. Lucas Oil needs something else again: a plan that
names its spaces, which none of the three published for it does.

The convention centre needs no more floors: levels 1 and 2 are the two sheets
in `plans/` and they are the whole of it. Gen Con's own map offers B, 1, 2, 3
and 4, but those number the *event levels of the campus* rather than the floors
of any one building — its level 3 is the JW's 3rd floor, the Hyatt's 3rd, the
Embassy Suites' 5th and the Hilton's 9th all at once. Nothing of the convention
centre is on them.
