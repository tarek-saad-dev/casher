# Phase 1I — Database Ownership Matrix

**Date:** 2026-07-24  
**Source:** Live read-only capture `scripts/audit-branches/_phase1i-live-inventory.json` (cloud / `last132`, 2026-07-23)  
**Tables with `BranchID` on live DB:** 12 (`TblBranch`, `TblUserBranchAccess`, `TblEmpBranchAssignment`, `TblBranchPartnerShare`, `TblNewDay`, `TblShiftMove`, `TblinvServHead`*, `TblCashMove`, `TblTreasuryCloseRecon`, `Bookings`, `QueueTickets`, `QueueBookingSettings`)

\* `TblinvServHead` has `BranchID` from Phase 1D backfill (confirmed in prior phase docs).

**No schema migration in Phase 1I** — matrix reflects live state plus expected future columns for deferred domains.

---

## Branch and access

| Schema | Object | ObjectType | BusinessDomain | Classification | OwnershipRoot | CurrentBranchColumn | ExpectedBranchColumn | ParentOwnershipPath | WritePaths | ReadPaths | MutationPaths | UniquenessScope | CacheScope | BackgroundJobScope | CurrentRisk | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dbo | TblBranch | Table | Branches | GLOBAL_MASTER | TblBranch | BranchID (PK) | N/A (identity) | — | bootstrap, admin | all branch lists | activate/deactivate | GLOBAL_UNIQUE (BranchCode) | GLOBAL_SAFE | listActiveBranches | Low | Approve global registry |
| dbo | TblUserBranchAccess | Table | Users | HYBRID_GLOBAL_IDENTITY_BRANCH_ACTIVITY | TblUserBranchAccess | BranchID NOT NULL | BranchID | TblUser | login, admin access | session, switcher | grant/revoke | USER+BRANCH | USER_AND_BRANCH_KEYED | — | Low | Approve hybrid |
| dbo | TblEmpBranchAssignment | Table | Employees | HYBRID_GLOBAL_IDENTITY_BRANCH_ACTIVITY | TblEmpBranchAssignment | BranchID NOT NULL | BranchID | TblEmp | HR assignment APIs | booking eligibility | effective dates | EMP+BRANCH+dates | BRANCH_KEYED | — | Low | Approve hybrid |

## Global masters (no BranchID)

| Schema | Object | ObjectType | BusinessDomain | Classification | OwnershipRoot | CurrentBranchColumn | ExpectedBranchColumn | ParentOwnershipPath | WritePaths | ReadPaths | MutationPaths | UniquenessScope | CacheScope | BackgroundJobScope | CurrentRisk | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dbo | TblClient | Table | Clients | GLOBAL_MASTER | TblClient | — | — | — | customers CRUD, public booking | search, history | update phone | GLOBAL (phone) | GLOBAL_SAFE | — | Med | Approve global identity |
| dbo | TblEmp | Table | Employees | GLOBAL_MASTER | TblEmp | — | — | — | employee admin | HR, POS, bookings | activate | GLOBAL (EmpID) | GLOBAL_SAFE | nightly (all emps) | Med | Approve global identity |
| dbo | TblUser | Table | Users | GLOBAL_MASTER | TblUser | — | — | — | user admin | auth session | password | GLOBAL | USER_KEYED | — | Low | Approve global |
| dbo | TblPro | Table | Catalog | GLOBAL_MASTER | TblPro | — | — (qty is not branch) | — | services admin | POS, booking, reports | soft delete | GLOBAL (ProID) | GLOBAL_SAFE | — | Med | Approve catalog global; **qty is separate risk** |
| dbo | TblCat | Table | Categories | GLOBAL_MASTER | TblCat | — | — | — | categories API | service lists | — | GLOBAL | GLOBAL_SAFE | — | Low | Approve global |
| dbo | TblPaymentMethods | Table | Payments | GLOBAL_MASTER | TblPaymentMethods | — | — | — | admin | cash/sales joins | — | GLOBAL | GLOBAL_SAFE | — | Low | Approve global |

## Branch-owned operational roots

