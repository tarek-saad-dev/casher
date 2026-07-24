# Phase 1L — Branch Employee Account Contract

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Status:** Ownership contract frozen  
**Views:** `vw_EmpLedgerBranchBalance`, `vw_EmpLedgerGlobalBalance`

---

## 1. Locked model

```
One global employee identity
+
one financial employee account per branch (EmpID + BranchID)
+
one read-only global total (SUM of branch accounts)
```

| Concept | Rule |
|---|---|
| Writable source of truth | Branch account (`TblEmpLedgerEntry` rows with `BranchID`) |
| Global account | **Calculated only** — never receives independent INSERTs |
| Employee identity | Single `TblEmp` row — **never** duplicated per branch |
| BranchID after create | **Immutable** — correct via reverse/recalc, not ownership mutation |

Example:

```
Mohamed @ GLEEM   = 500
Mohamed @ Branch B = 300
Mohamed global     = 800   ← SUM only
```

---

## 2. What a branch account contains

Credits / debits that belong to that branch only:

* Hourly wages earned from that branch’s attendance  
* Monthly salary component configured on that branch’s plan  
* Target entitlements from that branch’s invoice revenue  
* Commissions / bonuses granted in that branch (when active)  
* Advances paid from that branch’s treasury  
* Payouts paid from that branch’s treasury  
* Employee funding from that branch’s income CashMove  
* Corrections / reversals of the above (same BranchID)

---

## 3. Balance views

### `vw_EmpLedgerBranchBalance`

| Column | Meaning |
|---|---|
| `EmpID`, `BranchID` | Account key |
| `TotalCredits` / `TotalDebits` | Non-void sums by direction |
| `Balance` | Credits − Debits |

### `vw_EmpLedgerGlobalBalance`

| Column | Meaning |
|---|---|
| `EmpID` | Employee |
| `TotalCredits` / `TotalDebits` / `Balance` | SUM across branch accounts |
| `BranchAccountCount` | Number of branch rows in branch view |

**No** INSERT / UPDATE / DELETE may target the global view or invent a third “global ledger account.”

---

## 4. Mutation rules

| Operation | Allowed |
|---|---|
| Write ledger row | Must stamp session / source BranchID (CashMove, payroll, target, plan) |
| Body `BranchID` | **Rejected** |
| Payout limit | `getEmployeeBranchBalance(empId, sessionBranchId)` only |
| Use global balance as payout limit | **Forbidden** |
| Cross-branch payout / settlement | **Forbidden** (fail closed) |
| Reversal | Inherits original entry’s BranchID |
| Wrong-branch direct ID access | Non-disclosing **404** |

---

## 5. UI / report posture

* Show global total as read-only SUM (authorization-scoped).  
* Show per-branch cards (credits, debits, balance).  
* Branch operating reports include **only** that branch’s employee costs.  
* Consolidated reports compute each branch, then sum — no double count.

---

## 6. Explicit non-goals

* Writable global employee account  
* Inter-branch settlement  
* Cost-branch ≠ paying-branch split (treasury BranchID = ledger BranchID for advances/payouts)  
* GLEEM fallback when another branch has no account activity  
* Second-branch activation in this phase
