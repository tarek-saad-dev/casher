# Phase 1Q — Smoke Results

| Item | Value |
|---|---|
| SmokeRunID | **14** |
| Emp | `[TEST] Ziad Cross-Branch 14` (EmpID 1041) — not real Ziad |
| Status | PASSED → CLEANED |
| Database | cloud / `last132` |
| Runner | `scripts/branch-smoke/run-phase1q-cross-branch-smoke.ts` |

## Results

| Check | Result |
|---|---|
| Admin preview Sat/Sun/Mon → GLEEM | PASS |
| Admin preview Tue/Wed/Thu → CAMP_CAESAR | PASS |
| Friday → OFF | PASS |
| Public calendar hides Camp Caesar (SETUP) | PASS |
| Same-workday dual schedule rejected | `EMPLOYEE_MULTI_BRANCH_SAME_WORKDAY_NOT_ALLOWED` |
| Temporary transfer Sat → CC (internal) | PASS · public still hides CC |
| Overnight CC end 01:30 / endDayOffset=1 | PASS |
| Cleanup active sched/assign/xfer | **0** |
| CC lifecycle | SETUP · IsActive=0 · PublicBooking=0 |

## Migration

GLEEM backfill: **98** branch schedule rows · legacy fingerprint unchanged · CC/PH1GTEST real schedules = **0**