| Schema | Object | ObjectType | BusinessDomain | Classification | OwnershipRoot | CurrentBranchColumn | ExpectedBranchColumn | ParentOwnershipPath | WritePaths | ReadPaths | MutationPaths | UniquenessScope | CacheScope | BackgroundJobScope | CurrentRisk | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dbo | TblNewDay | Table | Business day | BRANCH_OWNED_ROOT | TblNewDay | BranchID NOT NULL | BranchID | — | day open/close | session gating | close | BRANCH+NewDay | MUST_CLEAR_ON_SWITCH | per-branch day jobs (target) | Low post-1I | Approve branch-owned |
| dbo | TblShiftMove | Table | Shift instance | BRANCH_OWNED_ROOT | TblShiftMove | BranchID NOT NULL | BranchID | TblNewDay (date) | shift open/close | sales, treasury | force-close | one open/user global* | MUST_CLEAR_ON_SWITCH | per-branch | Low post-1I | Approve; *open shift uniqueness remains user-global |
| dbo | TblShift | Table | Shift defs | GLOBAL_MASTER | TblShift | — | — | — | shift definitions | UI labels | — | GLOBAL | GLOBAL_SAFE | — | Low | Approve global catalog |
| dbo | TblinvServHead | Table | Sales | BRANCH_OWNED_ROOT | TblinvServHead | BranchID NOT NULL | BranchID | day/shift | POST /api/sales | reports, recent | delete | invID global | BRANCH_KEYED | — | Low | Approve branch-owned |
| dbo | TblinvServDetail | Table | Sale lines | CHILD_INHERIT | TblinvServHead | — | inherit | TblinvServHead | sales create | employee services | reassign EmpID | inherit head | inherit | — | Low | Approve child inherit |
| dbo | TblinvServPayment | Table | Sale payments | CHILD_INHERIT | TblinvServHead | — | inherit | TblinvServHead | sales create | payment mix | — | inherit | inherit | — | Low | Approve child inherit |
| dbo | TblCashMove | Table | Treasury | BRANCH_OWNED_ROOT | TblCashMove | BranchID NOT NULL | BranchID | sale or session day | expenses, sales trigger | treasury reports | void | invID pattern | BRANCH_KEYED | — | Low | Approve branch-owned |
| dbo | TblTreasuryCloseRecon | Table | Treasury close | BRANCH_OWNED_ROOT | TblTreasuryCloseRecon | BranchID NOT NULL | BranchID | TblNewDay | reconciliation | close reports | — | day+method | BRANCH_KEYED | nightly per branch (target) | Low | Approve branch-owned |
| dbo | Bookings | Table | Bookings | BRANCH_OWNED_ROOT | Bookings | BranchID NOT NULL | BranchID | — | booking CRUD, public | flow board | cancel | BookingCode GLOBAL_UNIQUE | BRANCH_KEYED | — | Low | Approve branch-owned |
| dbo | BookingServices | Table | Booking lines | CHILD_INHERIT | Bookings | — | inherit | Bookings | booking create | availability | — | inherit | inherit | — | Low | Approve child inherit |
| dbo | QueueTickets | Table | Queue | BRANCH_OWNED_ROOT | QueueTickets | BranchID NOT NULL | BranchID | — | queue API | flow board | status | BRANCH+date+code | BRANCH_KEYED | — | Low | Approve branch-owned |
| dbo | QueueBookingSettings | Table | Queue/booking config | BRANCH_OWNED_ROOT | QueueBookingSettings | BranchID NOT NULL | BranchID | — | admin PATCH | public cache | migrate | UQ BranchID | BRANCH_KEYED (`__pos_public_settings_cache_by_branch_v1`) | — | Low post-1I | Approve branch-owned |
| dbo | QueueTicketHistory | Table | Queue audit | CHILD_INHERIT | QueueTickets | — | inherit | QueueTickets | status transitions | ops UI | — | inherit | inherit | — | Low | Approve child inherit |
| dbo | TblBranchPartnerShare | Table | Partner shares | BRANCH_OWNED_ROOT | TblBranchPartnerShare | BranchID NOT NULL | BranchID | — | admin seed | partners report | — | BRANCH+period | BRANCH_KEYED | — | Low | Approve branch-owned |

## Hybrid — loyalty

