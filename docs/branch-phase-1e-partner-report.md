# Phase 1E — Partner Report

**Service:** `buildPartnersMonthlyReport(year, month, branchId)`  
**API:** `GET /api/admin/reports/partners?year=&month=&branchId=&scope=all`

## Per branch

1. Branch revenue/expenses/advances with `BranchID` filters  
2. Resolve `getEffectiveBranchPartnerShares(branchId, monthEnd)`  
3. Entitlement = branchNet × share  

## Consolidation

`partnerConsolidated = Σ entitlements across branches` — never one % on a mixed total.

## Overrides

`partners-employee-overrides.json` applied only when branch is GLEEM. Temporary until SQL migration of overrides.
