# Gen Con Trip

A trip planner for the Gen Con convention. This first cut is the venue map:
an interactive floor plan you can pan and zoom, with a detail pop-up for every
room.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Type-checks, then builds to `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm run typecheck` | Type-check only |

`npm run dev` binds to all interfaces, so you can open the printed network URL
on a phone on the same Wi-Fi to test touch gestures on real hardware.

## Cross-platform approach

It's one web app, not three native ones. That covers iOS, Android, desktop
browsers, and — because it ships a web app manifest — installs to the home
screen or dock as a standalone app with no browser chrome. If this later needs
app-store distribution or native APIs (offline event data, push notifications
for ticket drops), the same codebase can be wrapped with Capacitor without a
rewrite.

## Map interactions

| Gesture | Result |
| --- | --- |
| Drag / one-finger drag | Pan |
| Scroll wheel or trackpad | Zoom, anchored at the cursor |
| Pinch | Zoom, anchored at the midpoint between the fingers |
| Two-finger drag | Pan while pinching |
| Double-click / double-tap a room | Open its info pop-up |
| Single click / tap a room | Select it (shown in the header) |
| Tab + Enter | Keyboard equivalent of selecting and opening a room |

Everything runs through Pointer Events, so mouse, touch and pen share one code
path rather than three. The map surface sets `touch-action: none`, which hands
every gesture to the app — that's what stops mobile browsers from page-zooming
or double-tap-zooming on top of the map's own gestures.

A few details worth knowing if you touch this code:

- **Gestures are tracked in client (viewport) coordinates, not
  container-relative ones.** Surrounding layout can shift mid-gesture — a
  toolbar appearing, mobile browser chrome collapsing — and a container-relative
  delta would silently absorb that shift and jump the map.
- **The transform is applied to an SVG `<g>`, not a CSS transform on a div.**
  Shapes stay vector-crisp at every zoom level instead of being rasterised and
  scaled.
- **Labels are sized in screen pixels and measured, not estimated.** A label too
  wide for its room shrinks to fit, and is dropped only when shrinking would
  make it illegible — which is what makes the map declutter itself as you zoom
  out. `src/utils/text.ts` measures text with a canvas context rather than
  guessing from a characters-per-em ratio, because guessing makes labels spill
  over their shapes and collide.
- **Strokes use `vector-effect: non-scaling-stroke`,** so borders don't thicken
  with the zoom level and swallow the shapes they outline.

## Layout

```
src/
  data/mapData.ts        Rooms, buildings, connectors, categories — all map content
  hooks/usePanZoom.ts    Pan/zoom/tap gesture handling
  components/
    MapView.tsx          SVG rendering and hit-testing
    RoomDialog.tsx       Room detail pop-up (bottom sheet on phones)
    Legend.tsx           Category key
  utils/text.ts          Text measurement for label fitting
  App.tsx                Shell: header, selection state, hint
```

Everything the map draws comes from `src/data/mapData.ts`, in an abstract
"world" coordinate space. Adding a room, correcting a position, or swapping in a
different venue entirely is a data change, not a code change.

## About the map data

**The layout is a schematic approximation, not an official floor plan.** It
captures how the venues relate to each other — which halls sit next to which,
what connects to what by skywalk — at a level of detail useful for "where am I
going next?" It is not surveyed geometry, and room assignments change every
year. Check the official Gen Con program for exact rooms and events.

## Not built yet

The map is step one. The natural next pieces for trip planning: a personal event
schedule, search across rooms and events, walking times between venues, and
offline support so the map works when the convention centre Wi-Fi doesn't.
