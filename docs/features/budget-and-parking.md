# Budget and parking

## Current state

The Budget page is already a trip-cost tool. It lets people add travellers,
record costs by category, say who shares each cost, add badges, and review
per-person totals. Booked hotels and priced sessions on the schedule become
budget lines automatically. Parking is offered under "Getting there": choose
how many days, select a garage, and add an estimated cost. The official iPark
option is a booking link when its rate is not available; downtown garage rates
are labelled as reported ranges.

The budget data is saved in browser storage. The event feed is currently
missing from the deployed site, so automatic event-cost lines may be absent
until event data is available. The rest of the budget can still be filled in
manually.

## User story

Jordan is planning a four-day Gen Con trip with two friends. Jordan adds all
three travellers, records the hotel and travel costs, then chooses a garage
for the days they expect to drive. The parking estimate appears in the trip
total, clearly marked as a reported estimate rather than a guaranteed price.
Jordan assigns the shared costs to the group, checks each person's total, and
changes the parking amount when the actual booking receipt arrives. If the
friends later split up, Jordan can assign a cost to only the person who owes
it.

## Planned change

No behavior change is part of this documentation task. Before extending the
budget or parking feature:

1. Keep the existing parking UI tests aligned with the story above.
2. Use the story above to decide whether a separate parking plan is needed.
   The current picker already adds a days-based estimate to the budget; avoid
   adding a second saved parking plan unless a user need requires it.
3. Keep event-derived budget lines and their tests tied to a valid event feed.

## Desired result

Jordan can see an honest trip total, understand who owes what, and include
parking without mistaking an estimate for a confirmed price. An actual parking
receipt can replace the estimate. The budget remains usable when event data is
unavailable, and every promised behavior has a test that runs in CI.

## How to test

| ID | User-visible behavior | Test to run |
|---|---|---|
| BUD-01 | Adding travellers creates separate, visible per-person totals. | `src/components/BudgetView.test.tsx`: `who is going` |
| BUD-02 | Shared and assigned costs are allocated correctly, including cents that do not divide evenly. | `src/data/budget.test.ts`: `dividing a cost between people`, `deciding whose a cost is`, and `the budget as a whole` |
| BUD-03 | User-entered costs can be added, edited, and removed without turning half-entered amounts into zero. | `src/components/BudgetView.test.tsx`: `costs somebody types` |
| BUD-04 | A hotel booking and a priced scheduled event create budget lines without re-entry. | `src/components/BudgetView.test.tsx`: `a hotel booked on the hotels page`, `a priced session on the schedule`; `src/data/budget-lines.test.ts` |
| BUD-05 | Badge choices and estimates are clear and editable. | `src/components/BudgetView.test.tsx`: `what a badge costs` |
| PAR-01 | Official parking is distinguished from reported garage rates; an unpublished official price is not shown as free. | `src/components/BudgetView.test.tsx`: `parking` |
| PAR-02 | A reported garage range, distance, and facilities are shown accurately. | `src/components/BudgetView.test.tsx`: `parking` |
| PAR-03 | Choosing a garage and number of days adds the expected estimate to the trip total. | `src/components/BudgetView.test.tsx`: `parking` |
| PAR-04 | The estimate can be changed to match the receipt. | `src/components/BudgetView.test.tsx`: `parking` |
| BUD-06 | Removing a traveller removes their assignments and badge without changing other travellers' data. | `src/hooks/useBudget.test.ts`: `somebody leaving the trip` |

The parking tests are active. For code changes to either feature, run
`npm run check` and `npm run build`.
