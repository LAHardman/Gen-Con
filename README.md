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
providers are wired up (CARTO dark, CARTO light, OpenStreetMap standard) and
switchable from the header. Each carries the attribution its terms require —
Leaflet renders it in the corner, and it must not be removed.

| Gesture | Result |
| --- | --- |
| Drag / one-finger drag | Pan |
| Scroll wheel or trackpad | Zoom |
| Pinch | Zoom |
| Double-click / double-tap a room | Open its details and schedule |
| Single click / tap a room | Select it |

Leaflet's double-click-to-zoom is deliberately disabled, because double-click is
reserved for opening room details.

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
outlines — those are the mapped shapes of the actual buildings, not estimates.
The **convention centre's interior is real too**: its halls and meeting rooms
are the outlines from its official floor plans, read into real coordinates and
drawn as map geometry (below). Every other venue's interior is still a schematic arrangement inside its real
footprint — rooms are in the right building and the right general part of it,
but not at surveyed positions. The app says which you are looking at in every
room pop-up. Three venues with no interior worth breaking out — the Indiana
Rep, the Escape Room and Circle Centre — are drawn as their footprint directly.

Every schematic room is checked to fall inside the building it belongs to.
Rooms drawn from a floor plan are held to a different standard, because the
plan and the OSM outline are two independent tracings of the same building: the
convention centre has three whose walls cross the mapped outline, by at most
3.5 m. That is the two sources disagreeing, not a room in the wrong place, and
the plan is the better authority for where an interior wall is.

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

19 of the convention centre's 22 rooms are drawn this way, across 132 shapes.
The three that aren't — registration, Gen Con Central and the food court — are
services the plan doesn't letter, so they keep a schematic rectangle on the
Level 1 concourse.

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

The JW Marriott's own floor plans set the arrangement of its rooms — the big
halls west, the numbered rooms down the east side, floor by floor — but those
drawings carry no building outline or scale to fit against, so its interior is
positioned from them rather than measured, and stays schematic. Lucas Oil's
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
for a full year — so detail pages are cached in `.cache/event-details.jsonl` and
the crawl is resumable: only the first run pays for them. Use `--limit` to
spread that over several runs, `--no-details` to skip locations entirely, and
`--delay` / `--concurrency` to control how hard it leans on a hobbyist's server.

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
Unrecognised locations (17): Le Meridien : Latitude | ICC : Exhibit Hall ...
```

Add those strings to the relevant room's `aliases` and they'll resolve. This is
the intended tuning loop.

### What the importer was last verified against

The importer has been run against the live site, and the aliases above were
tuned to it. It imports the full 2026 catalogue — **27,537 events across 19
event types**, matching the total the site itself reports — with the days and
times it publishes.

Of a 3,000-event sample spread evenly across all 19 types, **99.4% resolved to
a room on the map**. The source uses 16 distinct `Location` values and several
hundred `Room` values.

The stragglers are small offsite venues OpenStreetMap has no building for (Le
Meridien, Janus Lofts) and convention-center strings that name no particular
hall (`Exhibit Hall`, `Exhibit Hall Booth #1229`, `Georgia Street Entrance`).

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
    events.ts        Event types, venue/room matching, schedule helpers
    basemaps.ts      Tile providers and their attribution
  hooks/useEventFeed.ts   Loads public/events.json
  utils/geo.ts       Local-grid ↔ latitude/longitude projection
  components/
    MapView.tsx      Leaflet map, venue/room layers, labels
    RoomDialog.tsx   Room details and its schedule
    Legend.tsx       Category key
scripts/
  fetch-events.mjs         Crawls the source and imports the real schedule
  lib/parse-events.mjs     Catalogue and event-page parsing, and FIELD_PATTERNS
  make-sample-events.mjs   Fake schedule for offline development
```

## Not built yet

A personal schedule of the events you've got tickets for; search across events;
walking times between venues (`walkingMinutes` in `src/utils/geo.ts` is there
for it); and offline caching of tiles so the map works without signal.

Room-level detail could go further still. The exhibit halls are one shape each,
though the source names the colour-coded and publisher sections inside them
(`Hall B : Orange`, `Hall E : Asmodee`); breaking those out would put a demo
table on the map rather than a hall. The other venues would each need their own
floor plan before their interiors could be measured the way the convention
centre's now are.
