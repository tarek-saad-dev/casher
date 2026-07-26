# Phase 1L — Ledger Contract

**Date:** 2026-07-25

## Model

Writable account = EmpID + BranchID. Global = SUM only (`vw_EmpLedgerGlobalBalance`).

## Branch source map

`resolveLedgerEntryBranchSource(entryReason)` documents:

| Reason | Source |
|---|---|
| hourly_wage | payroll row |
| monthly_salary | branch payroll plan |
| target | daily target |
| advance / payout / funding | CashMove |
| tip / commission | sale or CashMove |
| bonus | session branch |
| correction / reversal | original ledger entry |

Writers must still validate persisted IDs — the map does not invent BranchID.

## Payout

Limit = `getEmployeeBranchBalance(EmpID, sessionBranchID)` — never global.

## Status

Monthly INSERT stamps BranchID. Advance/payout/tip/funding/sync stamp BranchID. Cross-branch payout forbidden.
