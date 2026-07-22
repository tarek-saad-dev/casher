# Phase 1B Schema — Multi-Branch Foundation

**Date:** 2026-07-22  
**Database:** cloud / `last132`  
**Migration:** `db/migrations/add-multi-branch-foundation.sql`

## Tables created

Only these three tables were added:

| Table | Purpose |
|-------|---------|
| `dbo.TblBranch` | Branch registry |
| `dbo.TblUserBranchAccess` | Where a user may work (not page ACL) |
| `dbo.TblEmpBranchAssignment` | Where an employee may be assigned |

No `BranchID` column was added to operational, financial, booking, HR, payroll, queue, report, or treasury tables.

## `TblBranch`

* Identity PK `BranchID`
* Unique normalized uppercase `BranchCode`
* Blank code/name rejected by CHECK
* Defaults: `Africa/Cairo`, cutoff `04:00`, `IsActive = 1`, `CreatedAt = SYSUTCDATETIME()`
* Nullable `CreatedByUserID → TblUser` (NO ACTION; safe with soft-delete)
* Does **not** store open-day, shift, treasury, or balance state

## Founding seed

Resolved only by `BranchCode = N'GLEEM'`:

* Name: `جليم – سابا باشا`
* ShortName: `جليم`
* TimeZone: `Africa/Cairo`
* BusinessDayCutoffTime: `04:00`
* Active

Never assume `BranchID = 1` in application code.

## Explicit non-changes

* `TblNewDay` untouched
* `TblShiftMove` untouched
* Invoices, cash, bookings, queue, attendance, payroll, targets, ledger untouched
