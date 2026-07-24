# Phase 1I — Shared vs Owned Contract

**Date:** 2026-07-24  
**Status:** Frozen for Phase 1I closure (code corrections only; no schema migration)  
**Database:** cloud / `last132`

This document approves or rejects the expected multi-branch ownership model. Vocabulary: see Phase 1I brief classification list.

---

## 1. Approved global masters

These remain **one identity across all branches**. Global does not mean unfiltered reads — operational history must still respect branch scope and permissions.

| Entity | Decision | Rationale |
|---|---|---|
| `TblClient` | **APPROVE** `GLOBAL_MASTER` | Single customer identity; phone matching global; branch appears on transactions not on client row |
| `TblEmp` | **APPROVE** `GLOBAL_MASTER` | Single HR identity; eligibility via `TblEmpBranchAssignment` |
| `TblUser` | **APPROVE** `GLOBAL_MASTER` | Login identity; branch access via `TblUserBranchAccess` |
| Roles / system page definitions | **APPROVE** `GLOBAL_MASTER` | Permission catalog shared |
| `TblPro` / `TblCat` (catalog identity, base price) | **APPROVE** `GLOBAL_MASTER` | One service/product catalog until business requests overrides |
| `TblBarCode` | **APPROVE** `GLOBAL_MASTER` | Barcode maps to global `ProID` |
| Payment methods (`TblPaymentMethods`) | **APPROVE** `GLOBAL_MASTER` | Definitions shared; balances live in branch treasury |
| Income/expense categories | **APPROVE** `GLOBAL_MASTER` | Category defs shared; cash impact branch-owned |
| Global `BookingCode` uniqueness | **APPROVE** `GLOBAL_UNIQUE` | Customer-facing code; public cancel/lookup stays global |
| Global customer phone matching | **APPROVE** | Prevents duplicate clients per branch |

**Reject:** Duplicating client, employee, user, or product **identities** per branch merely to isolate quantities or attendance.

---

## 2. Approved branch-owned operational roots

Isolation is proven (prior phases + Phase 1I P0 route fixes) for GLEEM-only production.

| Entity | Decision | Enforcement |
|---|---|---|
| `TblNewDay` | **APPROVE** `BRANCH_OWNED_ROOT` | Independent open day per branch; session + `BranchID` on writes |
| `TblShiftMove` | **APPROVE** `BRANCH_OWNED_ROOT` | Instance stamped from session branch + day |
| `TblinvServHead` (+ payments, details as children) | **APPROVE** | Immutable from session day/shift; wrong-branch → non-disclosing 404 |
| `TblCashMove` | **APPROVE** | Treasury hub per branch |
| `TblTreasuryCloseRecon` | **APPROVE** | Per-branch close |
| `Bookings`, `QueueTickets`, `QueueBookingSettings` | **APPROVE** | Phase 1F `BranchID NOT NULL`; no client-supplied branch |
| Operational financial reports | **APPROVE** | Phase 1E scope: calculate per branch, consolidate after |
| `TblBranchPartnerShare` | **APPROVE** | Per-branch partner periods |
| `TblEmpBranchAssignment`, `TblUserBranchAccess` | **APPROVE** hybrid activity rows | Eligibility and login default — not identity duplication |

**Reject:** Any operational fallback that reads GLEEM's open day, shift, settings, or sales when the active session branch differs.

---

## 3. Approved child inherit (no child BranchID)

| Parent | Children | Decision |
|---|---|---|
| `TblinvServHead` | `TblinvServDetail`, `TblinvServPayment` | **APPROVE** `CHILD_INHERIT` |
| `Bookings` | `BookingServices` | **APPROVE** |
| `QueueTickets` | `QueueTicketHistory`, `QueueTicketServices` | **APPROVE** |
| `TblinvPurchaseHead` (future) | `TblinvPurchaseDetail` | **APPROVE** when purchases become branch-owned |

Direct child ID access must validate parent branch ownership before mutate/read.

---

## 4. Approved employee-global conflict

| Feature | Decision |
|---|---|
| Booking / queue overlap for same `EmpID` | **APPROVE** `EMPLOYEE_GLOBAL_CONFLICT` |
| Schedule applock `operations-schedule:{EmpID}:{date}` | **APPROVE** |
| Branch eligibility before assigning emp to booking/queue | **REQUIRED** via `TblEmpBranchAssignment` |

**Reject:** Changing overlap rules in Phase 1I.

---

## 5. Hybrid candidates — explicit sub-field decisions

### 5.1 Employee attendance

| Sub-field | Decision |
|---|---|
| Global identity | `TblEmp` — **APPROVE** global |
| Branch activity | Check-in event — **REJECT** current global row; **REQUIRE** branch-owned event before branch #2 staff check-in |
| Branch config | Schedule/day-off — deferred hybrid (emp-global today) |
| Global balance | N/A |
| Branch attribution for reports | **REQUIRED** once multi-branch |
| Cross-branch rules | One row per emp+date is **ambiguous** if emp works two branches same day — **fail closed** until decided |

**Verdict:** **DEFERRED_REQUIRES_BUSINESS_DECISION** — **go-live blocker** for branch #2 check-in.

### 5.2 Payroll entitlements / daily payroll

| Sub-field | Decision |
|---|---|
| Global identity | Employee payroll account — **APPROVE** global per emp |
| Branch activity | Wage earned on a date — **REQUIRE** source branch attribution (decision pending) |
| Branch config | Comp rules — global on emp today |
| Global balance | Net pay entitlement can remain emp-global |
| Branch attribution for reports | **REQUIRED** for branch P&L |
| Cross-branch rules | Advance paid at branch A for emp working A+B — **decision required** |

