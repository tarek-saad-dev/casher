# Phase 1L — Reconciliation

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Services:** `employeeLedgerReconciliationService.ts`, admin HR reconciliation routes  
**UI:** Employee ledger reconciliation panel

---

## 1. Required comparison (per branch)

```
Branch payroll entitlement
vs
Branch ledger wage credits
vs
Branch cash payouts / advances
vs
Branch employee balance
```

Also show **consolidated employee total** = SUM of authorized branch accounts (read-only).

---

## 2. Detection matrix

| Check | Severity |
|---|---|
| Payroll row without matching non-void `hourly_wage` ledger | Error |
| Target row without matching `target` ledger credit | Error |
| Ledger entry missing BranchID | **Impossible post-migration** (NOT NULL) — treat as hard fail if any slip |
| Ledger / CashMove BranchID mismatch | **Hard fail** |
| Duplicate payroll posting for Emp+Branch+WorkDate | Error |
| Advance CashMove without ledger debit | Error |
| Payout ledger debit without CashMove | Error |
| Cross-branch payout attempt | Fail closed |
| Global total ≠ SUM(branch balances) | Error (view / query bug) |
| PH1GTEST financial ownership | Hard fail |

---

## 3. Scope rules

| Rule | Detail |
|---|---|
| Branch filter | Session / report scope BranchID |
| Global column | Read-only SUM; never a mutation source |
| Advances | Balance-sheet / employee-account; keep existing operating-profit exclusion policy |
| Wrong-branch ID | Non-disclosing 404 |

---

## 4. Implementation status

| Piece | Status |
|---|---|
| Pre-existing reconciliation SQL / admin routes | Present (Emp / month oriented) |
| Per-branch comparison columns | **Pending** — extend queries to GROUP/FILTER by BranchID |
| CashMove mismatch detector | Enforced at migration; keep in ongoing recon |
| Cross-branch payout detector | Contract locked; payout service uses branch balance |

---

## 5. Fingerprint anchors for recon

Use pre-migration JSON as continuity baseline:

* Payroll wageSum **147999.66** (606 rows)  
* Ledger balance **21034.33** (credits **80985.33**, debits **59951**)  
* Target sum **30833.6** (97 rows)  
* Cash-linked ledger **281**

After cutover, GLEEM branch totals must match these aggregates while PH1GTEST remains zero.
