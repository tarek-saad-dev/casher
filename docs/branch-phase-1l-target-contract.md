# Phase 1L — Target Contract (Branch-Owned)

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Tables:** `TblEmpTargetPlan`, `TblEmpDailyTarget`, `TblEmpTargetRecalcRequest`  
**Code:** `src/lib/payroll/employee-target/**`

---

## 1. Locked model

```
Target plan identity   = EmpID + BranchID + EffectiveFrom
Daily target result    = EmpID + BranchID + WorkDate
Recalc request         = EmpID + BranchID + WorkDate
Revenue source         = invoices with same BranchID + employee attribution
```

Same employee may have **two** target results on one calendar date (one per branch).  
**Never** combine branch invoice revenue into one Emp+WorkDate row.

---

## 2. Schema (post-migration)

| Table | BranchID | Unique |
|---|---|---|
| `TblEmpTargetPlan` | NOT NULL + FK | `UX_TblEmpTargetPlan_Emp_Branch_EffectiveFrom` |
| `TblEmpDailyTarget` | NOT NULL + FK | `UQ_TblEmpDailyTarget_Emp_Branch_WorkDate` |
| `TblEmpTargetRecalcRequest` | NOT NULL + FK | `UX_TblEmpTargetRecalcRequest_Emp_Branch_WorkDate` |

Historical rows backfilled to **GLEEM** only. PH1GTEST target rows must remain **0**.

**Pre fingerprint:** targets **97** (targetSum **30833.6**), recalc **49**, plans **5**.

---

## 3. Plan rules

| Rule | Detail |
|---|---|
| Missing branch plan | No target entitlement for that branch |
| Cross-plan fallback | **Forbidden** (no GLEEM plan for Branch B) |
| Thresholds / tiers / conversion | Unchanged semantics; ownership only |
| Ledger credit | Same BranchID as daily target |

---

## 4. Revenue / generation

Official KPI remains `actualInvoiceRevenue` after line + header discount allocation (`employee-target-sales-service.ts`).

Phase 1L requires filtering headers/lines to **`TblinvServHead.BranchID = generation BranchID`**.

Invoice create / update / delete / reassign enqueues recalc for the **invoice’s branch**. Reassign changes employee scope, not invoice BranchID.

---

## 5. Recalc processor

* Each durable request is independently branch-owned.  
* Processor may iterate many requests but must not let branch A mutate branch B’s result.  
* Retry idempotent per Emp+Branch+WorkDate.

---

## 6. Implementation status

| Piece | Status |
|---|---|
| BranchID columns + unique reshape + GLEEM backfill | **Done** |
| Target generate / sales query filter by BranchID | **Gap** |
| Plan resolve Emp+Branch+date | **Gap** (still Emp-global effective plan) |
| Recalc enqueue/process stamp BranchID | **Gap** |
| Target ledger sync INSERT BranchID | **Gap** |
| Nightly per-branch target generation | **Gap** |

---

## 7. Commissions / bonuses

* `TblEmpCommission` absent on live DB — no active commission path.  
* Bonus (if added): session branch only; body BranchID rejected; no silent GLEEM assign.

---

## 8. Explicit non-goals

* Global Emp+WorkDate target combining branches  
* PH1GTEST target ownership  
* Changing calculation version / tier math beyond branch scoping  
* Second-branch activation