**Verdict:** **DEFERRED** — blocker for full HR ops on branch #2; not a blocker for POS-only pilot if HR stays GLEEM-centralized.

### 5.3 Employee ledger

| Sub-field | Decision |
|---|---|
| Global identity | **APPROVE** one liability balance per emp (default) |
| Branch activity | Ledger entry — optional/required `SourceBranchID` — **decision required** |
| Branch config | N/A |
| Global balance | **APPROVE** default global balance |
| Branch attribution for reports | **REQUIRED** for entries linked to branch treasury (`CashMove.BranchID`) |
| Cross-branch rules | Payout from branch B treasury reduces global emp balance — **APPROVE** if cash move is branch-owned |

**Verdict:** **DEFERRED** — not immediate corruption on GLEEM-only; blocker for accurate multi-branch HR accounting.

### 5.4 Daily / monthly targets

| Sub-field | Decision |
|---|---|
| Global identity | Target plan per emp — hybrid |
| Branch activity | Daily target actuals — revenue must filter by invoice `BranchID` (already in 1E sales reads) |
| Branch config | Branch-specific target plans — **optional future** |
| Global balance | N/A |
| Branch attribution for reports | **REQUIRED** when emp sells in multiple branches |
| Cross-branch rules | Aggregate vs branch-specific targets — **case 7 vs 8 in HR doc** |

**Verdict:** **DEFERRED** — generation jobs still emp-global.

### 5.5 Product stock (`TblPro.Qty`)

| Sub-field | Decision |
|---|---|
| Global identity | **APPROVE** `TblPro` catalog |
| Branch activity | Quantity on hand — **REJECT** global `TblPro.Qty` for multi-branch |
| Branch config | N/A |
| Global balance | N/A |
| Branch attribution for reports | Per-branch stock reports **REQUIRED** |
| Cross-branch rules | Inter-branch transfer must be explicit operation — **not** simple adjustment |

**Verdict:** **HYBRID target** — **go-live blocker** for physical product sales on branch #2. Preferred future model: global `TblPro` + branch inventory balance/movement root.

### 5.6 Purchases

| Sub-field | Decision |
|---|---|
| Global identity | Product lines reference global `ProID` |
| Branch activity | Purchase header — **REQUIRE** `BranchID` (not present live) |
| Branch config | N/A |
| Global balance | N/A |
| Branch attribution | **REQUIRED** |
| Cross-branch rules | Return restores stock to same branch as purchase |

**Verdict:** **DEFERRED** — **blocker** with stock.

### 5.7 Loyalty

| Sub-field | Decision |
|---|---|
| Global identity | **APPROVE** `TblClient` + `TblClientLoyalty` |
| Branch activity | Earn/redeem events — **PREFER** source branch on ledger |
| Branch config | Tier rules global |
| Global balance | **APPROVE** global points balance (default) |
| Branch attribution for reports | Preferred for loyalty cost by branch |
| Cross-branch rules | Earn A, redeem B — **APPROVE** if atomic global balance |

**Verdict:** **APPROVE** hybrid with global balance; source branch **preferred**, not hard blocker if earn/redeem remain atomic.

### 5.8 Offers

| Sub-field | Decision |
|---|---|
| All | **REJECT** activation without scope — `TblOffers` **absent** on `last132` |

Future classification must be one of: `GLOBAL_ALL_BRANCHES`, `SELECTED_BRANCHES`, `BRANCH_ONLY`.

### 5.9 Service availability / duration / price overrides

| Sub-field | Decision |
|---|---|
| Global identity | **APPROVE** catalog + base price |
| Branch config | Overrides — **NOT IMPLEMENTED**; future-safe contract only (`BranchServicePriceOverride`, etc.) |
| Cross-branch | **REJECT** silent reuse of another branch's settings |

**Verdict:** Global price intentional until business need proven.

### 5.10 Printers / print settings

| Sub-field | Decision |
|---|---|
| Global identity | Template text may be global |
| Branch activity | Receipt business data — **APPROVE** active-branch owned |
| Device config | **APPROVE** `DEVICE_OR_DEPLOYMENT_LOCAL` |

**Verdict:** Database printer rows are machine-local; not a schema blocker but an deployment binding risk.

### 5.11 Settings (`TblSettingValues`, `QueueBookingSettings`)

| Sub-field | Decision |
|---|---|
| QueueBookingSettings | **APPROVE** branch-owned (Phase 1F) |
| Split clearing / payment config | **APPROVE** global `TblSettingValues` keys |
| Missing branch settings | **REJECT** GLEEM fallback — fail closed or explicit default |

---

## 6. Consolidated read

| Report class | Decision |
|---|---|
| Full-day, partners, monthly (financial) | **APPROVE** `CONSOLIDATED_READ` with per-branch calc first |
| Owner WhatsApp full-day | **APPROVE** iterate active branches (Phase 1I) |
| HR monthly without branch attribution | **REJECT** as branch-accurate until HR decision |

---

## 7. Inactive legacy

| System | Decision |
|---|---|
| Calendar sync tables | **APPROVE** `INACTIVE_LEGACY` — sync stopped; must not write branch-less bookings |
| Sync service / CT replication | **REJECT** restart in Phase 1I |

---

## 8. Contract summary table

| Category | Count | Go-live note |
|---|---|---|
| Shared global masters | 10+ entities | Safe for GLEEM-only |
| Branch-owned ops | 10+ roots | Proven post-1I P0 fixes |
| Child inherit | 6+ child tables | Join parent |
| Hybrid approved with conditions | Loyalty, access, assignments | Loyalty soft; stock hard |
| Blocked pending decision | Attendance, payroll, ledger, targets, purchases, stock | **NO-GO for branch #2 ops** until cleared |
| Inactive legacy | Calendar sync | Keep stopped |
