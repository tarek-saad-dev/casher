# Phase 1E — Full-Day Report

**Service:** `src/lib/reports/full-day-report.ts`  
**API:** `GET /api/admin/reports/full-day?date=&branchId=&scope=all`

## Filtering

Every financial query uses `BranchID = @branchId`. Legacy cash with null `BusinessDayID` is included via `BranchID + invDate`. Formulas unchanged.

## Modes

* **single:** default active branch (or validated `branchId`)
* **all:** independent per-branch reports, then consolidated numeric totals

## GLEEM baseline

Fingerprint capture (`09-capture-phase1e-report-baseline.cjs`) showed unscoped == scoped for GLEEM-only data on sample days; pre/post migration dayTotals MATCH.
