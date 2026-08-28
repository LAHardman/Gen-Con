# Season report — 2026-W35

Written by `npm run season:check` (see `scripts/season/`). Regenerated weekly
by the season workflow; the commit is also what keeps the scheduled workflows
inside GitHub's 60-day activity window.

| Probe | Status | Summary |
| --- | --- | --- |
| Store account deadlines | ⚠ warn | Apple Developer membership renewal: no date on file; Google Play target API level review: no date on file; Android upload keystore backup verified: no date on file |
| Food tag vocabulary | ✓ ok | all 49 tags the food vendors carry are filed or deliberately absent |
| OpenStreetMap table ages | ✓ ok | every OSM-sourced table is inside its shelf life |
| Parking figures | ✓ ok | checked 2026-08-26, 1 days ago — 6 garages on file |
| Event feed fields | ✓ ok | all 14 fields the importer reads are on the feed |
| Key dates vs the API | ✓ ok | the rule reproduces all 4 published milestones for 2027 on, to the instant |
| Hotel block year | ✓ ok | the block on file is 2025's, which is still the one Gen Con publishes — 2027's usually appears when housing opens, 157 days before the show |
| Block Party hours | ⚠ warn | hours on file are 2025's and the page shows none yet — 2027's are still commented out |
| Gen Con floor-plan tiles | ✓ ok | maps/v9 is still the newest generation the CDN serves |
| Basemap tile providers | ✓ ok | every configured tileset served a real tile of downtown |
| Events landing in rooms | – skip | the schedule at public/events.json (local) is the deliberately-fake sample |
| Events mirror | – skip | no mirror is configured |
| Scheduled workflows still enabled | – skip | no GitHub token in the environment — this probe runs in the weekly workflow |
| Automation pull requests being merged | – skip | no GitHub token in the environment — this probe runs in the weekly workflow |
| Booth grid agreement | ✓ ok | the stand list, the placed grid and the hall divides all still agree |

## Needs attention

### Store account deadlines — ⚠ warn

Apple Developer membership renewal: no date on file; Google Play target API level review: no date on file; Android upload keystore backup verified: no date on file

To fix:

1. Put the real date into `scripts/season/store-dates.json` as `"due": "YYYY-MM-DD"` on the "Apple Developer membership renewal" row.
2. The renewal date is on https://developer.apple.com/account under Membership details. A lapse removes the app from the App Store outright.
3. Put the real date into `scripts/season/store-dates.json` as `"due": "YYYY-MM-DD"` on the "Google Play target API level review" row.
4. Google ratchets the required target API level yearly, with deadlines usually at the end of August — https://developer.android.com/google/play/requirements/target-sdk says the current one. Falling behind first hides the app from new users on current Android. The fix is the annual maintenance release: bump targetSdkVersion, build, submit.
5. Put the real date into `scripts/season/store-dates.json` as `"due": "YYYY-MM-DD"` on the "Android upload keystore backup verified" row.
6. Not a renewal — a yearly reminder to confirm the keystore still exists in both places it should (repository secrets and the offline copy). It is the one unrecoverable secret; set due to a convenient annual date.

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

