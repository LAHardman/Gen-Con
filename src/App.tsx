import { useCallback, useEffect, useMemo, useState } from 'react';
import { FloorPicker } from './components/FloorPicker';
import { Legend } from './components/Legend';
import { MapView } from './components/MapView';
import { RoomDialog } from './components/RoomDialog';
import { SearchBar } from './components/SearchBar';
import { PlanView } from './components/PlanView';
import { DatesView } from './components/DatesView';
import { HotelsView } from './components/HotelsView';
import { BudgetView } from './components/BudgetView';
import { AccountPanel } from './components/AccountPanel';
import { AppMenu, type MenuPage } from './components/AppMenu';
import { EventDialog, type Detail } from './components/EventDialog';
import type { SearchHit } from './data/search';
import type { Pin } from './data/offsite';
import type { Exhibitor } from './data/exhibitors';
import { NavPanel } from './components/NavPanel';
import { ROOMS_BY_ID, defaultLevel, type Room } from './data/venues';
import { boothAt } from './data/booth-place';
import { BASEMAPS, BASEMAP_IDS, type BasemapId } from './data/basemaps';
import { useEventFeed } from './hooks/useEventFeed';
import { useDeviceImport } from './hooks/useDeviceImport';
import { useFollowedRoute } from './hooks/useFollowedRoute';
import { useDeviceLocation, useLocationGranted } from './hooks/useDeviceLocation';
import { useWarmCampus } from './hooks/useWarmCampus';
import { usePlan } from './hooks/usePlan';
import { useBookings } from './hooks/useBookings';
import { useBudget } from './hooks/useBudget';
import { useGenConAccount } from './hooks/useGenConAccount';
import { usePlanDescriptions } from './hooks/usePlanDescriptions';
import { feedYear, isHappeningAt } from './data/events';
import { planningYear } from './data/key-dates';
import { buildEventSearchIndex } from './data/search';
import { filterChoices } from './data/filters';
import { conventionOffset } from './data/plan';
import {
  pinPlace,
  placeRoom,
  placeSpot,
  roomPlace,
  type NavEnd,
  type NavPlace,
} from './data/navigation';

const SOURCE_URL = 'https://gencon.eventdb.us/';
const BASEMAP_KEY = 'genCon.basemap';

/**
 * The pages, behind one button.
 *
 * Two fitted in a header as tabs; three do not, on a phone already carrying a
 * title, an event count, a basemap switch and the selected room. See `AppMenu`.
 */
type Page = 'map' | 'plan' | 'dates' | 'hotels' | 'budget' | 'account';

const PAGES: ReadonlyArray<MenuPage<Page>> = [
  { id: 'map', label: 'Map', detail: 'The campus, and how to get across it' },
  { id: 'plan', label: 'Schedule', detail: 'Your four days, drawn to scale' },
  { id: 'dates', label: 'Key dates', detail: 'Badges, housing, tickets — and when' },
  { id: 'hotels', label: 'Hotels', detail: 'Where to sleep, and roughly what it costs' },
  { id: 'budget', label: 'Budget', detail: 'What the trip costs, and whose share is whose' },
  { id: 'account', label: 'Gen Con account', detail: 'Sign in to read your own details' },
];

/**
 * The three map styles, as one control rendered in two places.
 *
 * The header carries it where there is width for it, and the menu drawer
 * carries it where there is not — a phone. One component rather than two
 * copies of the markup, because the bug this fixes was exactly the kind that
 * a second copy invites: the header's was hidden below 560px and nothing took
 * its place, so on a phone the map had three styles and offered one.
 */
