# Availability Architecture — Phase 3A Implementation

**Date:** 2026-08-03  
**Status:** Complete  
**Base:** Phase 2 / 2.5 reports + legacy inventory + performance report  
**Companion:** [`availability-daily-adjustment-migration-map.md`](./availability-daily-adjustment-migration-map.md)

This phase introduces the canonical **daily adjustment model**. No workforce UI (Phase 3B).

---

## 1. Executive summary

Phase 3A adds one authoritative store for deliberate daily schedule changes:

| Type | Effect |
|------|--------|
| `CLOSE_DAY` | Clears bookable windows |
| `REPLACE_WINDOWS` | Replaces base/legacy windows |
| `ADD_WINDOW` | Merges additional bookable windows |
| `BLOCK_WINDOW` | Adds blocked intervals (booking/queue deny) |

Weekly schedules remain the base plan. Legacy overrides and attendance still apply first; **canonical daily adjustments apply last**. Attendance `Absent` cannot be reopened. Legacy tables are preserved; admin writes go only to the new tables.

---

## 2. Schema added

| Table | Role |
|-------|------|
| `TblEmpDailyAdjustment` | Header: type, branch, emp, business date, audit, soft cancel |
| `TblEmpDailyAdjustmentWindow` | Child windows with `EndDayOffset` 0\|1 |

- Migration: `db/migrations/create-emp-daily-adjustment.sql` (idempotent)
- Runtime ensure: `ensureDailyAdjustmentTables` (pool/DDL only — **not** inside booking SERIALIZABLE TX)
- Indexes on `(BranchID, EmpID, BusinessDate, IsActive)` and branch/date active
- No uniqueness that blocks multiple `ADD_WINDOW` / `BLOCK_WINDOW`

---

## 3. Files changed

### Added

| File | Role |
|------|------|
| `db/migrations/create-emp-daily-adjustment.sql` | Schema |
| `src/lib/availability/ensureDailyAdjustmentTables.ts` | Idempotent ensure |
| `src/lib/availability/dailyAdjustments.ts` | Contracts + validation |
| `src/lib/availability/applyDailyAdjustments.ts` | Pure application engine |
| `src/lib/availability/loadDailyAdjustmentsBatch.ts` | Batch loader |
| `src/lib/availability/dailyAdjustmentService.ts` | List / create / soft-cancel |
| `src/app/api/admin/availability/daily-adjustments/route.ts` | GET list + POST create |
| `src/app/api/admin/availability/daily-adjustments/[adjustmentId]/route.ts` | DELETE soft-cancel |
| `src/lib/__tests__/availabilityPhase3A.test.ts` | Phase 3A tests |
| `docs/availability-phase-3A-implementation.md` | This report |
| `docs/availability-daily-adjustment-migration-map.md` | Legacy ↔ new map |

### Modified (selected)

| File | Change |
|------|--------|
| `loadEmployeeDayPlanInputsBatch.ts` | `dailyAdjustmentsMap` |
| `resolveEmployeeDayPlan.ts` | Adjustments last; additive plan fields; deny codes |
| `reasonCodes.ts` | Three new codes + slot map |
| `explainAvailability.ts` | Adjustment timeline + state |
| `bookingAvailabilityEngine.ts` | Daily block slot reason + deny precedence |
| `bookingRescheduleCore.ts` / `publicAvailableDaysRange.ts` | Pass block reason tag |
| `contracts.ts` | Export inventory |
| Prior phase tests | `dailyAdjustmentsMap` fixtures |

---

## 4. Adjustment contracts

See `dailyAdjustments.ts`:

- `DailyAdjustmentType` / `DailyAdjustmentSource`
- `EmployeeDailyAdjustment` (+ materialized windows with `startMs`/`endMs`)
- `CreateDailyAdjustmentInput` / `CancelDailyAdjustmentInput` / `ListDailyAdjustmentsInput`
- Validation: windows forbidden for `CLOSE_DAY`; required otherwise; zero-length rejected; `endDayOffset` ∈ {0,1}

---

## 5. Precedence rules

Adjustments sorted by **`CreatedAt ASC`, then `AdjustmentID ASC`, then `Version ASC`**, then applied chronologically:

1. `CLOSE_DAY` → clear working windows  
2. `REPLACE_WINDOWS` → replace working set  
3. `ADD_WINDOW` → merge into working set  
4. `BLOCK_WINDOW` → accumulate blocks (applied against final windows)

Consequences:

- `CLOSE` then `ADD`/`REPLACE` → day can reopen  
- `ADD` then `CLOSE` → day closed  
- Multiple `REPLACE` → last wins  
- `REPLACE` then `ADD` → replace + adds  
- Overlapping/adjacent windows merged; blocks merged  

Documented in `applyDailyAdjustments.ts` header.

---

## 6. Resolver integration order

1. Resolve weekly / transfer / legacy / freelance base  
2. Load legacy overrides + attendance / day-off  
3. Apply legacy `applyOverrides` (**first**)  
4. Apply canonical daily adjustments (**last**)  
5. Normalize windows / blocked intervals  
6. Infer `isWorking` / `denyReasonCode`  
7. Explain metadata via day-plan fields  

