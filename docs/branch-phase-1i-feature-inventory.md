# Phase 1I — Feature Inventory and Branch Boundary Audit

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Live active branches:** 1 (GLEEM); PH1GTEST inactive (BranchID 2)  
**Sync:** stopped and unused (~40 CT registry rows; service not running)

This inventory maps application features to ownership classes, live schema facts, and branch safety as of Phase 1I. Classification vocabulary is fixed: `GLOBAL_MASTER`, `BRANCH_OWNED_ROOT`, `CHILD_INHERIT`, `EMPLOYEE_GLOBAL_CONFLICT`, `HYBRID_GLOBAL_IDENTITY_BRANCH_ACTIVITY`, `CONSOLIDATED_READ`, `DEVICE_OR_DEPLOYMENT_LOCAL`, `INACTIVE_LEGACY`, `DEFERRED_REQUIRES_BUSINESS_DECISION`.

Source registry: `src/lib/branch/domainOwnershipRegistry.ts` (verification metadata only; not runtime auth).

---

## Summary by domain

| Domain | Feature | UI paths | API paths | Tables | Write root | Read root | Current ownership | Expected class | Branch-safe now? | Risk | Required correction | Test coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Branches | Branch registry & bootstrap | Admin (implicit) | `/api/branches/active`, `/api/branches/available`, `/api/auth/branches`, bootstrap scripts | `TblBranch`, `TblUserBranchAccess`, `TblEmpBranchAssignment` | `TblBranch` | `TblBranch` | Global registry + per-branch access rows | `GLOBAL_MASTER` + hybrid access | Yes (GLEEM only) | Low | None for GLEEM | `phase1gSecondBranchReadiness`, `phase1hBranchSwitcher` |
| Branch switcher | In-session active branch switch | `ActiveSessionBar`, `MobilePosHeader`, `BranchSwitcher` | `/api/auth/switch-branch`, `/api/auth/branches` | Session cookie only | Session | Session | Session `activeBranch` | `BRANCH_OWNED_ROOT` (session scope) | Yes | Low | Live E2E smoke deferred until second branch activated | `phase1hBranchSwitcher` (22 tests) |
| POS sales | Create/update/delete invoice | `/income/pos` | `/api/sales`, `/api/sales/today`, `/api/sales/recent`, `/api/sales/[id]`, `/api/sales/more` | `TblinvServHead`, `TblinvServDetail`, `TblinvServPayment`, `TblCashMove` | `TblinvServHead` (via day/shift) | Head + branch filter | Branch-owned (Phase 1D) | `BRANCH_OWNED_ROOT` | Yes | Low | Product stock decrement still global on `TblPro.Qty` if physical products sold | `phase1dFinancialOwnership`, sales route tests |
| Day / shift | Open day, shifts, rollover, status | POS header, day modals | `/api/day/*`, `/api/shift/*`, `/api/shifts/current`, `/api/business-days`, `/api/operations/status` | `TblNewDay`, `TblShiftMove`, `TblShift` | `TblNewDay`, `TblShiftMove` | Active branch session | Branch-owned; **P0 leaks fixed in 1I** | `BRANCH_OWNED_ROOT` | Yes (post-1I) | Was Critical → Low | Prior unscoped TOP 1 / date-only queries corrected | `phase1cDayShift`, route marker checks in registry |
| Treasury | Cash, transfer, recon | Treasury UI | `/api/treasury/*`, `/api/expenses`, `/api/incomes`, `/api/deductions` | `TblCashMove`, `TblTreasuryCloseRecon` | `TblCashMove` | Branch filter | Branch-owned (Phase 1D) | `BRANCH_OWNED_ROOT` | Yes | Low | None | `phase1dFinancialOwnership` |
| Bookings | Admin + convert to sale | `/operations`, booking boards | `/api/bookings`, `/api/bookings/[id]`, `/api/operations/bookings/*` | `Bookings`, `BookingServices` | `Bookings` | Branch filter | Branch-owned (Phase 1F) | `BRANCH_OWNED_ROOT` + `CHILD_INHERIT` | Yes | Low | Emp overlap remains global | `phase1fBookingQueueOwnership` |
| Queue | Walk-in tickets | `/queue`, flow board | `/api/queue`, `/api/queue/[id]`, `/api/queue/settings` | `QueueTickets`, `QueueBookingSettings`, children | `QueueTickets`, `QueueBookingSettings` | Branch filter | Branch-owned; settings **TOP 1 fallback removed in 1I** | `BRANCH_OWNED_ROOT` | Yes | Low | None | `phase1fBookingQueueOwnership` |
| Public booking | Customer self-serve | Sibling `cut-salon-rtl-booking` | `/api/public/branches`, `/api/public/booking/*` | `Bookings`, `QueueBookingSettings` | `Bookings` (branchCode required) | Per `branchCode` | Branch-owned writes | `BRANCH_OWNED_ROOT` | Yes | Low | No silent GLEEM default | `phase1f` public contract docs |
| Clients | CRUD, search, history | Customer admin, POS client pick | `/api/customers/*`, public booking upsert | `TblClient` | `TblClient` | Global identity; history via invoice branch | Global master | `GLOBAL_MASTER` | Yes (single branch) | Med (privacy at scale) | Filter operational history by branch when multi-branch UI added | Customer route tests (partial) |
| Loyalty | Earn/redeem/adjust | Loyalty admin, POS | Loyalty SPs, `/api/sales` side effects | `TblClientLoyalty`, `TblLoyaltyPointLedger` | Ledger rows | Global balance | Hybrid — balance global | `HYBRID_GLOBAL_IDENTITY_BRANCH_ACTIVITY` | Conditional | Med | Source-branch on ledger preferred; atomic global balance | Loyalty tests (partial) |
| Inventory / purchases | Product qty, purchases, moves | Limited / legacy admin | No active purchase API in repo; `TblPro` admin seeds | `TblPro`, `TblProMove`, `TblinvPurchaseHead`, `TblinvPurchaseDetail` | `TblPro.Qty` (global) | Global qty | **Global stock — blocker** | `HYBRID` (target) / purchases `DEFERRED` | **No** | **Critical** | Branch inventory balance model + purchase BranchID (future phase) | Live inventory audit only |
| HR attendance | Check-in/out, board | HR attendance UI | `/api/employees/attendance` | `TblEmpAttendance` | Emp+WorkDate (no BranchID) | Emp-global | Employee-global row | `DEFERRED_REQUIRES_BUSINESS_DECISION` | **No** | **Critical** | BranchID or fail-closed before branch #2 check-in | Attendance tests (no branch) |
| HR payroll / ledger / targets | Daily/monthly payroll, ledger, targets | `/admin/hr/*` | `/api/payroll/*`, ledger services, nightly close | `TblEmpDailyPayroll`, `TblEmpLedgerEntry`, `TblEmpDailyTarget`, `TblPayrollMonth*` | Emp+WorkDate / Emp | Consolidated reads | Employee-global; cash links branch-owned | `DEFERRED_REQUIRES_BUSINESS_DECISION` | **No** | **Critical** | Cost attribution decision; nightly close not per-branch | `employeeLedger*`, payroll tests |
| Reports | Full-day, partners, monthly | Admin reports | `/api/admin/reports/*`, `/api/reports/monthly` | Financial + HR joins | N/A (read) | Scope metadata | Per-branch calc then consolidate (Phase 1E) | `CONSOLIDATED_READ` | Yes (financial); HR deferred | Med | HR monthly still emp-global | `phase1eReportScope` |
| WhatsApp | Sale, booking, employee daily, owner daily | N/A (background) | Via sales/booking/nightly close services | N/A | Message payloads | Branch name in payload | **1I:** sales use `gated.branch.branchName`; owner iterates active branches | Integration | Partial | Med | Employee daily WA still uses `defaultBranchName` config | `whatsapp.test`, owner service change |
| Printers | Receipt / report print | POS print modal | Local agent `127.0.0.1:7788`; `TblPrinter`, `TblPrintSetting` | `TblPrinter`, `TblPrintSetting` | Device-local | Machine binding | Device/deployment local | `DEVICE_OR_DEPLOYMENT_LOCAL` | N/A (single site) | Med at multi-site | Document machine binding; validate invoice branch on reprint | Manual / deferred |
| Settings | App + queue booking settings | Admin booking settings | `/api/admin/booking-settings`, `/api/queue/settings`, clearing config | `TblSettings`, `TblSettingValues`, `QueueBookingSettings`, `TblSettingPasswords` | Mixed | Mixed | Queue settings branch-owned; split clearing global | `HYBRID` | Yes (queue); partial (global KV) | Med | No GLEEM fallback for missing branch settings | Queue settings route |
| Calendar sync | Legacy Google sync | None (inactive) | None active | `TblCalendarSync`, `TblCalendarOutboundSync` | None | CT-enabled legacy | Inactive | `INACTIVE_LEGACY` | Yes (stopped) | Low if stays stopped | Do not restart without branch design | Live inventory |
| Bootstrap | Second branch creation | CLI | `scripts/bootstrap-branch.ts` | `TblBranch`, copies from GLEEM template | `TblBranch` | Readiness checks | Infra only; does not activate branch | `GLOBAL_MASTER` | Yes (infra) | Low | Do not activate PH1GTEST or branch #2 in 1I | `phase1gSecondBranchReadiness`, smoke scripts |

