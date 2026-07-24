# Phase 1I Closure — Multi-Branch Boundary Audit and Pre-Go-Live Hardening

**Status:** Complete (audit + P0 code corrections + documentation)  
**Date:** 2026-07-24  
**Database:** cloud / `last132` only  
**Live active branches:** **1** (GLEEM) — unchanged  
**PH1GTEST:** inactive (`BranchID=2`) — unchanged  
**Sync:** stopped and unused  
**Schema migration in Phase 1I:** **none**

See also: `branch-phase-1i-feature-inventory.md`, `branch-phase-1i-database-ownership-matrix.md`, `branch-phase-1i-shared-vs-owned-contract.md`, `branch-phase-1i-inventory-and-assets.md`, `branch-phase-1i-hr-payroll-boundary.md`, `branch-phase-1i-settings-and-jobs.md`, `branch-phase-1i-risk-register.md`, `branch-phase-1i-verification.md`.

---

## 1. Executive verdict

| Decision | Verdict |
|---|---|
| Multi-branch **infrastructure** (session, switcher, financial/booking/queue ownership, P0 day/shift/status leaks, ownership registry) | **CONDITIONAL GO** — proven for GLEEM-only; ready for future second branch **session** targeting once activated |
| **Activating production branch #2** (real operations: staff check-in, retail stock, independent HR automation) | **NO-GO** until documented blockers cleared |
| Reactivating PH1GTEST for production | **NO-GO** |
| Restarting sync service | **NO-GO** |

**Single-line summary:** **CONDITIONAL GO** for infrastructure / **NO-GO** for opening branch #2 for full operations.

---

## 2. What Phase 1I is

An exhaustive boundary audit of the application and live database (`last132`) plus **code-only** corrections for provable P0 cross-branch leaks that did not require guessing deferred business policies.

Phase 1I does **not**:

* Activate a real second branch  
* Run inventory or HR schema migrations  
* Redesign payroll formulas  
* Restart sync or calendar integration  

---

## 3. Ownership matrix summary

### Shared global

`TblClient`, `TblEmp`, `TblUser`, `TblPro`/`TblCat` catalog identity, payment/expense category defs, global `BookingCode`, phone identity, shift name defs (`TblShift`).

### Branch-owned

`TblNewDay`, `TblShiftMove`, `TblinvServHead`, `TblCashMove`, `TblTreasuryCloseRecon`, `Bookings`, `QueueTickets`, `QueueBookingSettings`, `TblBranchPartnerShare`, access rows (`TblUserBranchAccess`, `TblEmpBranchAssignment`).

### Child-inherited

Invoice details/payments, booking services, queue history/services, purchase details (when purchases exist).

### Hybrid

Loyalty (global balance, preferred source branch on ledger), user/employee branch access, queue/global settings mix, **target** stock model (global catalog + branch qty — target not implemented).

### Consolidated-only

Financial reports (full-day, partners, monthly) — per-branch calculation then consolidate (Phase 1E).

### Inactive legacy

`TblCalendarSync`, `TblCalendarOutboundSync`; sync service metadata (~40 CT rows, service stopped).

### Blocked pending decision

Attendance, payroll/ledger/targets attribution, purchases, offers (`TblOffers` absent), budgets (`TblBudget` absent), nightly HR job topology, employee daily WhatsApp branch naming.

---

## 4. Previously hidden leaks (fixed in Phase 1I)

Operational routes that read **any** open day, **date-only** sales, or **TOP 1** settings without `BranchID`:

* `src/app/api/operations/status/route.ts`
* `src/app/api/day/rollover-check/route.ts`
* `src/app/api/day/history/route.ts`
* `src/app/api/day/summary/route.ts`
* `src/app/api/shift/route.ts`
* `src/app/api/shift/history/route.ts`
* `src/app/api/shift/summary/route.ts`
* `src/app/api/shifts/current/route.ts`
* `src/app/api/business-days/route.ts`
* `src/app/api/sales/today/route.ts` (open day query)
* `src/app/api/queue/settings/route.ts` (removed unscoped fallback)
* `src/app/api/admin/booking-settings-migrate/route.ts`

Integration:

