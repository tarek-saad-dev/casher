# Phase 1D — Treasury Isolation

## Reconciliation

`closeTreasuryDay` inserts `TblTreasuryCloseRecon.BranchID = input.branchId` (active branch day).  
Closing GLEEM cannot write recon for another branch’s day ID.

## Operational reads (branch filtered)

* `/api/treasury/balance`
* `/api/treasury/movements`
* `/api/treasury/daily-summary`
* `/api/treasury/period-summary`
* `/api/treasury/hold-breakdown`
* `/api/treasury/reconciliation`
* `/api/treasury/current`

## Deferred (unsafe for second branch)

Owner full-day, partner reports — marked `// PHASE1D: unsafe for multi-branch until reporting phase`.

## Unchanged

Expected/actual/variance formulas, payment-method math, close notes, approval behavior.