function BasemapSwitch({
  chosen,
  onChoose,
}: {
  chosen: BasemapId;
  onChoose: (id: BasemapId) => void;
}) {
  return (
    <div className="app__basemaps" role="group" aria-label="Basemap style">
      {BASEMAP_IDS.map((id) => (
        <button
          key={id}
          type="button"
          className={`app__basemap${id === chosen ? ' app__basemap--active' : ''}`}
          aria-pressed={id === chosen}
          onClick={() => onChoose(id)}
        >
          {BASEMAPS[id].label}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Page>('map');
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [openRoom, setOpenRoom] = useState<Room | null>(null);
  // `booth` narrows the focus from the room to one stand inside it — see
  // `handleShowPlannedRoom`.
  const [focusRequest, setFocusRequest] = useState<{
    room: Room;
    booth?: string;
    token: number;
  } | null>(null);
  const [basemapId, setBasemapId] = useState<BasemapId>('dark');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showAmenities, setShowAmenities] = useState(true);
  // The floor each building is showing, and the building the map is looking at.
  // Only buildings moved off the floor they open on appear here.
  const [levels, setLevels] = useState<Record<string, string>>({});
  // The building you have opened. Nothing draws an inside until one is.
  const [openVenueId, setOpenVenueId] = useState<string | null>(null);

  // Directions. `nav` is null until somebody asks for them; `editing` is the
  // end the panel is choosing a place for, and `pickOnMap` says that end is
  // waiting on a click rather than on the panel's own search.
  const [nav, setNav] = useState<{ from: NavPlace | null; to: NavPlace | null } | null>(null);
  const [editing, setEditing] = useState<NavEnd | null>(null);
  const [pickOnMap, setPickOnMap] = useState(false);

  const { status, feed, index } = useEventFeed();
  // Almost always decides not to run; see `shouldDeviceImport`.
  const deviceImport = useDeviceImport(feed);

  // Somebody's own schedule, kept on the device. Read once on load and written
  // on every change — see `usePlan` for why it lives nowhere else.
  const plan = usePlan();

  /*
   * The booked hotels and the budget, lifted here for the same reason the plan
   * is: two pages read the bookings — the hotels page writes them and the
   * budget adds them up — and two independent copies of a `localStorage` store
   * would disagree the moment one of them was written to.
   */
  const bookings = useBookings();
  const budget = useBudget();

  // Signed out is the normal state and every other page ignores it: this is
  // additive, and the app is complete without anybody ever signing in.
  const account = useGenConAccount();

  // Descriptions for what is on the schedule, fetched once and kept, so a
  // planned event stays readable in an exhibit hall with no signal.
  usePlanDescriptions(plan);

  // One session, opened in full. Both searches go through this rather than
  // acting on a title and a room: whether it costs forty dollars, whether it is
  // 21+, whether any tickets are left are all reasons not to add it, and none
  // of them fit on a result row.
  const [openDetail, setOpenDetail] = useState<Detail | null>(null);

  // Directions cost a second and a half the first time and 5 ms after it, and
  // that second and a half used to be spent inside the tap. Now it is spent
  // here, while the map is being looked at.
  useWarmCampus();

  // Built once per feed and shared: the header's search and the directions
  // panel search the same 27,000 titles, and lowercasing them twice per feed
  // is twice as much work as it needs to be.
  const eventSearchIndex = useMemo(() => buildEventSearchIndex(index), [index]);

  /*
   * What the filter pickers can offer, built from the feed rather than written
   * down — see `filterChoices`. Over the search index rather than the raw feed
   * because that is the same list the filters run against, so a picker can
   * never offer a value that finds nothing.
   */
  const choices = useMemo(
    () => filterChoices(eventSearchIndex.entries.map((entry) => entry.event)),
    [eventSearchIndex],
  );

  /*
   * The convention's own offset, worked out once for everything that needs it.
   *
   * The schedule needs it to know which column is today; adding a food truck at
   * half past one needs it to know whose half past one. Taken from the plan
   * first so a plan that outlives its feed still reads its own days right, then
   * from the feed. Null when neither has said, and null is a real answer — see
   * `conventionOffset`.
   */
  const offsetMinutes = useMemo(
    () => conventionOffset(plan.entries, feed?.events[0]?.start),
    [plan.entries, feed],
  );

  /*
   * Nothing asks the browser where you are until you have asked it something
   * first — either a route with "my location" as an end, or, on a later visit,
   * the permission you granted for one still standing. A standing permission
   * raises no dialog, so the second case uses your location without ever
   * putting the question again.
   *
   * Only the route wants precision. The walking times beside search results are
   * snapped to a doorway and printed to the minute, so a coarse reading two
   * minutes old answers them exactly as well as GPS does — and costs a fraction
   * of the battery on a phone that is out all day.
   */
  const usingDevice = nav?.from?.kind === 'device' || nav?.to?.kind === 'device';
  const granted = useLocationGranted();
  const device = useDeviceLocation(!!usingDevice || granted, !!usingDevice);

  // Held rather than recomputed on every fix, so the line does not rearrange
  // under somebody walking it correctly. `useFollowedRoute` measures each fix
  // against the route it already has and only asks for a new one when they are
  // genuinely off it — see the note there.
  const followed = useFollowedRoute(nav?.from, nav?.to, device.fix);
  const route = followed.route;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(BASEMAP_KEY);
      if (stored && stored in BASEMAPS) setBasemapId(stored as BasemapId);
    } catch {
      // Storage can be blocked; the default basemap is fine.
    }
  }, []);

  // Keep "on now" honest without re-rendering constantly.
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const chooseBasemap = useCallback((id: BasemapId) => {
    setBasemapId(id);
    try {
      window.localStorage.setItem(BASEMAP_KEY, id);
    } catch {
      // Non-fatal.
    }
  }, []);

  const eventCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!index) return counts;
    for (const [roomId, events] of index.byRoom) counts.set(roomId, events.length);
    return counts;
  }, [index]);

  /*
   * The pins, with how many events stand on each.
   *
   * Every pin the schedule reaches, whether or not anything is on today: the
   * map is a map before it is a timetable, and a steakhouse hosting one dinner
   * on Thursday is still somewhere worth being able to see and walk to.
   */
  const pins = useMemo(
    () =>
      index
        ? [...index.byPin.values()].map(({ pin, events }) => ({ pin, events: events.length }))
        : [],
    [index],
  );

  // A pin has no room to select and no building to open, so opening one is
  // asking the way there — the only thing anybody can do with an address.
  /**
   * A stand on the trade floor, opened by the number printed on it.
   *
   * The same dialog a vendor search result opens, because it is the same
   * question — who is this and how do I get there — reached by pointing at the
   * floor instead of typing a name. Where two exhibitors share a stand, the
   * first is opened and the other is one tap away in the search.
   */
  const handleOpenStand = useCallback(
    ({ exhibitors, hall }: { exhibitors: Exhibitor[]; booth: string; hall: Room | undefined }) => {
      const [first] = exhibitors;
      if (!first) return;
      setOpenDetail({ kind: 'vendor', exhibitor: first, room: hall });
    },
    [],
  );

  const handleOpenPin = useCallback((pin: Pin) => {
    setNav({ from: null, to: pinPlace(pin) });
    setEditing('from');
    setPickOnMap(false);
  }, []);

  const liveCount = useMemo(() => {
    if (!index) return 0;
    let total = 0;
    for (const events of index.byRoom.values()) {
      total += events.filter((event) => isHappeningAt(event, nowMs)).length;
    }
    return total;
  }, [index, nowMs]);

  /**
   * The schedule's year, when it is not the year being planned — null the
   * rest of the time. Non-null is a normal state, not a warning: every
   * autumn the newest catalogue is last year's until Gen Con publishes the
   * next, and a copy of this app that never updates again holds its last
   * schedule for ever. Both are worth showing; neither is worth showing
   * unlabelled, so the label is the feature.
   */
  const feedVintage = useMemo(() => {
    if (!feed) return null;
    const year = feedYear(feed);
    return year !== null && year < planningYear(nowMs) ? year : null;
  }, [feed, nowMs]);

  // Opening a building starts you on the ground floor, wherever you left it
  // last time. Closing it is the same call with null.
  const openVenue = useCallback((venueId: string | null) => {
    setOpenVenueId(venueId);
    if (venueId) {
      setLevels((current) => {
        if (!(venueId in current)) return current;
        const next = { ...current };
        delete next[venueId];
        return next;
      });
    }
  }, []);

  // Going to a room means opening its building on its floor, however you got
  // there: the room is on the 3rd and drawing it over the 1st would put it in
  // the wrong building's worth of walls.
  const showRoom = useCallback((room: Room) => {
    setOpenVenueId(room.venueId);
    setLevels((current) =>
      current[room.venueId] === room.level ? current : { ...current, [room.venueId]: room.level },
    );
  }, []);

  const handleSelectRoom = useCallback(
    (roomId: string | null) => {
      setSelectedRoomId(roomId);
      const room = roomId ? ROOMS_BY_ID[roomId] : undefined;
      if (room) showRoom(room);
    },
    [showRoom],
  );

  // Changing floor under a selected room leaves it a storey away and no longer
  // drawn, so the selection goes with it.
  const handlePickFloor = useCallback((venueId: string, level: string) => {
    setLevels((current) => ({ ...current, [venueId]: level }));
    setSelectedRoomId((current) => {
      const room = current ? ROOMS_BY_ID[current] : undefined;
      return room && room.venueId === venueId && room.level !== level ? null : current;
    });
  }, []);

  const handleZoomToRoom = useCallback((room: Room) => {
    setFocusRequest({ room, token: Date.now() });
    setOpenRoom(null);
  }, []);

  // A search result takes you to the room and opens it, which is the whole
  // point of searching for one: the map flies there behind the dialog, so
  // closing it leaves you looking at the right place.
  const handlePickSearchResult = useCallback(
    (hit: SearchHit) => {
      // A pin has no room to select, no building to open and no floor to
      // switch to — it is a coordinate with an address on it. Picking one puts
      // it straight into directions, because going there is the only thing
      // anybody can do with it.
      /*
       * A restaurant opens itself, like a stand.
       *
       * It carries a cuisine, hours somebody volunteered and its own site, and
       * none of that fits on a result row. A plain address still goes straight
       * to directions, because going there is the only thing anybody can do
       * with a coordinate that has nothing else attached.
       */
      if (hit.eatery) {
        setOpenDetail({ kind: 'eatery', eatery: hit.eatery });
        return;
      }
      if (hit.pin) {
        setNav({ from: null, to: pinPlace(hit.pin) });
        setEditing('from');
        setPickOnMap(false);
        return;
      }
      /*
       * A stand opens itself rather than the hall it stands in.
       *
       * For a food truck that panel is the whole answer — what they sell, when
       * they are open, and a link to their own page, which is the nearest thing
       * to a menu that exists. Jumping the map to Exhibit Hall I instead would
       * answer a question nobody asked.
       */
      if (hit.exhibitor) {
        setOpenDetail({ kind: 'vendor', exhibitor: hit.exhibitor, room: hit.room });
        return;
      }
      const room = hit.room!;
      setSelectedRoomId(room.id);
      showRoom(room);
      setFocusRequest({ room, token: Date.now() });
      setOpenRoom(room);
    },
    [showRoom],
  );

  // Directions open with the room you were reading as the destination and
  // nothing to start from, which is the question left to answer.
  const handleNavigateToRoom = useCallback(
    (room: Room) => {
      setNav({ from: null, to: roomPlace(room) });
      setEditing('from');
      setPickOnMap(false);
      setOpenRoom(null);
      setSelectedRoomId(room.id);
      showRoom(room);
    },
    [showRoom],
  );

  const handleSetNavPlace = useCallback(
    (end: NavEnd, place: NavPlace) => {
      const base = nav ?? { from: null, to: null };
      const next = end === 'from' ? { ...base, from: place } : { ...base, to: place };
      setNav(next);
      setEditing(null);
      setPickOnMap(false);

      // A room in a building the map hasn't opened isn't there to look at, so
      // choosing one opens its building on its floor. Where both ends are in
      // the same building, though, showing one floor necessarily hides the
      // other — and between the two, the floor you are going to is the one to
      // draw.
      const origin = placeRoom(next.from);
      const destination = placeRoom(next.to);
      const show =
        origin && destination && origin.venueId === destination.venueId
          ? destination
          : placeRoom(place);
      if (show) showRoom(show);
    },
    [nav, showRoom],
  );

  // A click on the map answers whichever end the panel has open.
  const handlePickPlace = useCallback(
    (place: NavPlace) => {
      if (editing) handleSetNavPlace(editing, place);
    },
    [editing, handleSetNavPlace],
  );

  /**
   * From a planned entry to the room it is in.
   *
   * The map is behind the schedule rather than unmounted, so this is a switch
   * back to it rather than a navigation — and it opens the room's dialog,
   * because somebody following a plan into a room wants that room's other
   * events as much as its outline.
   */
  /**
   * Take the map to a room — or, where one is named, to a stand inside it.
   *
   * An exhibit hall is four hundred metres of floor and flying to it says
   * only which building. A booth number is the address that floor actually
   * uses, so when there is one the map goes to the stand and says which it
   * is. The room is still opened underneath, because the stands are only
   * drawn while their hall is the open building on its own level.
   *
   * `openRoom` is deliberately not set for a stand: the room panel would
   * cover the very thing the map has just flown to.
   */
  const handleShowPlannedRoom = useCallback(
    (roomId: string, booth?: string) => {
      const room = ROOMS_BY_ID[roomId];
      if (!room) return;
      const stand = boothAt(booth);
      setTab('map');
      setSelectedRoomId(room.id);
      showRoom(room);
      setFocusRequest({ room, booth: stand ? booth : undefined, token: Date.now() });
      setOpenRoom(stand ? null : room);
    },
    [showRoom],
  );

  const handleCloseNav = useCallback(() => {
    setNav(null);
    setEditing(null);
    setPickOnMap(false);
  }, []);

  const selectedRoom = selectedRoomId ? ROOMS_BY_ID[selectedRoomId] : undefined;

  /*
   * What the header's search measures its results from.
   *
   * Where a route is being planned that is its starting point, since that is
   * what somebody has just said they care about. Otherwise it is the room they
   * have open or selected — the place they are looking at, which is the only
   * thing the app knows about where they are while nothing has asked the
   * browser. Nothing turns the device's positioning on for this: geolocation
   * costs battery and is a question worth asking, and annotating a search list
   * is not a reason to ask it.
   */
  const searchFrom = useMemo(() => {
    if (nav?.from) return placeSpot(nav.from, device.fix);
    const room = openRoom ?? selectedRoom;
    if (room) return { roomId: room.id };
    // Nothing chosen, but the phone knows where it is: measure from the doorway
    // it is nearest. A room somebody has open is still preferred over this —
    // opening one is a deliberate "this is where I am interested", and standing
    // somewhere is not.
    return device.fix ? { at: device.fix.position } : null;
  }, [nav?.from, device.fix, openRoom, selectedRoom]);
  const picking = !!editing && pickOnMap;

  const openRoomEvents = openRoom ? (index?.byRoom.get(openRoom.id) ?? []) : [];

  return (
    <div className="app">
      <header className="app__header">
        {/* Leftmost, before the brand: a menu somebody reaches for without
            looking is one that is always in the same corner. */}
        <AppMenu
          pages={PAGES.map((page) =>
            page.id === 'plan' && plan.entries.length > 0
              ? { ...page, badge: plan.entries.length }
              : page,
          )}
          current={tab}
          open={menuOpen}
          onToggle={setMenuOpen}
          onChoose={setTab}
        >
          {/* The same switch as the header's, for the phone widths where the
              header has no room for it. Only on the map, because that is the
              only page it changes anything on. */}
          {tab === 'map' && (
            <>
              <span className="menu__extra-title">Map style</span>
              <BasemapSwitch chosen={basemapId} onChoose={chooseBasemap} />
            </>
          )}
        </AppMenu>

        <div className="app__brand">
          <span className="app__logo" aria-hidden="true">
            20
          </span>
          <div>
            <h1>Gen Con Trip</h1>
            {/* Where you are, outside the control that took you there. The
                second line was already the app's status; the page it is
                showing is part of the same sentence. */}
            <p>
              <span className="app__page">{PAGES.find((page) => page.id === tab)?.label}</span>
              {deviceImport.running
                ? `Importing the schedule from Gen Con${deviceImport.expected ? ` · ${deviceImport.got.toLocaleString()} of ${deviceImport.expected.toLocaleString()}` : '…'}`
                : status === 'ready' && index
                ? `${index.total.toLocaleString()} events${feedVintage !== null ? ` · ${feedVintage} schedule` : ''}${liveCount > 0 ? ` · ${liveCount} on now` : ''}`
                : status === 'absent'
                  ? 'Venue map · no event data'
                  : status === 'error'
                    ? 'Venue map · event data failed to load'
                    : 'Venue map'}
            </p>
          </div>
        </div>

        {/* One search box at a time: the schedule has its own, and it looks for
            individual sessions rather than places. */}
        {tab === 'map' && (
          <SearchBar
            events={eventSearchIndex}
            from={searchFrom}
            choices={choices}
            feedDays={index?.days ?? []}
            nowMs={nowMs}
            offsetMinutes={offsetMinutes}
            onPick={handlePickSearchResult}
          />
        )}

        <div className="app__tools">
          <BasemapSwitch chosen={basemapId} onChoose={chooseBasemap} />
          {selectedRoom && (
            <button
              type="button"
              className="app__selection"
              onClick={() => setOpenRoom(selectedRoom)}
            >
              {selectedRoom.shortName ?? selectedRoom.name}
              <span>Details</span>
            </button>
          )}
        </div>
      </header>

      <main className={`app__main${nav ? ' app__main--navigating' : ''}`}>
        <MapView
          pins={pins}
          onOpenPin={handleOpenPin}
          selectedRoomId={selectedRoomId}
          onSelectRoom={handleSelectRoom}
          onOpenRoom={setOpenRoom}
          onOpenStand={handleOpenStand}
          focusRequest={focusRequest}
          basemapId={basemapId}
          eventCounts={eventCounts}
          showAmenities={showAmenities}
          levels={levels}
          openVenueId={openVenueId}
          onOpenVenue={openVenue}
          picking={picking}
          onPickPlace={handlePickPlace}
          route={route}
          deviceFix={device.fix}
        />
        <Legend showAmenities={showAmenities} onToggleAmenities={() => setShowAmenities((on) => !on)} />
        <FloorPicker
          venueId={openVenueId}
          level={(openVenueId && (levels[openVenueId] ?? defaultLevel(openVenueId))) ?? null}
          onPick={handlePickFloor}
        />
        {tab === 'dates' && <DatesView nowMs={nowMs} />}
        {tab === 'hotels' && <HotelsView nowMs={nowMs} bookings={bookings} />}
        {tab === 'budget' && (
          <BudgetView nowMs={nowMs} budget={budget} bookings={bookings} plan={plan} />
        )}
        {tab === 'account' && (
          <AccountPanel
            state={account.state}
            onSignIn={account.signIn}
            onSignOut={account.signOut}
          />
        )}
        {tab === 'plan' && (
          <PlanView
            plan={plan}
            feedDays={index?.days ?? []}
            events={eventSearchIndex}
            choices={choices}
            offsetMinutes={offsetMinutes}
            nowMs={nowMs}
            feedVintage={feedVintage}
            onImport={deviceImport.last?.status === 'refused' && deviceImport.last.because.includes('installed app') ? undefined : deviceImport.start}
            importing={deviceImport.running}
            onOpenEvent={(hit) =>
              setOpenDetail({ kind: 'event', event: hit.event, room: hit.room, pin: hit.pin })
            }
            // A block on the schedule opens what it is rather than acting: the
            // map and the removal both live in that panel now, because a
            // twenty-minute stop is twenty-six pixels of column and had room
            // for its own buttons or for its own name, not both.
            onOpenEntry={(entry) =>
              setOpenDetail({
                kind: 'planned',
                entry,
                room: entry.roomId ? ROOMS_BY_ID[entry.roomId] : undefined,
              })
            }
          />
        )}
        {tab === 'map' && nav && (
          <NavPanel
            from={nav.from}
            to={nav.to}
            editing={editing}
            pickingOnMap={picking}
            covered={!!openRoom}
            device={device}
            route={route}
            progress={followed.progress}
            events={eventSearchIndex}
            onEdit={setEditing}
            onSet={handleSetNavPlace}
            onPickOnMap={setPickOnMap}
            onSwap={() => setNav((current) => (current ? { from: current.to, to: current.from } : current))}
            onClose={handleCloseNav}
          />
        )}
      </main>

      {openDetail && (
        <EventDialog
          detail={openDetail}
          plan={plan}
          feedDays={index?.days ?? []}
          offsetMinutes={offsetMinutes}
          onClose={() => setOpenDetail(null)}
          onShowOnMap={(roomId, booth) => {
            setOpenDetail(null);
            handleShowPlannedRoom(roomId, booth);
          }}
          onNavigate={(room, pin) => {
            setOpenDetail(null);
            setTab('map');
            if (room) handleNavigateToRoom(room);
            else if (pin) {
              setNav({ from: null, to: pinPlace(pin) });
              setEditing('from');
              setPickOnMap(false);
            }
          }}
        />
      )}

      {openRoom && (
        <RoomDialog
          room={openRoom}
          events={openRoomEvents}
          feedStatus={status}
          sourceUrl={feed?.source.url ?? SOURCE_URL}
          nowMs={nowMs}
          onClose={() => setOpenRoom(null)}
          onZoomToRoom={handleZoomToRoom}
          onNavigateToRoom={handleNavigateToRoom}
          plan={plan}
        />
      )}
    </div>
  );
}
