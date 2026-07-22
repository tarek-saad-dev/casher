# Phase 1C Business Day Service

**Module:** `src/lib/branch/businessDay.ts`

## Operations

* `getOpenBusinessDay(branchId)`
* `getBusinessDayById` / `getBusinessDayByDate`
* `openBusinessDay(branchContext, date?)`
* `closeBusinessDay(branchContext, { forceCloseShifts? })`
* `closeAndOpenBusinessDay`
* `validateBusinessDayBelongsToBranch`
* `getBranchBusinessDate` — uses branch timezone + cutoff (not silent global Cairo when metadata exists)

## Rules

* Branch ownership comes only from `requireActiveBranchContext` / `requireBranchOperationAccess`
* Browser `branchId` is ignored
* Open checks are **per branch**, not global
* Duplicate `(BranchID, NewDay)` fails
* Second active day in same branch fails
* Force-close of shifts is always `WHERE BranchID = @branchId`

## API surface

* `POST /api/day/open|close|close-and-open`
* `GET /api/day`

All authenticate and resolve active branch server-side.
