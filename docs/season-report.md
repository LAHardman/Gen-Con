# Season report — 2026-W36

Written by `npm run season:check` (see `scripts/season/`). Regenerated weekly
by the season workflow; the commit is also what keeps the scheduled workflows
inside GitHub's 60-day activity window.

| Probe | Status | Summary |
| --- | --- | --- |
| Store account deadlines | ✗ FAIL | Apple Developer membership renewal: due 2027-07-22, 323 days out; Google Play target API level review: due date passed 2 days ago (2026-08-31); Android upload keystore backup verified: no date on file |
| Food tag vocabulary | ✓ ok | all 49 tags the food vendors carry are filed or deliberately absent |
| OpenStreetMap table ages | ✓ ok | every OSM-sourced table is inside its shelf life |
| Parking figures | ✓ ok | checked 2026-08-28, 4 days ago — 7 entries, Gen Con's own among them |
| Badge prices | ⚠ warn | 2027's prices are not published yet; the app shows 2026's, labelled, with an estimate from 4 cards beside it |
| Event feed fields | ✓ ok | all 14 fields the importer reads are on the feed |
| Key dates vs the API | ✓ ok | the rule reproduces all 4 published milestones for 2027 on, to the instant |
| Hotel block year | ✓ ok | the block on file is 2025's, which is still the one Gen Con publishes — 2027's usually appears when housing opens, 157 days before the show |
| Block Party hours | ⚠ warn | hours on file are 2025's and the page shows none yet — 2027's are still commented out |
| Gen Con floor-plan tiles | ✓ ok | maps/v9 is still the newest generation the CDN serves |
| Basemap tile providers | ✓ ok | every configured tileset served a real tile of downtown |
| Events landing in rooms | ✓ ok | 27,467 events read from https://lahardman.github.io/Gen-Con/events.json; 11 without a room (0.04%), which is the healthy floor |
| Events mirror | – skip | no mirror is configured |
| Scheduled workflows still enabled | ✓ ok | all 6 workflows are enabled |
| Automation pull requests being merged | ✓ ok | no automation pull requests are waiting |
| Booth grid agreement | ✓ ok | the stand list, the placed grid and the hall divides all still agree |

## Needs attention

### Store account deadlines — ✗ FAIL

Apple Developer membership renewal: due 2027-07-22, 323 days out; Google Play target API level review: due date passed 2 days ago (2026-08-31); Android upload keystore backup verified: no date on file

To fix:

1. When it is dealt with, move `due` forward a year in `scripts/season/store-dates.json` — the probe goes quiet on its own.
2. Google ratchets the required target API level yearly, with deadlines usually at the end of August — https://developer.android.com/google/play/requirements/target-sdk says the current one. Falling behind first hides the app from new users on current Android. The fix is the annual maintenance release: bump targetSdkVersion, build, submit.
3. Put the real date into `scripts/season/store-dates.json` as `"due": "YYYY-MM-DD"` on the "Android upload keystore backup verified" row.
4. Only applies once an upload keystore exists — it is generated when you first sign an Android release, not before, so leave this null until then. After that: a yearly reminder to confirm it is still in both places it should be (the ANDROID_KEYSTORE_BASE64 repository secret and an offline copy). It is the one secret here that cannot be reissued — Apple certificates reissue and Play can reset an upload key, but a lost keystore ends that app's update path for good.

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
6. Then `npm run check`: `badge-prices.test.ts` holds the shape and the trend, and `npm run build:pack` puts the new card where installed copies can take it without a release.

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

