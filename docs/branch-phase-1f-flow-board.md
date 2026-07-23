# Phase 1F — Flow Board

**Route:** `GET /api/operations/flow-board`  
**File:** `src/app/api/operations/flow-board/route.ts`

## Isolation

Uses authenticated `auth.activeBranchId` (never browser branch picker).

SQL filters include:

* Bookings: `AND b.BranchID = @branchId`  
* Queue tickets: `AND qt.BranchID = @branchId`  
* Emp assignment for board staff: `AND ea.BranchID = @branchId`

## Response metadata

Returns `activeBranch` (`branchId`, `branchCode`, `branchName`, `shortName`) so the UI can label the board without a switcher.

## Unchanged

No second branch, no internal branch switcher UI. Emp conflict timelines for availability remain emp-global elsewhere; the board itself only shows the active branch’s bookings/tickets.