* Sales WhatsApp → `gated.branch.branchName`
* Owner daily WhatsApp → iterates all active branches (no GLEEM preference)

**No migration** accompanied these fixes.

---

## 5. Deferred business decisions

| Topic | Blocker for branch #2? |
|---|---|
| Attendance branch ownership | **Yes** (staff check-in) |
| Inventory / purchases / `TblPro.Qty` | **Yes** (physical product sales) |
| Payroll cost attribution | **Yes** (full local HR) |
| Ledger source branch | Conditional (reports / P&L) |
| Target aggregation (branch vs all-branch) | Conditional |
| Loyalty source branch on ledger | No (preferred) |
| Service price overrides | No (future) |
| Offer scope | No (table absent) |
| Nightly close per-branch vs central HR | Conditional (automation) |
| Printer machine binding | Deployment (not schema) |

---

## 6. Explicit go-live blockers (before activating branch #2)

1. **Inventory:** Global stock on `TblPro.Qty`; purchases lack `BranchID` — implement preferred global catalog + branch inventory balance (future phase).  
2. **Attendance:** `TblEmpAttendance` has no `BranchID` — ambiguous for shared employees (cases 2–3 in HR doc).  
3. **Payroll / ledger / targets:** Cost attribution undecided — no speculative redesign in 1I.  
4. **Jobs:** Nightly close runs employee-globally — document or implement per-branch iteration before independent branch calendars.  
5. **Activation gate:** Do not set `IsActive=1` on a production second branch until 1–4 are addressed or scope is explicitly limited (e.g. services-only POS with centralized HR and no retail stock).

---

## 7. Regression boundary

Confirmed unchanged by Phase 1I:

| Item | State |
|---|---|
| GLEEM active branch count | **1** |
| PH1GTEST | **Inactive** |
| GLEEM financial/booking/queue data | No migration; formulas unchanged |
| Sync service | **Stopped** |
| Global BookingCode uniqueness | Unchanged |
| Employee overlap rules | Unchanged (`EMPLOYEE_GLOBAL_CONFLICT`) |
| Partner-share formulas | Unchanged |
| Phase 1A–1H accepted contracts | Preserved |

P0 route fixes scope reads to **active session branch** — for GLEEM-only users, observable behavior matches prior single-branch assumptions.

---

## 8. Artifacts delivered

**Code (corrections + registry)**

* P0 route files listed in §4  
* `src/lib/branch/domainOwnershipRegistry.ts`  
* `src/lib/hr/owner-daily-whatsapp-report.service.ts` (multi-branch iteration)  
* `src/app/api/sales/route.ts` (WhatsApp branch name)

**Scripts**

* `scripts/audit-branches/14-phase1i-live-inventory.cjs`  
* `scripts/audit-branches/_phase1i-live-inventory.json`

**Documentation (9 files)**

* `docs/branch-phase-1i-feature-inventory.md`  
* `docs/branch-phase-1i-database-ownership-matrix.md`  
* `docs/branch-phase-1i-shared-vs-owned-contract.md`  
* `docs/branch-phase-1i-inventory-and-assets.md`  
* `docs/branch-phase-1i-hr-payroll-boundary.md`  
* `docs/branch-phase-1i-settings-and-jobs.md`  
* `docs/branch-phase-1i-risk-register.md`  
* `docs/branch-phase-1i-verification.md`  
* `docs/branch-phase-1i-closure.md`

---

## 9. Next-phase boundary

Do **not** activate production branch #2 from this closure alone.

**Recommended next work (ordered by blocker severity):**

1. Business decision + schema for **branch inventory** (if retail products sold at branch #2)  
2. Business decision + schema for **attendance** branch events  
3. HR/payroll/ledger/target attribution policy + nightly job design  
4. Optional: employee daily WhatsApp branch name; `verify-multibranch-boundaries.ts` + `phase1iMultibranchBoundaries.test.ts`  
5. Phase 1G bootstrap + Phase 1H live smoke **only after** blockers cleared or scope narrowed  

Acceptance of Phase 1I is **audit completeness + P0 leak remediation + explicit NO-GO for branch #2 activation**, not second-branch go-live.
