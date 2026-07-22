# Phase 1C Backfill

**Target:** GLEEM via `BranchCode = N'GLEEM'` (never hardcode identity)

## Results (live `last132`)

| Metric | Count |
|---|---:|
| `TblNewDay` rows | 358 |
| Assigned to GLEEM | 358 |
| Null BranchID remaining | 0 |
| `TblShiftMove` rows | 804 |
| Assigned to GLEEM | 804 |
| Null BusinessDayID remaining | 0 |
| Shift/day mismatches | 0 |
| Open day rows altered (status/date) | 0 |
| Open shift status/times altered | 0 |

## Method

* Every existing day → GLEEM `BranchID`
* Every existing shift → GLEEM `BranchID` + matching `TblNewDay.ID` by `(NewDay date, GLEEM)`
* No deletes; no date/status/time rewrites
