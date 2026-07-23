# Phase 1D — Cash Ownership

## Current-day operational writes

`BranchID` + `BusinessDayID` from `resolveBranchDayAndShiftForWrite`:

* Expenses POST
* Incomes POST
* Deductions POST (both out/in rows)
* Treasury transfers
* Tips / funding / payout (via `requireBranchOperationAccess` + day for date)

## Past-date writes

`resolveBranchDayForDate(activeBranchId, date)`:

* Requires existing `TblNewDay` for `(branch, date)`
* Does **not** attach to open day
* Does **not** auto-create a business day
* Missing day → 400 `NO_BUSINESS_DAY_FOR_DATE`

## Sale cash

Inherited from invoice via `InsCashMoveSales` (and app rewrite paths on invoice update).

## System / payroll

`POST /api/payroll/daily/post-to-cash` uses server active branch + `getBusinessDayByDate(branch, workDate)`. Never browser branch.

## Mutations

Expense/income update/delete validate persisted `BranchID` against active branch.
