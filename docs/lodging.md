# Lodging near the convention, and whether a server can price it

Two questions, and they have very different answers.

1. **What is there?** 38 places to sleep within walking distance, enumerated
   below.
2. **Can a server fetch their prices?** For the number that actually matters —
   the Gen Con block rate — **no**, and not for a reason that any amount of
   engineering fixes. For public rates, yes, with caveats that decide whether
   it is worth building.

Pulled 11 August 2026. Sources and method are at the bottom, including what
could not be checked from here.

---

## 1. What is there

38 lodging places, ordered by straight-line distance from the convention
centre's north-west corner. Straight line, not walking — the app's own graph
does walking, and this list is inventory rather than routing.

| m | Name | Rooms |
|---:|---|---|
| 124 | JW Marriott Indianapolis | |
| 170 | Fairfield Inn & Suites Indianapolis Downtown | |
| 192 | Marriott Indianapolis Downtown | |
| 211 | Courtyard Indianapolis Downtown | |
| 212 | SpringHill Suites Indianapolis Downtown | |
| 280 | The Westin Indianapolis | 574 |
| 496 | Holiday Inn Express & Suites | |
| 523 | Hyatt Regency Indianapolis | |
| 585 | Embassy Suites by Hilton Indianapolis Downtown | |
| 593 | Crowne Plaza Indianapolis Downtown (Union Station) | |
| 618 | Le Méridien Indianapolis | |
| 623 | Holiday Inn Indianapolis Downtown | |
| 643 | Hilton Indianapolis Hotel & Suites | 332 |
| 656 | Omni Severin Hotel | |
| 663 | Conrad Indianapolis | 247 |
| 688 | Staybridge Suites | |
| 729 | Oakwood at Canal Square | |
| 742 | Courtyard Indianapolis at the Capitol | |
| 766 | Residence Inn Indianapolis Downtown on the Canal | |
| 787 | Hampton Inn Indianapolis Downtown | |
| 807 | Homewood Suites by Hilton Indianapolis-Downtown | |
| 826 | Sheraton Indianapolis City Centre | |
| 835 | Hampton Inn Indianapolis Downtown IUPUI | |
| 860 | Homewood Suites by Hilton Indianapolis Downtown | |
| 871 | Hyatt Place Indianapolis Downtown | |
| 873 | Hyatt House Indianapolis / Downtown | |
| 938 | Hilton Garden Inn Indianapolis Downtown | |
| 987 | Tru | |
| 1005 | Home2 Suites | |
| 1031 | Hotel Indy, A Tribute Portfolio Hotel | 90 |
| 1052 | Aloft | |
| 1067 | TownePlace Suites | |
| 1186 | The Alexander, Autograph Collection | 209 |
| 1390 | La Quinta Inn & Suites | |
| 1458 | Atlas Hotel | |
| 1981 | Nestle Inn *(guest house)* | |
| 2510 | Bottleworks Hotel | |
| 3067 | 1244 | |

Six inside 400 m, twenty inside 800 m. Nine of them the app already draws,
because Gen Con runs events in them.

**37 hotels and one guest house — and nothing else.** No hostels, no motels, no
serviced apartments, no B&Bs in the box. That is a real finding about downtown
Indianapolis, not a gap in the query: hostels and motels were asked for by name
and came back empty. Indy Hostel exists but is about 5 km north, outside any
sensible walk.

**No Airbnb or Vrbo, and there never will be from this source.** Short-let
platforms do not publish their inventory to OpenStreetMap — the listings are not
public places, they are private flats, and their addresses are deliberately
withheld until you book. Any Airbnb or Vrbo coverage has to come from those
platforms' own APIs, which is section 2.

---

## 2. Can a server get the prices?

### The short version

| Source | Prices from a server? | The catch |
|---|---|---|
| **Gen Con block (Q-rooms)** | **No** | Behind a badge purchase and a login. No API, public or partner. |
| **Airbnb** | **No** | Partner-only, and closed to unsolicited applicants — they approach you. |
| **Vrbo** | Contract only | Via Expedia Rapid; needs EPS **and** Vrbo **and** Partnerize approval. |
| **Booking.com** | Contract only | Demand API needs Managed Affiliate Partner status and multi-stage approval. |
| **Amadeus** | Test tier free | Production needs a commercial agreement with Amadeus Enterprise. |
| **LiteAPI / Nuitée** | **Yes, free** | Core Rates→Prebook→Book free under ToS and a sane look-to-book ratio. |
| **Hotel chains direct** | **No** | Marriott, Hilton, Hyatt and IHG publish no public rate API. |
| **Hostelworld** | Case by case | Partner API exists; access granted individually. Moot here — no hostels. |
| **SerpApi (Google Hotels)** | Yes, paid | ~$10–25 per 1,000 requests, and Google is suing them; unresolved. |
| **Travelpayouts / Hotellook** | **Dead** | API and widgets switched off October 2025. |

