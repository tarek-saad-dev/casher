# Phase 1L — Reconciliation

**Date:** 2026-07-25  
**Service:** `employeeLedgerReconciliationService`  
**Route:** `GET /api/admin/hr/employee-ledger/reconciliation`

## Scope

Session/report branch only. Query `branchId` / `BranchID` rejected.

Compares within BranchID:

* Branch payroll entitlements vs hourly/monthly ledger credits  
* Advances CashMove vs advance ledger debits  
* Payouts CashMove vs payout ledger debits  
* Missing / orphan rows  
* Hourly ledger with wrong BranchID (orphan when payroll BranchID ≠ ledger BranchID)  
* Missing monthly from branch plans  

Global employee total remains a read-only secondary summary elsewhere (`vw_EmpLedgerGlobalBalance`).

## Status

| Piece | Status |
|---|---|
| BranchID filters on payroll/ledger/cash | Done |
| Session branch on route | Done |
| Body/query BranchID rejected | Done |
