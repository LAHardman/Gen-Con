# Key dates

## Current state

The Key dates page counts down to the dates that decide whether you get to go
(badge sales, housing, event registration). Dates are shown in Indianapolis
time, in the order the year happens, with exactly one row marked "next". Once
the convention is over it rolls on to the next year. Gen Con does not publish
every milestone, so some dates are estimates. Each estimate says so on the row,
shows its reasoning, counts down as a bound ("by"), and is never marked
"next".

## User story

Sam is in Chicago and misses things by a day. She opens Key dates, sees
"in 12 days" on the housing opening in Indianapolis time, and sets a reminder.
Two rows are drawn differently and say "estimate"; she reads why and treats
them as a guess. Nothing tells her to act on a guess.

## Planned change

None. Dates come from `src/data/key-dates.ts`; update them there each year.

## Desired result

Every date is either published or visibly an estimate, and is correct for the
year being planned.

## How to test

| ID | Behavior | Test |
|---|---|---|
| DAT-01 | Names the planning year; rolls over after the convention | `src/components/DatesView.test.tsx`: `names the year somebody is planning for`, `rolls on to next year...` |
| DAT-02 | Indianapolis clock, countdown, past rows marked | `DatesView.test.tsx`: `prints each date at Indianapolis' clock...`, `counts down...` |
| DAT-03 | Exactly one "next" row, chronological order | `DatesView.test.tsx`: `marks exactly one row...`, `keeps every row in the order...` |
| DAT-04 | Estimates are visibly different, explained, never "next" | `DatesView.test.tsx`: `the estimated dates` |
| DAT-05 | Date rules themselves | `src/data/key-dates.test.ts` |
