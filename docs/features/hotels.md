# Hotels

## Current state

The Hotels page lists a sample of hotels near the convention, sorted nearest
first. Each row says what is known about the hotel: distance in words and
metres, which nights a price covers, and a booking link only when one exists.
Convention block hotels point to Gen Con's housing, not the hotel's own desk.
Prices are labelled as a published block rate or an indication (never a
quote), carry an age, and show a missing price as a gap, not zero. The list
says it is a sample, not every hotel. Sort and filter controls fold away.
A booked hotel becomes a budget line.

## User story

Maya wants to stay within walking distance but cannot get a block room. She
opens Hotels, sees the nearest options first, switches to price order and
notices the unpriced ones sit last, not first. One hotel shows two services
disagreeing by $40, and the row says so. She reads that the price is an
indication, opens the listing's own link, books, and records the stay. It
shows up in her budget.

## Planned change

None. Keep hotel data labelled as a sample until a complete source exists.

## Desired result

Nobody mistakes an estimate, a gap or a sample for a confirmed price.

## How to test

| ID | Behavior | Test |
|---|---|---|
| HOT-01 | Nearest-first by default; price sort puts unpriced last | `src/components/HotelsView.test.tsx`: `putting the list in an order`, `opens showing everything, nearest first` |
| HOT-02 | Block hotels send the user to Gen Con; no invented links | `HotelsView.test.tsx`: `deciding where a hotel can be booked` |
| HOT-03 | Prices are labelled, aged, and gaps are not zero | `HotelsView.test.tsx`: `what it refuses to be mistaken for`, `how old a price is` |
| HOT-04 | Disagreeing sources are shown, not hidden | `HotelsView.test.tsx`: `when two services disagree` |
| HOT-05 | The list says it is a sample | `HotelsView.test.tsx`: `says the hotel list is a sample` |
| HOT-06 | A booked hotel becomes a budget line | `src/components/BudgetView.test.tsx`: `a hotel booked on the hotels page` |