---

## Phase 1I P0 route corrections (code only)

These routes were corrected to scope reads/writes to `requireActiveBranchContext` / `BranchID`:

| Route | Fix |
|---|---|
| `src/app/api/operations/status/route.ts` | Active-branch open day, shifts, day sales |
| `src/app/api/day/rollover-check/route.ts` | Active-branch stale-day check |
| `src/app/api/day/history/route.ts` | `BranchID = @branchId` |
| `src/app/api/day/summary/route.ts` | `validateBusinessDayBelongsToBranch` |
| `src/app/api/shift/route.ts` | `getUserOpenShiftForBranch` |
| `src/app/api/shift/history/route.ts` | Branch-scoped history |
| `src/app/api/shift/summary/route.ts` | `validateShiftBelongsToBranch` |
| `src/app/api/shifts/current/route.ts` | Branch-scoped current shift |
| `src/app/api/business-days/route.ts` | Branch-scoped business days |
| `src/app/api/sales/today/route.ts` | Open-day query scoped to branch |
| `src/app/api/queue/settings/route.ts` | Removed unscoped TOP 1 fallback |
| `src/app/api/admin/booking-settings-migrate/route.ts` | Scoped to active branch |

Additional integration fixes:

* Sales WhatsApp payloads pass `gated.branch.branchName` (not config default when branch known).
* Owner daily WhatsApp iterates all active branches via `listActiveBranches()` (no GLEEM preference).

---

## Domains explicitly out of scope for 1I schema work

No migration was run in Phase 1I. These remain documented blockers or deferred decisions:

* Inventory stock on `TblPro` + purchases without `BranchID`
* Attendance without `BranchID`
* Payroll / ledger / targets cost attribution
* Offers (`TblOffers` absent on `last132`)
* Nightly close / HR jobs (employee-global orchestration)
* Printers (device-local binding)

See companion docs: `branch-phase-1i-inventory-and-assets.md`, `branch-phase-1i-hr-payroll-boundary.md`, `branch-phase-1i-settings-and-jobs.md`, `branch-phase-1i-risk-register.md`.
