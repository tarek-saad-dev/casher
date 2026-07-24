# Phase 1L — Employee Financial Dependency Audit

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Pre-capture:** `scripts/audit-branches/_phase1l-employee-financial-before.json`  
**Migration:** `db/migrations/add-employee-financial-branch-ownership.sql` (applied)  
**GLEEM:** `BranchID = 1` (active) · **PH1GTEST:** `BranchID = 2` (inactive)  
**Sync:** stopped and unused

---

## 1. Pre-migration live facts

| Object | Exists | Rows / note | BranchID (pre) |
|---|---|---|---|
| `TblEmpDailyPayroll` | Yes | **606** rows · **17** emps · wageSum **147999.66** · hoursSum **5808.94** | **No** |
| Payroll unique | `UX_TblEmpDailyPayroll_EmpID_WorkDate` | `(EmpID, WorkDate)` | Global |
| Payroll status | Generated **152** / PostedToCashMove **454** | — | — |
| `TblEmpLedgerEntry` | Yes | **517** rows · **14** emps · credits **80985.33** · debits **59951** · balance **21034.33** | **No** |
| Cash-linked ledger | — | **281** | — |
| `TblEmpDailyTarget` | Yes | **97** · targetSum **30833.6** · salesSum **166201** | **No** |
| Target unique | `UQ_TblEmpDailyTarget_Emp_WorkDate` | `(EmpID, WorkDate)` | Global |
| `TblEmpTargetRecalcRequest` | Yes | **49** | **No** |
| `TblEmpTargetPlan` | Yes | **5** | **No** |
| `TblEmpSalaryHistory` | Yes | **36** (active open **19**) | **No** (employee-global) |
| `TblEmpBranchPayrollPlan` | **No** (pre) | — | Created in 1L |
| `TblPayrollMonth` | Yes | Month open/close header | No BranchID (unchanged) |
| PH1GTEST employee-financial rows | — | **0** | — |

**Ledger by reason (pre, non-void):** advance debit **260** · hourly_wage credit **152** · target credit **82** · employee_funding credit **14** · payout debit **3** · tip credit **2** · monthly_salary credit **2**.

**WorkDate range (payroll):** 2026-05-01 → 2026-07-22.

---

## 2. Ownership model (locked)

```
GLOBAL_MASTER:           TblEmp (one identity; never duplicated per branch)
BRANCH_ELIGIBILITY:      TblEmpBranchAssignment
BRANCH_OWNED session:    TblEmpAttendance (Phase 1K)
BRANCH_OWNED wage:       TblEmpDailyPayroll (EmpID + BranchID + WorkDate)
BRANCH_OWNED ledger:     TblEmpLedgerEntry (EmpID + BranchID account)
BRANCH_OWNED target:     TblEmpDailyTarget / TblEmpTargetPlan / recalc
BRANCH_PLAN:             TblEmpBranchPayrollPlan (Emp + Branch + EffectiveFrom)
READ_ONLY global:        vw_EmpLedgerGlobalBalance = SUM(branch accounts)
EMPLOYEE_GLOBAL:         schedules / day-off (unchanged)
```

Writable source of truth = **branch account**. Global total = **calculated sum only** — no writable global ledger account.

---

## 3. Application write/read paths (pre → post)

### Payroll (`src/app/api/payroll/**`, `src/lib/payroll/**`)

| Path | Pre-1L | Post-1L contract / status |
|---|---|---|
| `POST /api/payroll/daily/generate` | Emp+WorkDate generate via `vw_EmpAttendancePayrollDay` | Core requires `branchId`; **route still omits session branch** (gap) |
| `POST /api/payroll/daily/auto-generate` | System job, global once | Same — must iterate active branches |
| `POST /api/payroll/daily/validate-attendance` | Global aggregate | Should validate per branch when generating |
| `POST /api/payroll/daily/post-to-cash` | Session CashMove BranchID | Session treasury; payroll rows must match session branch |
| `GET /api/payroll/daily` | Emp/date list | Must filter / display BranchID |
| Targets generate / recalc / ledger-sync | Emp+WorkDate | Branch-owned keys; **target libs still Emp+WorkDate** (gap) |
| Salary settings | `TblEmp` / `TblEmpSalaryHistory` | Seed into `TblEmpBranchPayrollPlan`; ops should stop relying on global fields |
| `dailyPayrollGenerateCore.ts` | Emp/day aggregate | **Updated** — `executeDailyPayrollGenerate` uses `vw_EmpAttendancePayrollBranchDay` + required `branchId` |
| `attendancePayrollAggregate.ts` | Emp/day view | **Updated** — branch-day loader added; Emp/day retained for consolidated reads |