| Schema | Object | ObjectType | BusinessDomain | Classification | OwnershipRoot | CurrentBranchColumn | ExpectedBranchColumn | ParentOwnershipPath | WritePaths | ReadPaths | MutationPaths | UniquenessScope | CacheScope | BackgroundJobScope | CurrentRisk | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dbo | TblClientLoyalty | Table | Loyalty account | HYBRID_GLOBAL_IDENTITY_BRANCH_ACTIVITY | TblClientLoyalty | — | — (balance global) | TblClient | loyalty SPs | loyalty UI | adjust | GLOBAL per client | GLOBAL_SAFE | — | Med | Approve global balance |
| dbo | TblLoyaltyPointLedger | Table | Loyalty events | HYBRID_GLOBAL_IDENTITY_BRANCH_ACTIVITY | TblLoyaltyPointLedger | — | optional SourceBranchID (future) | TblClientLoyalty | earn/redeem SPs | ledger UI | reverse | GLOBAL ledger | GLOBAL_SAFE | — | Med | Prefer source branch tag; not hard blocker if atomic |

Live counts: `TblClientLoyalty` 1056 rows; `TblLoyaltyPointLedger` 2225 rows.

## Deferred — inventory and purchases

| Schema | Object | ObjectType | BusinessDomain | Classification | OwnershipRoot | CurrentBranchColumn | ExpectedBranchColumn | ParentOwnershipPath | WritePaths | ReadPaths | MutationPaths | UniquenessScope | CacheScope | BackgroundJobScope | CurrentRisk | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dbo | TblPro.Qty | Column | Inventory | HYBRID_GLOBAL_IDENTITY_BRANCH_ACTIVITY | TblPro (wrong root today) | — (qty global) | branch balance table or BranchID+ProID | TblPro identity | legacy/adjustments | POS display | stock edit | GLOBAL qty today | UNSAFE multi-branch | — | **Critical** | **Blocker** — future branch inventory root |
| dbo | TblProMove | Table | Stock movements | HYBRID (target) | TblProMove | — | BranchID | TblPro | 49 rows live; no active API | — | — | GLOBAL today | UNSAFE | — | High | Future branch-owned movements |
| dbo | TblinvPurchaseHead | Table | Purchases | DEFERRED_REQUIRES_BUSINESS_DECISION | TblinvPurchaseHead | **none** | BranchID required | — | no active route | — | — | GLOBAL invID | — | — | **Critical** | **Blocker** before branch #2 product receiving |
| dbo | TblinvPurchaseDetail | Table | Purchase lines | CHILD_INHERIT | TblinvPurchaseHead | — | inherit | purchase head | — | — | — | inherit | — | — | High | Defer with head |
| dbo | TblBarCode | Table | Barcodes | GLOBAL_MASTER | TblBarCode | — | — | TblPro | — | 0 rows | — | GLOBAL | GLOBAL_SAFE | — | Low | Approve global identity |

Live: `TblPro` 50 rows; `proHasQty: true`; `purchaseHasBranch: false`; `TblinvPurchaseHead` 0 rows; `TblProMove` 49 rows.

## Deferred — HR / payroll

| Schema | Object | ObjectType | BusinessDomain | Classification | OwnershipRoot | CurrentBranchColumn | ExpectedBranchColumn | ParentOwnershipPath | WritePaths | ReadPaths | MutationPaths | UniquenessScope | CacheScope | BackgroundJobScope | CurrentRisk | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dbo | TblEmpAttendance | Table | Attendance | DEFERRED_REQUIRES_BUSINESS_DECISION | TblEmpAttendance | **none** | BranchID (preferred) | TblEmp | attendance POST | payroll, HR board | upsert | EMP+WorkDate global | — | nightly close global | **Critical** | **Blocker** before branch #2 check-in |
| dbo | TblEmpDailyPayroll | Table | Daily payroll | DEFERRED_REQUIRES_BUSINESS_DECISION | TblEmpDailyPayroll | — | source branch attr. | TblEmp | payroll generate | full-day | post-to-cash | Emp+WorkDate | — | nightly global | **Critical** | Business decision required |
| dbo | TblEmpLedgerEntry | Table | Employee ledger | DEFERRED_REQUIRES_BUSINESS_DECISION | TblEmpLedgerEntry | — | optional SourceBranchID | TblEmp / CashMove | funding, payout, tips | ledger UI | void | global balance/emp | — | nightly | **Critical** | Business decision; cash link is branch-owned |
| dbo | TblEmpDailyTarget | Table | Targets | DEFERRED_REQUIRES_BUSINESS_DECISION | TblEmpDailyTarget | — | branch revenue scope | TblEmp | target generate | payroll, reports | recalc | Emp+WorkDate | — | nightly | High | Branch-specific vs aggregate decision |
| dbo | TblEmpTarget | Table | Target plans | DEFERRED | — | **table absent** | TBD | — | — | — | — | — | — | — | Low | N/A on last132 |
| dbo | TblEmpPayroll | Table | Payroll | DEFERRED | — | **table absent** | TBD | — | — | — | — | — | — | — | Low | N/A on last132 |
| dbo | TblPayrollMonth | Table | Monthly payroll | DEFERRED_REQUIRES_BUSINESS_DECISION | TblPayrollMonth | — | attribution TBD | — | monthly payroll | reports | — | month global | — | jobs | High | Defer redesign |

