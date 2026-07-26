# Phase 1Q — Current Employee Schedule Audit

**Date:** 2026-07-26  
**Database:** cloud / `last132`  
**Policy:** `ONE_OPERATIONAL_BRANCH_PER_EMPLOYEE_PER_WORKDATE`

---

## Matrix

| Path | scope | key | BranchID? | effective? | global/branch | public | attendance | payroll | migration |
|---|---|---|---|---|---|---|---|---|---|
| `TblEmpWorkSchedule` | legacy weekly | EmpID+DayOfWeek unique | **No** | No | **global** | via legacy window | fallback GLEEM only | indirect | read-only; backfill source |
| `TblEmpDayOff` | leave | EmpID+OffDate | **No** | date | **global** | blocks all branches | blocks check-in | — | unchanged |
| `TblEmpScheduleOverrides` | day overrides | EmpID+OverrideDate | **No** | date | **global** (`day_off` all branches) | blocks | blocks | — | unchanged |
| `TblEmpBranchWorkSchedule` | **SoT** weekly | EmpID+BranchID+DayOfWeek+EffectiveFrom | **Yes** | EffectiveFrom/To | **branch** | if CanReceiveBookings + public gate | schedule gate | requires assignment+plan on save | GLEEM backfill only |
| `TblEmpTemporaryBranchTransfer` | date transfer | EmpID+WorkDate (active) | From/To BranchID | WorkDate | **branch** (one day) | to-branch only | away/from gates | plan required on to-branch | new in 1Q |
| `TblEmpBranchAssignment` | eligibility | EmpID+BranchID+dates | **Yes** | EffectiveFrom/To | **branch** | bookable filter | required | required for working schedule | pre-1Q |
| `resolveEmployeeBranchSchedule` | resolver | EmpID+BranchID+WorkDate | yes (arg) | yes | branch (+ GLEEM legacy fallback) | used by booking | used by check-in | — | app |
| `resolveEmployeeGlobalSchedule` | union | EmpID+WorkDate | multi | yes | global read of branch rows | `publicOnly` filter | conflict detect | — | app |
| `GET /api/public/booking/barbers` | list | mode=global\|branch | optional branchCode | date | global unique / branch list | PUBLIC_LIVE gate | — | — | 1Q |
| `…/barbers/{id}/calendar` | calendar | EmpID+from/to | optional branchCode | range | global union | publicOnly | — | — | 1Q |
| `…/barbers/{id}/location` | location | EmpID+date | resolved | date | one operational branch | publicOnly | — | — | 1Q |
| `…/barbers/{id}/available-slots` | slots | EmpID+branch+date | required | date | **branch** | rejects wrong branch | — | — | 1Q |
| `POST …/booking/create` | create | branchCode+EmpID | stamped | WorkDate | **branch** | `BARBER_AVAILABLE_AT_DIFFERENT_BRANCH` | — | — | 1Q |
| check-in (`branchAttendance`) | attendance | EmpID+BranchID+WorkDate | session | WorkDate | **branch** | — | schedule + open-other guards | wage at attendance branch | 1K+1Q |
| Admin `/admin/hr/employees/{empId}/branch-schedule` | UI/API | EmpID | per cell | EffectiveFrom | **branch** write | — | — | plan assert | 1Q |
| Backfill `backfillGleemBranchSchedulesFromLegacy` | migration | legacy→branch | GLEEM only | EffectiveFrom default 2020-01-01 | GLEEM | — | — | — | CC/PH1GTEST real=0 |

---

## Fingerprint intent

| Branch | Real schedules (`TblEmpBranchWorkSchedule`) |
|---|---|
| GLEEM | Backfilled from legacy |
| CAMP_CAESAR | **0** real |
| PH1GTEST | **0** real (smoke-only if any) |

---

## Old vs new

| | Old | New SoT |
|---|---|---|
| Table | `TblEmpWorkSchedule` | `TblEmpBranchWorkSchedule` |
| Key | EmpID+DayOfWeek | EmpID+BranchID+DayOfWeek+EffectiveFrom |
| BranchID | none | required |
| DayOff / overrides | global | still global (block every branch) |
| Fallback | N/A | legacy read-only for **GLEEM** only |
