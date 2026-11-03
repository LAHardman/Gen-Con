# Schedule and Events

## Current state

The Schedule page lets a traveller browse four convention days, search and
filter the event catalogue, add individual showings to a day-by-day plan, and
review room locations, walking time, and schedule conflicts. Event times and
prices can also feed the Budget page.

The catalogue is generated at build time from Gen Con's official
`/api/event_search` endpoint and deployed as `events.json`. The importer checks
that the day slices add up to the endpoint's total and refuses to write a
short or unusable catalogue. The browser does not call Gen Con directly.

**Current limitation:** the deployed site has no `events.json`. The official
endpoint returned an empty catalogue after the 2026 convention, so new visitors
currently have no events to search or schedule. The 2026 eventdb scrape was
paused and is not part of the deployed app. If the feed is absent, the map and
other pages remain available; the Schedule reports that there is no event
data.

## User story

When Gen Con publishes its 2027 catalogue, Dana opens the trip planner to start
organising the four days. She searches for a game her friends recommended,
compares separate showings, and adds one to Thursday. She adds two more sessions
and checks the day view for walking time and clashes before sharing the plan.
When she adds a priced session, its cost appears in the trip budget without
being entered twice.

If Gen Con changes the catalogue fields in 2027, the importer tests should
expose that change before a broken or incomplete feed is published. If the
catalogue is not yet available or cannot be loaded, the app should say that
clearly rather than display invented events.

## Planned change

No behavior change is part of this documentation task. Before relying on the
2027 catalogue:

1. Capture a small real response from Gen Con's official endpoint when 2027
   events are published; do not infer its fields from the 2026 fixture.
2. Verify the importer maps the event ID, title, type, game system, location,
   start and end times, duration, cost, ticket availability, and age
   requirement where Gen Con provides them.
3. Add the response as a small fixture and test the mapping, including
   missing optional fields, zero-cost events, and time-zone offsets.
4. Run the official importer and confirm its total and day-slice checks pass.
   Inspect representative events and room assignments before deployment.
5. Deploy and verify that the published feed returns successfully, the page
   shows an event count and catalogue year, and a traveller can add a showing
   and see it in the Schedule.
6. If the official catalogue is still unavailable, keep the app honest: use
   only clearly labelled sample data for demonstrations, never as real Gen Con
   events. The 2026 eventdb scrape stays lower priority and separate.

## Desired result

Dana can use the current official catalogue to find sessions, build a plan,
review travel and time conflicts, and include event costs in her budget. When
the 2027 catalogue becomes available, it can be imported and verified without
silently losing important fields. If no real catalogue is available, the app
does not pretend that sample data is official.

## How to test

| ID | User-visible behavior | Test to run |
|---|---|---|
| EVT-01 | The importer maps an official event record into the fields the app uses. | `scripts/fetch-events.test.mjs`: `one event, as the app wants it`; add a real 2027 fixture before relying on it |
| EVT-02 | Missing feed data is shown as an absent state rather than a load error. | `src/hooks/useEventFeed.test.ts`: `the ordinary path` |
| EVT-03 | A configured mirror is used when the deployed feed is unavailable, including host errors. | `src/hooks/useEventFeed.test.ts`: `when the host it came from is gone` |
| EVT-04 | A traveller can add a specific showing, and the planned day displays it. | `src/components/PlanView.test.tsx`: `adding a session`, `the day drawn to scale` |
| EVT-05 | The Schedule identifies an older catalogue rather than presenting it as the planned convention's year. | `src/components/PlanView.test.tsx`: `an old catalogue` |
| EVT-06 | The importer refuses a partial or empty catalogue instead of replacing the schedule with incomplete data. | `src/lib/import-events.ts`: `importCatalogue` total and usable-event guards; add integration tests around these guards before the 2027 import |

For code changes, run `npm run check` and `npm run build`. The 2027 source
fixture, importer result, deployed `events.json`, and live schedule check are
additional release checks; unit tests alone cannot prove the live catalogue
was imported correctly.