### Employee ledger (`src/lib/services/employeeLedger*`, `src/app/api/admin/hr/employee-ledger/**`)

| Path | Pre-1L | Post-1L contract / status |
|---|---|---|
| Dual-write hourly wage | Credit from payroll Emp+date | **Updated** — stamps payroll `BranchID`; sync scoped by branch |
| Advance (`expenses` + dual-write) | Debit from CashMove | **Updated** — BranchID from CashMove |
| Payout | Global balance limit | **Updated** — `getEmployeeBranchBalance`; session `branchId` required |
| Funding | Session CashMove | Session branch stamped on cash; ledger must match |
| Monthly salary post | Global `TblEmp` BaseSalary | **Still global INSERT without BranchID** (gap vs NOT NULL schema) |
| Ledger GET / summary / reconciliation | Emp-global | Must expose branch + global SUM views |
| Void / cleanup | Emp ID | Must preserve original BranchID |

### HR / nightly / reports

| Path | Pre-1L | Post-1L contract / status |
|---|---|---|
| `nightly-close.service.ts` | Finalize per branch → payroll/targets **once** | Spec: payroll/targets **per active branch**; **nightly still calls generate without branchId** (gap) |
| Employee WhatsApp | One message Emp+date | One message with **branch breakdown** + overall total |
| Owner WhatsApp / full-day | Per branch where already branch-owned | Include only that branch’s employee costs |
| `employee-monthly-payroll` report | Emp+date payroll/ledger | Must sum branch rows; never invent a writable global account |
| Partner / treasury reports | Already branch-scoped cash/sales | Filter employee costs by BranchID |

### Explicitly out of path

* No active commission table on `last132` (`TblEmpCommission` absent).  
* Tip ledger credits exist historically (2 rows) — treat as branch-owned when CashMove/session known.  
* Sync service remains stopped — no sync writers.

---

## 4. Failure scenarios addressed

| # | Failure | Phase 1L treatment |
|---|---|---|
| 1 | Wage for branch B booked against GLEEM P&L | **Fixed (schema + generate core)** — BranchID on payroll |
| 2 | One Emp+WorkDate payroll combining multi-branch hours | **Fixed (core)** — `vw_EmpAttendancePayrollBranchDay` |
| 3 | Payout from global balance spanning branches | **Fixed (payout service)** — branch balance only |
| 4 | Cross-branch payout | **Fail-closed** — out of scope; no settlement workflow |
| 5 | Ledger/CashMove BranchID mismatch | **Abort** in migration; invariant going forward |
| 6 | Browser BranchID trusted | **Fail-closed** — session wins on cash/payroll/payout routes |
| 7 | Future branch falls back to GLEEM plan | **Forbidden** — missing plan fails closed |
| 8 | Writable global employee account | **Forbidden** — global = view SUM only |
| 9 | PH1GTEST owns financial rows | **Abort** if any after backfill |
| 10 | Ambiguous historical CashMove ownership | **Abort** — do not fabricate |

---

## 5. Explicit non-goals (frozen)

* Activate PH1GTEST or production branch #2  
* Duplicate `TblEmp` per branch  
* Inter-branch employee settlement  
* GLEEM payroll-plan fallback for other branches  
* Restart sync  
* Change attendance or inventory ownership (1K / 1J preserved)  
* Change partner-share formulas  
* Invisible automatic monthly-salary split by hours  

---

## 6. Registry

`domainOwnershipRegistry.ts` domain `payroll_ledger_targets`:

| Field | Locked post-1L intent |
|---|---|
| Classification | BRANCH_OWNED_ROOT (branch account) + read-only global SUM |
| `goLiveBlocker` | Should clear to **false** when app integration complete |
| Current code | Still `goLiveBlocker: true` / deferred notes — **registry update pending** |

---

## 7. Classification summary

```
GLOBAL_MASTER:        TblEmp
BRANCH_ELIGIBILITY:   TblEmpBranchAssignment
BRANCH_OWNED:         Attendance, DailyPayroll, LedgerEntry, DailyTarget,
                      TargetPlan, TargetRecalcRequest, BranchPayrollPlan
READ_ONLY SUM:        vw_EmpLedgerGlobalBalance
COMPAT / GLOBAL:      schedules, day-off, TblPayrollMonth header
DEPRECATED ops path:  generating payroll from Emp-only global fields without branch plan
```
