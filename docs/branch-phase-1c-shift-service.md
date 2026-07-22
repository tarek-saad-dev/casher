# Phase 1C Shift Service

**Module:** `src/lib/branch/shiftSession.ts`

## Operations

* `getUserOpenShift(userId)` — user-global (cross-branch)
* `getUserOpenShiftForBranch(userId, branchId)`
* `openShift(branchContext, userId, shiftId)`
* `closeShift(branchContext, shiftMoveId)`
* `listOpenShiftsForBranch`
* `validateShiftBelongsToBranch`
* `forceCloseBranchShifts` (branch-scoped only)

## Rules

* New shifts inherit `BranchID`, `BusinessDayID`, and denormalized `NewDay` from the active branch open day
* Cannot open without an open branch day
* Cannot open if the user has **any** open shift (including another branch)
* Close requires shift `BranchID` = active branch
* No remaining active path with global `UPDATE TblShiftMove SET Status=0 WHERE Status=1`

## Compatibility

`NewDay` remains populated for legacy joins/reports until a later cleanup phase.
