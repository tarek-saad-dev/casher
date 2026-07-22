# Phase 1C Schema — Branch Business Day & Shift

**Date:** 2026-07-22  
**Database:** cloud / `last132`  
**Migration:** `db/migrations/add-branch-business-day-and-shift.sql`

## Tables modified

| Table | Change |
|---|---|
| `TblNewDay` | Added `BranchID NOT NULL`; PK swapped `NewDay` → `ID`; `UNIQUE (BranchID, NewDay)`; filtered one-open-per-branch |
| `TblShiftMove` | Added `BranchID NOT NULL`, `BusinessDayID NOT NULL`; FKs; user-global one-open filtered unique |
| `TblTreasuryCloseRecon` | Added FK `NewDay INT → TblNewDay.ID` (compatibility; column already stored day ID) |

## PK / CT note

Live SQL Server **Change Tracking** on `TblNewDay` blocked dropping `PK_TblNewDay(NewDay)`. Migration:

1. `DISABLE CHANGE_TRACKING` on `TblNewDay`
2. Drop date PK / create PK on `ID`
3. `ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON)`

Sync infrastructure may see a CT reset for this table; operational row values were not rewritten.

## Dropped / replaced constraints

* Dropped `FK_TblShiftMove_TblNewDay` (`ShiftMove.NewDay → NewDay.NewDay` CASCADE)
* Dropped `PK_TblNewDay (NewDay)`
* Created `PK_TblNewDay (ID)`
* Created `FK_TblShiftMove_BusinessDayID` → `TblNewDay.ID`
* Created `FK_TblNewDay_BranchID` / `FK_TblShiftMove_BranchID`

## Explicit non-changes

No `BranchID` on invoices, cash, bookings, queue, attendance, payroll, targets, ledger.
