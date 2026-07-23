# Phase 1D Schema — Financial Branch Ownership

**Migration:** `db/migrations/add-financial-branch-ownership.sql`  
**Database:** cloud / `last132`

## Columns

| Table | Column | Nullability | FK |
|---|---|---|---|
| `TblinvServHead` | `BranchID` | NOT NULL | `TblBranch.BranchID` |
| `TblinvServHead` | `BusinessDayID` | NOT NULL (after clean backfill) | `TblNewDay.ID` |
| `TblCashMove` | `BranchID` | NOT NULL | `TblBranch.BranchID` |
| `TblCashMove` | `BusinessDayID` | **NULL allowed for legacy rows** (Phase 1E live count: **19**) | `TblNewDay.ID` |
| `TblTreasuryCloseRecon` | `BranchID` | NOT NULL | `TblBranch.BranchID` |

Invoice PK remains `(invID, invType)`. No BranchID in PK. `allocateInvID` unchanged.

## Indexes

* `IX_TblinvServHead_Branch_invDate`
* `IX_TblinvServHead_Branch_BusinessDay`
* `IX_TblCashMove_Branch_invDate`
* `IX_TblCashMove_Branch_BusinessDay`
* `IX_TblCashMove_Branch_PM_invDate`
* `IX_TblTreasuryCloseRecon_Branch_NewDay`

## Cross-table equality

Enforced in application services (not SQL CHECK):

* Invoice.BranchID/Day = Shift.BranchID/Day when shift present
* Cash.BranchID/Day = Shift when shift present
* Sale cash Branch/Day = invoice Branch/Day
* Recon.BranchID = referenced day.BranchID

Branch ownership is immutable after insert.

## Explicit non-changes

No BranchID on: detail, payment, client, booking, queue, attendance, payroll, targets, ledger, budgets. `TblTreasuryCloseRecon.NewDay` not renamed.
