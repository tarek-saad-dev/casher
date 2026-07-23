# Phase 1E — Report Dependency Audit

**Date:** 2026-07-22  
**Database:** cloud / `last132` (sole source of truth)  
**Sync:** stopped and unused — not part of multi-branch architecture

## Active reports

| Report/API | Sources | Filters before 1E | Permission | Cache | Mode | Leakage | Phase 1E change |
|---|---|---|---|---|---|---|---|
| Full-day `/api/admin/reports/full-day` | Head, Cash, payroll, targets, NewDay | date only | page ACL | none | SELECTED_BRANCH / ALL_BRANCHES | high→low | BranchID on all financial SQL; scope metadata |
| Partners `/api/admin/reports/partners` | Head/Detail, Cash, ledger, overrides JSON | year/month | page ACL | overrides file | SELECTED / ALL | high→low | Per-branch calc + SQL shares; consolidate after |
| Partners expense details | Cash + cats | year/month/cat | page ACL | none | SELECTED | high→low | BranchID filter |
| Monthly `/api/reports/monthly` | Detail/Head, Cash (treasury) | year/month | session+scope | none | SELECTED / ALL* | high→low | Branch scope + SQL partners for PDF |
| Monthly expenses | Cash | year/month | scope | none | SELECTED | high→low | BranchID |
| Employee services | Head/Detail | date range | page+scope | none | SELECTED | high→low | BranchID |
| Deductions monthly | Cash | month | scope | none | SELECTED | high→low | BranchID |
| Treasury daily/period | Cash | date + BranchID (1D) | active branch | none | ACTIVE_BRANCH | low | Already isolated |
| Partners overrides JSON | filesystem | year/month | page ACL | file | DEFERRED (GLEEM-only apply) | med | Apply only when branch=GLEEM |
| Payroll monthly SP | SP | from/to | none | none | DEFERRED | high | Documented; not rewritten |
| Employee monthly work/payroll | attendance/payroll | emp+month | page ACL | none | DEFERRED / GLOBAL_NON_FINANCIAL mix | med | HR tables lack BranchID — deferred |
| Owner WhatsApp full-day | full-day service | date | admin | none | inherits full-day | low after 1E | Uses scoped full-day |

\* ALL_BRANCHES requires page ACL + `CanViewReports` on every active branch. `UserLevel=admin` alone is insufficient.

## Classification summary

* **ACTIVE_BRANCH:** treasury operational summaries  
* **SELECTED_BRANCH:** full-day, partners, monthly, expenses, employee-services, deductions  
* **ALL_BRANCHES:** full-day + partners when `scope=all` and permitted  
* **DEFERRED:** payroll SP, HR monthly without financial BranchID, expenses-review stub  

## Hardcoded partners (pre-1E)

`PARTNERS` in `monthly-report.ts`: زياد 36.666…%, محمد حمدي 31.666…%, علي الزيني 31.666…%. Replaced by `TblBranchPartnerShare` EffectiveFrom=2026-06-01.
