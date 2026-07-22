# Phase 1C Verification

**Scripts:** `07-capture-phase1c-state.cjs`, `run-branch-business-day-and-shift-migration.ts`, `verify-branch-business-day-and-shift.ts`

## Pre/post fingerprints (unchanged)

| Metric | Value |
|---|---|
| NewDayCount | 358 |
| ShiftMoveCount | 804 |
| InvoiceHeadCount | 7749 |
| CashMoveCount | 11712 |
| ServPaymentCount | 2254 |
| OpenShiftChecksum | -1179226118 |
| OpenDayChecksum | 1715681 |
| Invoice/Cash/Payment checksums | unchanged |

## Invariants passed

* PK(`TblNewDay`) = `ID`
* Every day/shift owned by GLEEM
* No null ownership columns
* No shift/day mismatches
* No unexpected operational `BranchID` columns
* Idempotent second migration run passed

Open shifts remain open — reported as legacy state, not closed by migration.