Live: `TblEmpAttendance` 893 rows; `TblEmpLedgerEntry` 517 rows; `attendanceHasBranch: false`.

## Settings, devices, legacy

| Schema | Object | ObjectType | BusinessDomain | Classification | OwnershipRoot | CurrentBranchColumn | ExpectedBranchColumn | ParentOwnershipPath | WritePaths | ReadPaths | MutationPaths | UniquenessScope | CacheScope | BackgroundJobScope | CurrentRisk | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dbo | TblSettings | Table | Settings defs | GLOBAL_MASTER | TblSettings | — | — | — | admin | readers | — | GLOBAL | GLOBAL_SAFE | — | Low | Approve global defs |
| dbo | TblSettingValues | Table | Settings values | HYBRID | TblSettingValues | — | per-key (mostly global) | TblSettings | split clearing writers | payment methods | — | Name key | GLOBAL_SAFE | — | Med | Classify per key; no GLEEM fallback |
| dbo | TblSettingPasswords | Table | Settings secrets | SECRET (app class) | TblSettingPasswords | — | — | — | admin | gated | — | GLOBAL | — | — | Med | Protect as secret |
| dbo | TblPrinter | Table | Printers | DEVICE_OR_DEPLOYMENT_LOCAL | TblPrinter | — | device binding | — | admin | print agent | — | machine local | DEVICE | — | Med multi-site | Document local binding |
| dbo | TblPrintSetting | Table | Print templates | DEVICE_OR_DEPLOYMENT_LOCAL | TblPrintSetting | — | branch override optional | — | admin | print | — | device | DEVICE | — | Med | Same as printers |
| dbo | TblCalendarSync | Table | Calendar inbound | INACTIVE_LEGACY | TblCalendarSync | — | must not write | — | none active | — | — | — | — | sync stopped | Low if stopped | Keep inactive |
| dbo | TblCalendarOutboundSync | Table | Calendar outbound | INACTIVE_LEGACY | TblCalendarOutboundSync | — | must not write | — | none active | — | — | — | — | sync stopped | Low | Keep inactive |
| dbo | TblBudget | Table | Budgets | DEFERRED | — | **absent** | BranchID if revived | — | — | — | — | — | — | — | Low | Defer until feature exists |
| dbo | TblOffers / TblOffer | Table | Offers | DEFERRED | — | **absent** | scope TBD | — | — | — | — | — | — | — | Med future | Classify before activation |

Live: `TblSettings` 2; `TblSettingValues` 4; `TblPrinter` 2; `TblPrintSetting` 5; `TblCalendarSync` 124; `TblCalendarOutboundSync` 37.

## Booking / queue live counts (Phase 1F)

| Table | Rows | BranchID |
|---|---:|---|
| Bookings | 1524 | NOT NULL |
| QueueTickets | 140 | NOT NULL |
| QueueBookingSettings | 2 | NOT NULL (GLEEM + PH1GTEST seed row) |

## Change tracking / sync registry

~40 tables registered in sync metadata (`syncEnabled` in live inventory); **sync service stopped and unused**. CT must not be interpreted as active multi-branch replication. Financial and booking tables with `BranchID` remain correct via application ownership, not sync.

## Forbidden columns verified absent

Phase 1I live inventory confirms **no** `BranchID` on: `TblEmpAttendance`, `TblinvPurchaseHead`, `TblEmpLedgerEntry`, `TblPro` (catalog), global masters. HR `BranchID` addition was explicitly not performed in 1I.