`EmployeeDayPlan` additive fields: `dailyAdjustments`, `dailyAdjustmentState` (`NONE` \| `CLOSED` \| `REPLACED` \| `EXTENDED` \| `BLOCKED` \| `MIXED`).

---

## 7. Legacy compatibility behavior

- Dual-read: legacy + new models during transition  
- Preferred: legacy overrides first, canonical adjustments last (new model authoritative)  
- Absent always denies  
- No automatic backfill; see migration map  

---

## 8. API contracts

Base: `/api/admin/availability/daily-adjustments` (auth + session branch only; **never** client `branchId`)

| Method | Path | Behavior |
|--------|------|----------|
| GET | `?date=&empId=` | List active adjustments |
| POST | `/` | Create (`CLOSE_DAY` / `REPLACE_WINDOWS` / `ADD_WINDOW` / `BLOCK_WINDOW`) |
| DELETE | `/{adjustmentId}` | Soft cancel (`IsActive=0`, `CancelledAt`) |

Errors (machine + Arabic): `INVALID_ADJUSTMENT_TYPE`, `WINDOWS_REQUIRED`, `WINDOWS_NOT_ALLOWED`, `INVALID_WINDOW`, `EMPLOYEE_NOT_ASSIGNED`, `ADJUSTMENT_NOT_FOUND`, `ADJUSTMENT_ALREADY_CANCELLED`, etc.

---

## 9. Reason-code changes

| Code | When |
|------|------|
| `DAY_CLOSED_BY_ADJUSTMENT` | Active close leaves no windows |
| `NO_USABLE_WINDOW_AFTER_ADJUSTMENTS` | Full-day block / no residual after adjustments |
| `BLOCKED_BY_DAILY_ADJUSTMENT` | Slot intersects daily block (`daily_adjustment:` tagged reason → slot code `daily_adjustment`) |

Preserved: `EMPLOYEE_OFF_DAY`, `EMPLOYEE_ABSENT`, `SCHEDULE_NOT_CONFIGURED`, `BLOCKED_BY_OVERRIDE`, `OUTSIDE_WORKING_WINDOW`, …

Consumers continue to use final day-plan / `effSched` only (no duplicated adjustment math).

---

## 10. Explain-engine changes

`explainEmployeeDayPlan` now includes `dailyAdjustments`, `dailyAdjustmentState`, and timeline steps:

- `BASE_BRANCH_WEEKLY_SELECTED`
- `LEGACY_OVERRIDE_APPLIED`
- `DAILY_CLOSE_APPLIED` / `DAILY_REPLACE_APPLIED` / `DAILY_WINDOW_ADDED` / `DAILY_BLOCK_APPLIED`
- `ATTENDANCE_ABSENT_DENIED`
- `FINAL_WINDOWS_NORMALIZED`

Still pure/read-only; no public HTTP explain API.

---

## 11. Query / performance impact

- Two batch queries per day-plan load (headers + windows), branch+date parameterized, `EmpID IN (...)`  
- Still O(K) shared schedule queries for the day-plan batch (not O(N·K))  
- Ensure/DDL never on booking TX  
- No change when no adjustments exist (empty map → prior behavior)

---

## 12. Tests and exact results

```text
npx vitest run src/lib/__tests__/availabilityPhase3A.test.ts
→ Test Files  1 passed (1)
→ Tests  34 passed (34)

npx vitest run availabilityPhase01 + Phase2 + Phase25 + Phase3A + benchmarks
→ Test Files  5 passed (5)
→ Tests  87 passed (87)
```

Coverage highlights: schema/contracts, validation, precedence sequences, overnight, compatibility (legacy/absent/freelance/transfer), explain timeline, slot reason mapping, API branch scoping (source contracts).

`npx tsc --noEmit`: Phase 3A production files and `availabilityPhase3A.test.ts` are clean. Remaining project errors are pre-existing in unrelated `__tests__` files (attendance mocks, booking public CORS, etc.).

---

## 13. Known limitations

- No workforce UI  
- No automatic legacy → new backfill  
- Legacy overrides remain writable via existing override APIs  
- Primary window selection still “first” for single-window consumers  
- Payroll 5 AM boundary untouched  

---

## 14. Phase 3B readiness

Ready for workforce UI that:

- Lists / creates / cancels daily adjustments via admin APIs  
- Visualizes effective windows after adjustments  
- Uses explain timeline for operator debugging  

---

## 15. Recommended Phase 3B UI scope

1. Branch-day calendar of employees with weekly base + adjustment badges  
2. Actions: close day, replace hours, add window, block range (overnight-aware)  
3. Soft-cancel / history of adjustments  
4. Read-only explain side panel (reuse `explainEmployeeDayPlan`)  
5. No drag-and-drop required for first UI ship  

---

```text
PHASE 3A COMPLETE

CANONICAL DAILY ADJUSTMENT MODEL IMPLEMENTED

LEGACY SOURCES PRESERVED FOR COMPATIBILITY

READY FOR PHASE 3B WORKFORCE UI
```
