# Season report — 2026-W44

Written by `npm run season:check` (see `scripts/season/`). Regenerated weekly
by the season workflow; the commit is also what keeps the scheduled workflows
inside GitHub's 60-day activity window.

| Probe | Status | Summary |
| --- | --- | --- |
| Food tag vocabulary | ✓ ok | all 49 tags the food vendors carry are filed or deliberately absent |
| OpenStreetMap table ages | ✓ ok | every OSM-sourced table is inside its shelf life |
| Parking figures | ✓ ok | checked 2026-08-28, 60 days ago — 7 entries, Gen Con's own among them |
| Badge prices | ⚠ warn | 2027's prices are not published yet; the app shows 2026's, labelled, with an estimate from 4 cards beside it |
| Event feed fields | ✗ FAIL | event_search answered 200 but no event records were recognised in the response |
| Key dates vs the API | ✓ ok | the rule reproduces all 4 published milestones for 2027 on, to the instant |
| Hotel block year | ✓ ok | the block on file is 2025's, which is still the one Gen Con publishes — 2027's usually appears when housing opens, 157 days before the show |
| Block Party hours | ⚠ warn | hours on file are 2025's and the page shows none yet — 2027's are still commented out |
| Gen Con floor-plan tiles | ✓ ok | maps/v9 is still the newest generation the CDN serves |
| Basemap tile providers | ✓ ok | every configured tileset served a real tile of downtown |
| Events landing in rooms | ✗ FAIL | the deployed schedule answered HTTP 404 at https://lahardman.github.io/Gen-Con/events.json |
| Events mirror | – skip | no mirror is configured |
| Scheduled workflows still enabled | ✓ ok | all 6 workflows are enabled |
| Automation pull requests being merged | ⚠ warn | 1 automation PR have waited more than a fortnight — the data in them is stalling |
| Booth grid agreement | ✓ ok | the stand list, the placed grid and the hall divides all still agree |

## Needs attention

### Badge prices — ⚠ warn

2027's prices are not published yet; the app shows 2026's, labelled, with an estimate from 4 cards beside it

What was seen:

- Gen Con's press index lists badge-price announcements for 2026, 2025, 2024, 2023, 2022.
- 2024's announcement (https://www.gencon.com/press/2024-reg-dates-and-badge-prices) carries no readable price table — HTTP 200. Left out of the history rather than filled in.
- inside an HTML comment (last cycle's, most likely): four-day $164
- inside an HTML comment (last cycle's, most likely): thursday $83
- inside an HTML comment (last cycle's, most likely): friday $83
- inside an HTML comment (last cycle's, most likely): saturday $112
- inside an HTML comment (last cycle's, most likely): sunday $41
- inside an HTML comment (last cycle's, most likely): trade-day $302

To fix:

1. Nothing to copy yet — this probe proposes the entry the day Gen Con announces it, which is usually mid-January.
2. Add the new card to `COMPILED_HISTORY` in `src/data/badge-prices.ts`, oldest first, and set `COMPILED_CHECKED` to today. Nothing else moves: the latest price, the base year and the trend are all derived from that list, so they cannot end up disagreeing with each other.
3. Gen Con announces each card at https://www.gencon.com/press/pressreleases in January, and repeats it as a table on https://www.gencon.com/gen-con-indy/your_badge. Take it from the release — its title names the year, and the page's table does not.
4. Check the small print under the page's table too: the Marion County admissions tax (`COMPILED_TAX`) and the USPS packet fee (`COMPILED_SHIPPING_CENTS`) are stated there and are not in the table.
5. Prices found inside an HTML comment on the badge page are last cycle's, left there while the new one is written — never ship those as the new year's.
6. Then `npm run check`: `badge-prices.test.ts` holds the shape and the trend, and `npm run build:pack` puts the new card where installed copies can take it without a new deploy of the app code.

### Event feed fields — ✗ FAIL

event_search answered 200 but no event records were recognised in the response

What was seen:

- Top-level shape: object

To fix:

1. The fields `shape()` reads live in `scripts/fetch-events.mjs`; change the source names there to the renames reported above.
2. Then run `npm run fetch:events -- --limit 100` and open a few rows of `public/events.json` — the fields must be populated, not merely absent of errors.
3. `npm run check` runs the import tests, which read recorded pages and will say if the shape moved further than a rename.

### Block Party hours — ⚠ warn

hours on file are 2025's and the page shows none yet — 2027's are still commented out

What was seen:

- inside an HTML comment (last year's, most likely): "Thursday - Saturday, 9am - 9pm"
- inside an HTML comment (last year's, most likely): "Sunday, 9am - 4pm"
- inside an HTML comment (last year's, most likely): "Wednesday Tapping Party: 5pm - 10pm"
- inside an HTML comment (last year's, most likely): "Thursday - Saturday, noon - 10pm"

To fix:

1. Nothing to copy yet; this probe proposes the lines the week the page shows them.
2. The one place to change is the hours block in `src/data/food.ts` — `FOOD_TRUCK_HOURS` and `BEER_GARDEN_HOURS`, each with its `year`.
3. Gen Con states them in prose on https://www.gencon.com/gen-con-indy/block-party ("Thursday - Saturday, 9am - 9pm / Sunday, 9am - 4pm"); the beer garden's (Sun King) are usually a separate line.
4. Check whether the hours are in the visible page or still in an HTML comment — commented-out hours are last year's, left there while the new page is written, and must not be shipped as this year's.
5. Then `npm run check`: `food.test.ts` holds the shape.

### Events landing in rooms — ✗ FAIL

the deployed schedule answered HTTP 404 at https://lahardman.github.io/Gen-Con/events.json

To fix:

1. If the site has moved, set the `SEASON_SITE` repository variable to its new address.
2. If the deploy is broken, the Actions tab of the repository says which step; `deploy.yml` builds and publishes it weekly.

### Automation pull requests being merged — ⚠ warn

1 automation PR have waited more than a fortnight — the data in them is stalling

What was seen:

- 26 days: Refresh the stand list from Gen Con — https://github.com/LAHardman/Gen-Con/pull/35

To fix:

1. Merge them if their checks pass; the refresh workflows already enable auto-merge on a passing refresh, so one waiting this long usually has a failing check worth reading — that failure is how a new year announces itself.
2. Auto-merge needs "Allow auto-merge" ticked once, under repository Settings → General → Pull Requests.