### The two blockers that decide it

**This app has no server.** It is a static bundle. Every one of the APIs above
needs a key, and a key in a static bundle is a public key — anyone can read it
out of `index-*.js` and spend your quota. There is no runtime to hide it behind,
so any price data has to be fetched at *build* time by a scheduled job and
committed, exactly as `fetch-events`, `fetch-exhibitors` and `fetch-eateries`
already do. That is workable, and it means prices are as-of-last-run rather than
live — which for hotel rates over a convention week is a real loss of accuracy
that the page would have to state on every row.

**The number that matters is the one nobody can fetch.** Gen Con's block is run
by Q-rooms; housing opens at noon Eastern 157 days before the convention
Wednesday, and the portal is reachable only through a Gen Con account that has
already bought a badge. Rates and inventory live inside it. There is no public
list and no API. So a page showing Booking.com's rack rate for the JW Marriott
while omitting the block rate would be confidently wrong about the only
comparison a Gen Con attendee actually makes. Worse than no page.

### On the individual sources

**Amadeus** is the usual first answer and the tier boundary is the catch: the
free self-service tier is a *test* environment with limited data, and going to
production means a commercial agreement with Amadeus Enterprise.

**LiteAPI (now Nuitée Connect)** is the one genuinely free option — the core
rates-and-booking workflow is free to use under its terms, assuming a reasonable
look-to-book ratio. A price-display page with no bookings is *all* look and no
book, which is precisely the ratio those terms exist to police. Worth reading
their ToS carefully before building on it.

**SerpApi** would work technically and costs real money, and Google sued them
over exactly this. SerpApi moved to dismiss in February 2026 and the case is
unresolved as of August 2026. They sell indemnification on paid plans, which
tells you what they think the risk is. I would not build a hobby app on it.

**Scraping the hotels or the OTAs directly** is the option not in the table,
because it is the one to say no to plainly: those sites are aggressively
bot-protected, it violates their terms, and it breaks silently and often.

---

## 3. What I would actually build

The honest version of a hotel page for this app does not lead with prices.

The repo already has all 16 campus buildings, their real footprints, the
pavement graph, and a walking-time model with floor changes and skywalks in it.
That means it can answer a question no price site can: **how long is the walk
from this hotel to Exhibit Hall A, on the route you would really take, on the
day.** Rank by that, show which have skywalk access, and link each one to its
Gen Con housing entry. It works offline, needs no key, and cannot go stale.

Prices can land on that page later if you want them, via a scheduled fetch and a
visible "as of" date — but they belong beside the walk time, not instead of it,
and the page has to be honest that the block rate is not among them.

---

## Method, and what could not be checked

**The inventory** came from Nominatim, not Overpass: `overpass-api.de` was
returning 503 and then 504 on a single-node query throughout, and the other
three mirrors this repo uses are blocked by the network policy of the
environment this was run in. Nominatim is a geocoder rather than a tag dump and
caps each answer, so **38 is a floor rather than a census** — ten search terms
were merged by OSM id, and the `hotel` query returned 37 against a limit of 50,
so it was not truncated. Box: 39.74–39.79 N, 86.13–86.19 W. Distances are
haversine from the ICC's north-west anchor in `src/data/venues.ts`.

**The pricing findings were read, not tested.** Every host in that table —
Amadeus, Booking, Expedia, Airbnb, Vrbo, Hotelbeds, SerpApi, LiteAPI, Q-rooms —
is blocked by the egress proxy of the environment this was run in, so not one
endpoint was called. The table is documentation and reporting, and the tier
boundaries in particular are the sort of thing that changes quietly. Verify
before building.

**What was checked directly:** `gencon.com` is reachable, and its
`/api/v1/conventions` carries no hotel or housing field of any kind; its
`/housing` redirects to a sign-in; its housing page states the housing date in
prose. That last one corrected a wrong estimate on the Key dates page — see the
README's "Key dates" section.
