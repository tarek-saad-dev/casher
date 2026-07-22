# Branch Architecture Decisions (Frozen)

**Status:** Frozen for Phase 1A  
**Version:** 1.0.0  
**Date:** 2026-07-22  
**Source audit:** `docs/branch-architecture-audit.md`  
**Machine contract:** `docs/branch-ownership-contract.csv`

This document freezes approved multi-branch decisions. Later phases must not contradict it without a new versioned decision-log entry.

---

## 1. Approved decisions

### Employees

* `TblEmp` remains a global employee identity.
* An employee may be assigned to multiple branches.
* An employee may work at multiple branches on the same calendar date.
* Overlapping attendance, bookings, queue work, or service intervals across branches must eventually be prohibited **globally**.

### Employee ledger

* Every future employee ledger entry will have branch attribution.
* The system will expose a **balance per branch**.
* The consolidated employee balance equals the sum of all branch balances.
* A payout normally reduces the payable balance of the **paying branch**.
* Paying another branch's liability later requires an explicit inter-branch settlement mechanism.

### Partners

* Partner percentages may differ by branch.
* Partner percentages must be effective-dated.
* Consolidated partner reports must calculate each branch independently before consolidation.

### Public booking

* One public website serves all branches.
* The customer selects the branch **before** services, employees, dates, or slots.
* Availability must **never** silently default to the founding branch when branch context is absent.

### Services and prices

* `TblPro` and `TblCat` remain global definitions.
* A future branch override may control: availability, price, duration, quick-sale state, display order.

### Inventory

* Do not introduce a classic product inventory module.
* Current core `TblPro` usage is service/catalog-oriented.
* Existing loyalty-store stock will later be aligned to branch ownership.

### Historical data

* Existing operational and financial history is expected to belong to the founding branch:
  * Code: `GLEEM`
  * Name: `جليم – سابا باشا`
* This assumption must be verified against the live database before backfill.

### Queue numbers

* Queue ticket numbers will eventually be unique per: Branch + Operational date + Ticket code.

### Infrastructure

* Production uses one shared cloud database with branch-scoped rows.
* Local↔cloud Change Tracking is infrastructure, not a branch model, and must not be extended to represent branches.
* Redesign or retirement of sync is deferred until after core branch ownership.

### Naming

* Canonical identifier: `BranchID`.
* Existing nullable `SalonID` fields in loyalty-store tables will be aligned in a later migration.
* Do not rename them in Phase 1A / 1B foundation until the dedicated alignment phase.

### Cashier switching

* A cashier cannot maintain simultaneous open shifts in two branches.
* A user may eventually switch without logging out only when:
  * They have valid branch access.
  * Their current operating shift is closed.
  * No protected transaction is in progress.

### All-branches mode

* `ALL_BRANCHES` is **report-only**.
* It is never accepted for: sales, expenses, income, treasury movements, payroll posting, attendance, bookings, queue operations, business-day or shift opening.

---

## 2. Definitions

| Term | Definition |
|------|------------|
| **Global entity** | Shared identity or catalog with no operational BranchID (e.g. `TblClient`, `TblEmp`, `TblPro`). |
| **Branch-scoped aggregate** | Transactional root that owns `BranchID` and defines financial/ops ownership (e.g. `TblinvServHead`, `TblCashMove`, `Bookings`). |
| **Hybrid configuration** | Shared base entity with per-branch assignment, override, or ACL (e.g. user branch access, service price override). |
| **Aggregate root** | The table that owns branch context for a write transaction. |
| **Branch-inherited child** | Child row that must not independently accept client branch input; inherits from its root (e.g. invoice details). |

---

## 3. Future branch ownership rules

1. Session (or system job) supplies validated active `BranchID`.
2. Money and ops writes never trust browser-supplied branch ownership.
3. Aggregate roots stamp `BranchID`; children inherit.
4. Advances/payouts/tips → paying treasury branch.
5. Targets → invoice revenue branch.
6. Hourly wage → attendance branch.
7. `ALL_BRANCHES` only on privileged report reads.

---

## 4. Employee cross-branch conflict rules

* Assignments: many branches allowed.
* Same calendar date at multiple branches: allowed.
* Overlapping **time intervals** for attendance / booking / queue / service: **forbidden globally** across branches.
* Schedule applocks / conflict checks must eventually be emp-global for time overlap, while boards remain branch-filtered.

---

## 5. Employee-ledger balance rules

```text
balance(emp, branch) = sum(entries where EmpID=emp and BranchID=branch and not voided)
balance_consolidated(emp) = sum over branches of balance(emp, branch)
payout(branch B) reduces balance(emp, B) unless explicit inter-branch settlement
```

---

## 6. Partner-share calculation rules

1. Compute net result **per branch** using that branch's effective-dated partner percentages.
2. Consolidate partner totals only after per-branch shares are computed.
3. Never apply one percentage set to a pre-mixed multi-branch total.

---

## 7. Public-booking branch-selection rules

1. Branch selection is a required first step.
2. Missing branch context → hard error (no GLEEM default).
3. Availability, employees, and slots are filtered to the selected branch.
4. Global employee overlap still blocks double-booking the same emp interval.

---

## 8. Historical-data assumptions

* Founding branch code `GLEEM`, name `جليم – سابا باشا`.
* Pre-branch history backfills to GLEEM **after live verification**.
* Unverified multi-site history in one DB is a blocker for automated backfill.

---

## 9. `BranchID` versus `SalonID` policy

* New work uses `BranchID`.
* Loyalty-store `SalonID` remains until a dedicated alignment migration.
* Do not invent a second parallel tenant key.

---

## 10. Explicit deferred decisions

* Physical schema for `TblBranch` / mappings (Phase 1B).
* Session active-branch cookie claim shape (Phase 1B).
* Inter-branch settlement document design.
* Whether invoice sequences are per-branch or globally unique with branch prefix.
* Service override table shape.
* Sync-service retirement timeline.
* UI branch switcher UX.

---

## 11. Versioned decision log

| Version | Date | Change |
|---------|------|--------|
| 1.0.0 | 2026-07-22 | Initial freeze from Phase 0 audit + Phase 1A business decisions |
