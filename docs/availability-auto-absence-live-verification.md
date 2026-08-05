# Auto-absence — live verification report

**Date:** 2026-08-04  
**Script:** `npx tsx scripts/verify-auto-absence-live.ts`  
**Cleanup helper:** `npx tsx scripts/cleanup-auto-absence-live-test.ts`

## Environment

| Item | Value |
|------|--------|
| Test branch | GLEEM (`branchId=1`) |
| Business date | Cairo business date at run time |
| Controlled employee | Full-time emp (scoped via `empId` filter) |
| Freelancer check | Separate assigned freelance emp (no AUTO_ABSENCE row) |
| Threshold | 30 minutes (`QueueBookingSettings.AutoAbsenceMinutes` / default) |

No customer PII or credentials are logged.

## Scenarios verified

| Scenario | Result |
|----------|--------|
| Full-time +29 min after first planned start | **PASS** — not marked Absent |
| Full-time +30 min (+5s) | **PASS** — marked Absent once |
| Repeated scan | **PASS** — no duplicate attendance absence row; second scan `markedAbsent=0` |
| No duplicate `TblBookingActionRequired` for same source | **PASS** |
| Freelancer not auto-absent from weekly schedule alone | **PASS** |
| Cairo timezone constant `Africa/Cairo` | **PASS** |
| Cleanup — no active AUTO_ABSENCE notes left for test emp | **PASS** |

## Hardening applied during verification

- Scan uses `resolveEmployeeDayPlan` (no invented `10:00` start).
- Freelancers excluded from auto-absence candidates.
- Temporary transfer-in employees included at effective branch.
- First window start for multi-window / overnight business dates.
- Future booking selection uses **Cairo** wall-clock (not `toISOString()` UTC slice).
- Attendance table has **no** `IsDeleted` — queries updated accordingly.
- Global scan uses transaction-scoped `sp_getapplock`; emp-scoped scans skip lock (safe live harness).
- Cron: `vercel.json` → `POST /api/admin/attendance/auto-absence/run` every 15 minutes with `requireSystemJobAuth` (CRON_SECRET Bearer or admin session).

## Cleanup

Live harness deletes test Absent rows / deactivates `AUTO_ABSENCE` day_off overrides and restores the original attendance snapshot for the controlled employee.  
Emergency cleanup of stray `Notes LIKE '%AUTO_ABSENCE%'` Absent rows: `scripts/cleanup-auto-absence-live-test.ts` (removed 7 accidental rows from an earlier unscoped run; re-verified `before=0`).

## Limitations (documented, not blocking)

- Overnight / multi-window / transfer / restore attendance are covered by engine policy + code paths; the automated live harness focuses on threshold, idempotency, freelancer exclusion, and cleanup.
- Restore attendance remains via existing ops `restore-present` / `work-on-day-off` — does **not** auto-clear affected-booking records.

## Command result

```text
AUTO_ABSENCE_LIVE_VERIFICATION_OK
```
