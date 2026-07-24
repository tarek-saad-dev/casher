# Phase 1K — Verification

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Scope:** Attendance BranchID migration + branch attendance service + payroll aggregate + nightly topology

---

## 1. Live database verification

**Pre-capture:** `scripts/audit-branches/_phase1k-attendance-before.json` (2026-07-24T04:05:46Z)

| Check | Result |
|---|---|
| Expected database | `last132` |
| GLEEM | `BranchID=1`, **IsActive=true** |
| PH1GTEST | `BranchID=2`, **IsActive=false** |
| `TblEmpAttendance` rows | **~893** |
| Employees with attendance | **21** |
| `hasBranchId` (pre) | **false** → **true post** |
| Pre unique | `UQ_TblEmpAttendance_Emp_WorkDate` |
| Emp+WorkDate duplicates | **0** |
| Open null-checkout rows | **285** (pre; explains no filtered unique) |
| Daily payroll rows | **606** (unchanged schema) |
| Second branch activated | **No** |
| Sync service | **Stopped** (unchanged) |

**Post-migration expected:**

| Check | Result |
|---|---|
| All attendance `BranchID` | GLEEM |
| PH1GTEST attendance rows | **0** |
| Unique | `UQ_TblEmpAttendance_Branch_Emp_WorkDate` |
| View | `vw_EmpAttendancePayrollDay` |
| Payroll/ledger BranchID | **Still absent** |

Do **not** invent additional live smoke metrics beyond this fingerprint.

---

## 2. Schema contract checks

Migration file must contain:

| Artifact | Present |
|---|---|
| `BranchID` add → backfill GLEEM → NOT NULL + FK | ✓ |
| Drop Emp+WorkDate unique | ✓ |
| `UQ_TblEmpAttendance_Branch_Emp_WorkDate` | ✓ |
| `vw_EmpAttendancePayrollDay` | ✓ |
| PH1GTEST attendance guard | ✓ |
| No `BusinessDayID` column | ✓ |

---

## 3. Application contract checks

**Core service:** `src/lib/hr/attendance/branchAttendance.service.ts`

| Requirement | Verified by |
|---|---|
| Applock `attendance-session:{EmpID}` | source |
| Open conflict employee-global | source |
| Assignment eligibility | source |
| Session BranchID on insert/update | source + routes |
| Body BranchID rejected | employee/admin attendance routes |
| Payroll uses aggregate view | `attendancePayrollAggregate.ts` + `dailyPayrollGenerateCore.ts` |
| Nightly finalize per active branch | `nightly-close.service.ts` |
| Registry `attendance.goLiveBlocker` | **false** |

---

## 4. Scripts

```bash
node scripts/audit-branches/17-phase1k-attendance-before.cjs
node scripts/audit-branches/run-phase1k-migration.cjs
```

Optional open-session probe: `scripts/audit-branches/17b-open-attendance.cjs`.

---

## 5. What Phase 1K did **not** verify

| Item | Reason |
|---|---|
| Live PH1GTEST / branch #2 check-in smoke | Branch remains inactive |
| Multi-branch same-day sequential live path | No second active branch |
| Payroll P&L by attendance branch | Phase 1L |
| Sync restart | Forbidden |
| Filtered unique on open sessions | Explicitly excluded |

---

## 6. Verification artifacts

| Artifact | Path |
|---|---|
| Pre-migration JSON | `scripts/audit-branches/_phase1k-attendance-before.json` |
| Pre-capture script | `scripts/audit-branches/17-phase1k-attendance-before.cjs` |
| Migration SQL | `db/migrations/add-attendance-branch-ownership.sql` |
| Migration runner | `scripts/audit-branches/run-phase1k-migration.cjs` |
| Attendance service | `src/lib/hr/attendance/branchAttendance.service.ts` |
| Payroll aggregate | `src/lib/payroll/attendancePayrollAggregate.ts` |
| Finalize | `src/lib/hr/finalize-incomplete-attendance.ts` |
| Nightly close | `src/lib/hr/nightly-close.service.ts` |

---

## 7. Acceptance criteria

- [x] Live DB facts captured on `last132`  
- [x] Migration applied; GLEEM backfill + unique reshape  
- [x] No PH1GTEST attendance ownership  
- [x] Open exclusivity via applock/service (not filtered unique)  
- [x] Payroll compatibility via day aggregate view  
- [x] Nightly: finalize per branch → payroll once  
- [x] Registry attendance blocker cleared  
- [x] No claim of second branch activation  
- [x] Phase 1L still owns payroll attribution
