# Gen Con Trip

A trip planner for the Gen Con convention: a real map of downtown Indianapolis
with the convention venues on it, and the event schedule attached to the rooms
those events happen in. Double-click a room to see what's on there and when.

## Running it

```bash
npm install
npm run events:sample   # placeholder schedule so the UI has data (optional)
npm run dev             # http://localhost:5173
```

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

One web app covers iOS, Android and desktop, and installs to the home screen or
dock via its web app manifest. If it ever needs app-store distribution or native
APIs, the same codebase wraps with Capacitor.

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
Buildings whose interiors the map doesn't break out (the hotels, Lucas Oil
Stadium) are drawn as that footprint directly. What remains approximate is the
**interior of the convention center: its room layout is a schematic arrangement
inside the real footprint, not a surveyed floor plan** — halls are in the right
building and the right general part of it, but not at surveyed positions. The
app says so in every room pop-up.

The convention center's grid is measured in metres, so a room's `rect` reads as
a real distance from the building's north-west corner. Note that its footprint's
bounding box is taller than the building: the convention center proper occupies
the first 265 m, and the rest of the box is the thin skywalk arm running south
to Lucas Oil. Rooms have to stay inside the part the footprint actually covers.

To make the interior exact, overlay an official floor plan (below) or replace
the room rectangles with surveyed ones. Nothing else has to change.

### Overlaying an official floor plan

If you have an official floor-plan image, it can be drawn over the real map:

```bash
# put the image in public/, then:
VITE_FLOORPLAN_URL=./icc-floorplan.png npm run dev
```

It is stretched to the convention centre's anchor bounds, so how well it lines
up depends on the anchor being right. This is the path to a genuinely exact
interior map.

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

Lucas Oil Stadium is the one venue whose interior would be worth breaking out:
it takes about a fifth of the schedule, and the source already separates the
field blocks, exhibit halls 1–2, the east concourse, the club lounges and the
numbered meeting rooms. Today they all resolve to the stadium as a whole.
