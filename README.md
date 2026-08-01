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

Each venue in `src/data/venues.ts` carries an `anchor`: the real latitude and
longitude of its north-west corner, plus its real size in metres. Its rooms are
authored in a simple local grid and projected onto the map from that anchor
(`src/utils/geo.ts`). Moving or resizing a venue moves everything inside it, so
correcting the map is a change to one anchor rather than to every room.

**Accuracy, stated plainly:** the basemap is real, and the venues are at
approximately the right real-world coordinates. The **interior room layout is a
schematic arrangement within each building's footprint, not a surveyed floor
plan** — halls are in the right building and the right general part of it, but
not at surveyed positions. The app says so in every room pop-up.

To make the footprints exact, replace the `anchor` values with real coordinates
(read them off OpenStreetMap, or from an official floor plan). Nothing else has
to change.

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

### Matching events to rooms

`src/data/events.ts` resolves each event's location text to a room. Every room
matches on its own name, its short name, and any `aliases` listed in
`src/data/venues.ts`. Matching is token-aware (so `201` doesn't match `2010`)
and prefers the longest match, so `Exhibit Hall J` beats a bare `Hall`.

When the real feed uses names the map doesn't recognise, the app logs them to
the browser console on load:

```
[gen-con] 412 of 8000 events did not match a room on the map.
Unrecognised locations (17): Crowne Plaza : Victoria Station C | ICC : Hall E ...
```

Add those strings to the relevant room's `aliases` and they'll resolve. This is
the intended tuning loop — the alias lists shipped today are a first guess.

### ⚠️ The importer has not been run against the live site

The environment this was built in blocks all outbound network access except
package registries, so `gencon.eventdb.us` was unreachable — the importer's
parsing has **never executed against the real pages**. It is written to be
generic rather than to guess at markup: it probes for a JSON export first, and
otherwise finds the largest table on the page and maps columns by matching their
header text (`scripts/lib/parse-events.mjs`), so it does not depend on any class
name or DOM path.

If an import comes back empty, this prints the page structure it actually found —
tables, headers, row counts, links, filters, and which structured endpoints
responded:

```bash
npm run fetch:events -- --inspect
```

Then adjust `COLUMN_PATTERNS` in `scripts/lib/parse-events.mjs` to match the real
column headings. The importer rate-limits itself (700 ms between pages by
default, `--delay` to change) and identifies itself in its user agent.

## Layout

```
src/
  data/
    venues.ts        Venues, anchors, rooms, categories, aliases
    events.ts        Event types, room matching, schedule helpers
    basemaps.ts      Tile providers and their attribution
  hooks/useEventFeed.ts   Loads public/events.json
  utils/geo.ts       Local-grid ↔ latitude/longitude projection
  components/
    MapView.tsx      Leaflet map, venue/room layers, labels
    RoomDialog.tsx   Room details and its schedule
    Legend.tsx       Category key
scripts/
  fetch-events.mjs         Imports the real schedule
  lib/parse-events.mjs     Generic listing-page parsing
  make-sample-events.mjs   Fake schedule for offline development
```

## Not built yet

A personal schedule of the events you've got tickets for; search across events;
walking times between venues (`walkingMinutes` in `src/utils/geo.ts` is there
for it); and offline caching of tiles so the map works without signal.
