# Phase 1L — Employee Ledger Contract

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Table:** `TblEmpLedgerEntry.BranchID NOT NULL`  
**Services:** `employeeLedgerDualWrite.ts`, `employeeLedgerPayoutService.ts`, `employeeLedgerService.ts`, funding/monthly/sync/reconciliation modules

---

## 1. Ownership

```
TblEmpLedgerEntry = BRANCH_OWNED account entry
Account key       = EmpID + BranchID
Global balance    = read-only SUM (vw_EmpLedgerGlobalBalance)
```

BranchID is mandatory, FK’d, and **immutable** after insert.

---

## 2. EntryReason → Branch source (frozen)

| EntryReason | Branch source |
|---|---|
| `hourly_wage` | Attendance / payroll branch |
| `monthly_salary` | Branch payroll plan |
| `target` | Target result branch |
| `commission` | Invoice / revenue branch (if activated) |
| `bonus` | Active session granting branch |
| `advance` | `CashMove.BranchID` |
| `payout` | `CashMove.BranchID` |
| `employee_funding` | Income / CashMove branch |
| correction / reversal | Original ledger entry branch |

**Never infer branch from:** employee default, first active branch, hard-coded GLEEM, browser body BranchID, or “current session” when reversing another branch’s entry.

---

## 3. Advances

```
Active branch treasury → branch CashMove → branch ledger debit
```

* `Ledger.BranchID = CashMove.BranchID` (invariant).  
* Reduces **only** that branch account.  
* Routes: `src/app/api/expenses/**` + `maybeSyncAdvanceLedgerForExpenseCashMove`.  
* Dual-write resolves BranchID from CashMove row (implemented).

---

## 4. Payouts

```
Max payout = positive available balance for EmpID + session BranchID
```

* **Do not** use global balance as limit.  
* Cross-branch payout **fail closed** — no settlement workflow.  
* Implemented: `executeEmployeePayout` + `getEmployeeBranchBalance`.  
* CashMove and ledger debit share session `branchId`.

---

## 5. Hourly wage dual-write

* `runDailyPayrollGenerateWithOptionalLedger(workDate, { branchId })` required.  
* `syncHourlyWageLedgerForWorkDate` filters payroll by BranchID and inserts credits with that BranchID.  
* RefType remains `TblEmpDailyPayroll` / RefID = payroll ID.

---

## 6. Funding / tips / monthly

| Flow | Contract | Status |
|---|---|---|
| Employee funding | Session CashMove branch | Cash path stamps BranchID; ledger must match |
| Tip | Paying / income branch | Historical tip credits backfilled |
| Monthly salary | Plan branch | **Gap** — INSERT still omits BranchID |

---

## 7. Balance APIs

| Function | Role |
|---|---|
| `getEmployeeBranchBalance` | Writable-account balance; payout gate |
| `getEmployeeAllTimeBalance` | Read-only via `vw_EmpLedgerGlobalBalance` |
| Outstanding totals | Prefer branch-scoped or explicit consolidated SUM |

---

## 8. Security / IDOR

* Load BranchID from persisted row for mutations.  
* Session / report scope filters visibility.  
* Body BranchID rejected.  
* Wrong branch → non-disclosing 404.  
* Admin role alone is not a branch bypass.

---

## 9. Pre-migration fingerprint (preserved totals)

| Metric | Value |
|---|---:|
| Rows | **517** |
| Credits | **80985.33** |
| Debits | **59951** |
| Balance | **21034.33** |
| Cash-linked | **281** |

Post-migration: branch balances SUM must equal prior global balance; CashMove mismatch count **0**.
