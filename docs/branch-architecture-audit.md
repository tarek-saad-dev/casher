# Multi-Branch Architecture Audit

**Date:** 2026-07-22  
**Scope:** Read-only analysis of codebase and schema definitions in-repo  
**Status:** Audit only — no application code, schema, migrations, or data changes performed  
**Evidence labels:** Confirmed from code | Confirmed from database schema | Inferred from behavior | Requires verification

---

## 1. Executive summary

The system is a **single-salon, single-open-business-day** application on SQL Server (`mssql` via `src/lib/db.ts`). There is **no `BranchID`** on core operational or financial tables. The only existing multi-tenant column is optional nullable `SalonID` on Cut Club loyalty-store tables (`db/migrations/cut-club-economy-store.sql`) — unused by POS, treasury, bookings, payroll, or reports.

**Confirmed from code:** Opening a business day rejects if any `TblNewDay.Status = 1` row exists (`src/app/api/day/open/route.ts`). Sales, expenses, incomes, deductions, and treasury writes gate on that single open day plus the user’s open `TblShiftMove`. All financial activity converges on `TblCashMove`. Session cookies (`pos_session`) store only `UserID`, `UserName`, `UserLevel`, `iat` — no branch (`src/lib/session-types.ts`).

Introducing a second branch on one shared database without branch scoping would immediately mix:

- Treasury and sales reports  
- Queue / flow-board / public booking availability  
- Attendance, daily payroll, targets, and employee ledger balances  
- Invoice and cash-move ID sequences  
- Queue ticket codes for the same calendar date  

**Go/no-go for Phase 1 foundation work:** **GO** — the codebase is sufficiently mapped to begin foundation design (branch registry, session branch context, ownership rules). **Do not** implement Phase 1 in this audit.

**Phase 1A follow-up:** Security baseline and decision freeze — see `docs/branch-architecture-decisions.md` and `docs/branch-phase-1a-security-closure.md`.

---

## 2. Current architecture summary

| Layer | Current state | Evidence |
|-------|---------------|----------|
| Database | One SQL Server DB per environment (local `HawaiDB` / cloud `HawaiRestaurant`); dual pools, not branches | Confirmed from code: `src/lib/db.ts` |
| ORM | None — raw SQL | Confirmed from code |
| Business day | Singleton open day in `TblNewDay` | Confirmed from code: `day/open` |
| Shifts | Per-user open shift in `TblShiftMove`, stamped with day date | Confirmed from code: `shift/open` |
| Financial hub | `TblCashMove` (+ sales trigger `InsCashMoveSales`) | Confirmed from code / schema scripts |
| Auth | HMAC cookie `pos_session`; dual legacy `UserLevel` + `TblRoles`/pages | Confirmed from code: `session.ts`, `api-auth.ts` |
| Sync | Local↔cloud Change Tracking (`sync-service/`), not multi-branch | Confirmed from schema: `sync-service/sql/` |
| Partner shares | Hardcoded percentages in TypeScript | Confirmed from code: `src/lib/types/monthly-report.ts` |
| Products stock | No `TblPro` stock Qty in app; loyalty store has separate stock | Confirmed from code |
| API surface | ~262 `route.ts` handlers under `src/app/api` | Confirmed from code |
| Server actions | None (`"use server"` not used for writes) | Confirmed from code |

**Date models in use (must not be conflated):**

1. **`TblNewDay.NewDay`** — POS/treasury “today” for sales cash stamping  
2. **Cairo business date** (`getCairoBusinessDate`, cutoff 04:00 Africa/Cairo) — queue, flow-board, booking availability (`src/lib/businessDate.ts`)  
3. **Calendar `CAST(invDate AS DATE)`** — many reports  
4. **`WorkDate`** — attendance, daily payroll, targets  

---

## 3. Database classification matrix

Full checklist: `docs/branch-table-classification.csv`.

### 3.1 Global (shared identity / catalog)

| Table | Purpose | Needs BranchID? | Notes |
|-------|---------|-----------------|-------|
| `TblClient` | Shared clients | No | Shared identity; transactions expose branch |
| `TblClientLoyalty`, `TblLoyaltyTier`, `TblLoyaltyPointLedger` | Shared loyalty | No (ledger lines may tag branch later) | Points are client-global |
| `TblUser` | Login identities | No | Branch access via mapping |
| `TblRoles`, `TblUserRoles`, `TblSystemPages`, `TblPageRoleAccess` | RBAC definitions | No | Branch ACL separate |
| `TblEmp` | Employee identity | No | Assignments via mapping |
| `TblPro`, `TblCat` | Service/product definitions | No | Price/availability may be hybrid |
| `TblPaymentMethods` | Method definitions | No | Balances are branch-scoped via cash moves |
| `TblExpINCat` | Expense/income categories | No | |
| `TblShift` | Shift name definitions | No | Instances are branch-scoped |
| `TblSettingValues` | System settings | Hybrid/careful | Some may become per-branch |
| `TblAccounting*` classification tables | Accounting rules | No / hybrid | |

### 3.2 Branch-scoped (direct `BranchID` recommended on aggregate root)

| Table | Aggregate root | Inherit to children |
|-------|----------------|---------------------|
| `TblNewDay` | Day | Shifts, day summaries |
| `TblShiftMove` | Shift instance | Sales/cash stamped with ShiftMoveID |
| `TblinvServHead` | Sale/invoice | Details, payments inherit |
| `TblCashMove` | Cash movement | Ledger entries referencing CashMoveID |
| `TblTreasuryCloseRecon` | Day close recon | |
| `Bookings` | Booking | `BookingServices` inherit |
| `QueueTickets` | Queue ticket | Services/history inherit |
| `QueueBookingSettings` | Settings singleton today | Becomes per-branch |
| `TblEmpAttendance` (+ breaks) | Attendance day | |
| `TblEmpDailyPayroll` | Daily wage row | |
| `TblEmpDailyTarget` | Daily target | |
| `TblEmpTargetRecalcRequest` | Recalc queue | |
| `TblEmpLedgerEntry` | Ledger line | Tag branch; decide balance model |
| `TblBudgetMonth` (+ lines) | Budget | |
| `TblAutoGenLog` | Nightly gen log | |
| `TblStaffExpenseDistribution*` | Staff expense split | |
| Loyalty store stock tables | Item stock | Already have `SalonID` (align naming) |

### 3.3 Hybrid (mapping / override tables)

| Concern | Recommended structure |
|---------|----------------------|
| User ↔ branch access | `TblUserBranchAccess` (UserID, BranchID, role/flags, expires) |
| Employee ↔ branch assignment | `TblEmpBranchAssignment` (EmpID, BranchID, active, schedule home?) |
| Service price/availability per branch | Override table or nullable BranchID on settings |
| Partner ownership % per branch | Replace hardcoded `PARTNERS` with branch-scoped config |
| Printers | Per workstation/branch |
| `TblEmpWorkSchedule` / day-off / overrides | Per assignment or BranchID if schedules differ by site |
| `TblEmpServiceSettings` | May stay emp+service global or become branch-aware |
| `TblExpCatEmpMap` | Usually global mapping; cash impact is branch via CashMove |

### 3.4 Inheritance rule (do not stamp every child)

```text
Confirmed pattern to preserve:
Invoice head owns BranchID.
TblinvServDetail / TblinvServPayment inherit from head.
Cash moves created for a sale inherit from sale/shift/day.
BookingServices inherit from Bookings.
QueueTicketServices / history inherit from QueueTickets.
```

### 3.5 Sync schema

`sync.*` tables (`Node`, `TableRegistry`, `Batch`, …) are infrastructure for local↔cloud replication — **not** branch entities. Multi-branch on one DB changes conflict/apply assumptions (**Requires verification** of live CT participation list).

---

## 4. API write-path matrix

Full checklist: `docs/branch-api-classification.csv`.

### 4.1 Highest-risk write hubs

| Route | Entry | Tables | Branch source today | Future source |
|-------|-------|--------|---------------------|---------------|
| `POST /api/sales` | `src/app/api/sales/route.ts` | Head/Detail/Payment, CashMove (trigger), loyalty SP, target recalc | Open day + user shift | Secure session branch |
| `PUT/DELETE /api/sales/[id]` | `sales/[id]/route.ts` via `executeAuditedAction` | Same + reverse | None | Session branch + parent record |
| `POST /api/expenses`, `/incomes`, `/deductions` | respective routes | `TblCashMove` (+ ledger dual-write) | Open day/shift | Session branch |
| `POST /api/treasury/transfer` | audited | 2× CashMove | Session day/shift | Session branch |
| `POST /api/treasury/reconciliation` | `closeTreasuryDay` | NewDay, Recon | Global day | Session branch day |
| `POST /api/day/open|close|close-and-open` | `day/*` | NewDay, ShiftMove | Global | Session branch |
| `POST /api/shift/open|close` | `shift/*` | ShiftMove | Global day | Session branch day |
| `POST /api/public/booking/create|plan` | public routes | Bookings, services, maybe Client | None (site implied) | Explicit public-site branch config |
| Queue create / arrive / patch | `queue/*`, `operations/queue/*` | QueueTickets… | Cairo date only | Session or site branch |
| Payroll generate / post-to-cash | `payroll/daily/*` | DailyPayroll, CashMove, ledger | WorkDate only | Explicit job branch or session |
| Nightly close | `admin/hr/nightly-close` | attendance, payroll, targets, WhatsApp | Cron, no branch | System job per branch |
| Ledger funding/payout/tips | HR/POS services | CashMove + ledger | Day/shift | Paying treasury branch |
| Sync-service apply | `sync-service/` | Any CT table | N/A | Must not blindly merge two live branches |

### 4.2 Frontend-trusted ownership (security-sensitive)

| Pattern | Evidence | Risk |
|---------|----------|------|
| Sale employee lines from cart | `POST /api/sales` body EmpIDs | Attribution fraud / wrong branch targets |
| Expense/income amounts & categories from client | expenses/incomes routes | Financial misstatement |
| Past-date expense/income | `*/past-date` routes | Backdating across branches |
| Public booking emp/date/slot | public create/plan | Double-book if not branch-scoped |
| `api/db/toggle` switches entire DB | `src/app/api/db/toggle/route.ts` | Catastrophic in multi-site deploy if unauth |
| Admin store/migrate under `/api/admin/` | proxy treats `/api/admin/` as edge-public | Unauthenticated writes if route lacks `getSession` |

**Confirmed from code:** `src/proxy.ts` marks entire `/api/admin/` as public at the edge; security depends on per-route checks. Many admin store/migrate/debug routes lack session guards.

### 4.3 Transaction boundaries (confirmed patterns)

- `executeAuditedAction` → `SERIALIZABLE` + `TblSensitiveActionAuditLog` (`src/lib/sensitiveActionAudit.ts`)  
- Sales create: transaction + `allocateInvID` + applock `SqlAllocator:TblinvServHead:invID:مبيعات`  
- Booking/queue writes: `operations-schedule:{empId}:{operationalDate}` applock (`src/lib/scheduleIntegrity.ts`)  
- Queue ticket numbers: `UPDLOCK, HOLDLOCK` (`src/lib/queueTicketCode.ts`)

---

## 5. Read/report matrix

Full checklist: `docs/branch-report-classification.csv`.

| Surface | Route/page | Current filter | Future mode | Leakage |
|---------|------------|----------------|-------------|---------|
| Owner full-day | `/admin/reports/full-day`, `GET /api/admin/reports/full-day` | `workDate` only | Selected + All + Compare; **aggregate per branch first** | Critical |
| Partners | `/admin/reports/partners` | year/month; hardcoded % | Per-branch shares then consolidate | Critical |
| Sales today / recent | `/api/sales/today`, `/recent`, `/more` | date or TOP N **global** | Active branch | Critical |
| Recent invoices cache | `useRecentInvoices` / `buildRecentInvoicesCacheKey` | filters, **no branch in key** | Include BranchID | High |
| Treasury daily/period | `/api/treasury/*` | NewDay / date / shift | Active / selected | Critical |
| Employee services | `/api/reports/employee-services` | date range, emp | Active/selected | High |
| Payroll daily/monthly | `/api/payroll/daily`, `/monthly` → `sp_GetMonthlyPayroll` | WorkDate / range | Active; SP needs branch | Critical |
| Employee ledger | `/api/admin/hr/employee-ledger*` | emp, month | Decide global balance vs per-branch | Critical |
| Attendance / targets | admin + POS team attendance | date | Active branch staff | High |
| Budget | `/api/budget*` | year/month unique globally | Per branch | Critical |
| Bookings / flow-board / queue | `/api/bookings`, `/operations/flow-board`, `/api/queue` | date | Active | Critical |
| Public availability | `/api/public/booking/available-*` | date/services | Site branch | Critical |
| Client history | `/api/customers/[id]/history-summary` | clientId | All branches tagged | Med–High |
| Loyalty stats | `/api/loyalty/stats` | unfiltered | Client-global OK; ops stats branch | High |
| Store stats | `getStoreStats()` | **ignores SalonID** | Filter by branch | High |

**Formula risk:** Partner settlement and owner P&L must apply **branch-specific partner percentages and expense rules after per-branch nets**, not on a pre-mixed total. Confirmed hardcoded partners in `PARTNERS` (`monthly-report.ts`).

---

## 6. Business-day and shift analysis

### 6.1 Open

```text
POST /api/day/open
→ requires day.open permission
→ SELECT TOP 1 … WHERE Status = 1  (no ORDER BY — inconsistent with other routes)
→ INSERT TblNewDay (CAST(GETDATE() AS DATE), Status=1)
```

**Confirmed from code:** Only one open day allowed for the entire database.

### 6.2 Close

```text
POST /api/day/close
→ open day ORDER BY ID DESC
→ optionally force-close ALL open shifts (WHERE Status=1, no day filter)
→ Status=0 on day
```

Treasury reconciliation (`POST /api/treasury/reconciliation`) is the richer close path writing `TblTreasuryCloseRecon`.

### 6.3 Overnight

- **POS overnight:** open `TblNewDay` stays open past midnight; sales keep `invDate = activeDay.NewDay`.  
- **Ops overnight:** Cairo cutoff 04:00 (`businessDate.ts`); queue/bookings use business date; overnight shifts load next-day busy intervals.

### 6.4 `TblShiftMove`

Created on `POST /api/shift/open` with `NewDay` = active day date, one open shift per user. Referenced by `TblinvServHead.ShiftMoveID`, `TblCashMove.ShiftMoveID`, recon.

### 6.5 Multi-branch implications

| Assumption | Risk if two branches share DB |
|------------|-------------------------------|
| Single `Status=1` day | Second branch cannot open independently |
| `WHERE NewDay = @date` treated unique | Ambiguous day rows |
| Force-close all open shifts | Closes other branch cashiers |
| `allocateInvID` global | Shared sequences |
| Sales require “the” open day | Cross-branch day bleed |

**Recommended future strategy (design only):**  
`UNIQUE (BranchID, NewDay)` with **independent open status per branch**. Shifts and cash inherit branch from day. Do not reuse a single global open-day flag.

**Migration of history:** Backfill all existing `TblNewDay` / shifts / cash / sales to the founding branch ID. **Historical data migration risk: High** if multiple physical sites already used one DB informally (**Requires verification**).

---

## 7. Treasury and finance analysis

### 7.1 End-to-end flows

```text
Sale
→ POST /api/sales (TX + allocateInvID)
→ TblinvServHead / Detail / Payment
→ trigger InsCashMoveSales → TblCashMove
→ optional split clearing (splitPaymentService)
→ sp_Loyalty_EarnPointsFromSale
→ enqueue TblEmpTargetRecalcRequest
→ WhatsApp
→ reports: full-day, partners, treasury, employee-services
```

```text
Expense / Income / Deduction / Tip / Funding / Payout / Payroll post / Transfer
→ allocateInvID on TblCashMove
→ TblCashMove (+ optional TblEmpLedgerEntry dual-write)
→ treasury summaries / full-day / partners / ledger
```

```text
Delete invoice / expense / income
→ executeAuditedAction (SERIALIZABLE)
→ delete/rewrite cash + loyalty + ledger hard-delete by CashMoveID
→ target recalc
```

### 7.2 Ownership

| Record | Direct BranchID? |
|--------|------------------|
| `TblCashMove` | Yes — financial root for non-sale cash |
| `TblinvServHead` | Yes — sale root |
| Payment/detail lines | Inherit |
| `TblEmpLedgerEntry` | Yes on entry (treasury branch of cash, or revenue branch of target) |
| `TblTreasuryCloseRecon` | Yes |
| Category masters | No |

### 7.3 Orphans / mismatch risks

- Ledger dual-write can desync if cash deleted without ledger cleanup (partially mitigated by `cashMoveHardDeleteService`).  
- Staff expense distribution triggers on cash may allocate without branch awareness.  
- Split-payment clearing rows must stay same branch as parent sale.  
- Filesystem `data/partners-employee-overrides.json` is not SQL-synced.

### 7.4 Unique indexes at financial risk

- App-level budget `(Year, Month)` uniqueness  
- Implied uniqueness of `TblNewDay.NewDay` (FK from recon migration)  
- Global `allocateInvID` per `invType`  
- Filtered ledger uniques by RefType/RefID (OK if RefIDs stay unique; branch needed on entry for reporting)

---

## 8. Sales and invoice analysis

| Topic | Finding | Label |
|-------|---------|-------|
| Invoice key | `(invID, invType)` allocated by MAX+1 + applock | Confirmed from code |
| Date stamp | `invDate = TblNewDay.NewDay` | Confirmed from code |
| Shift stamp | `ShiftMoveID` from user’s open shift | Confirmed from code |
| Detail EmpID | From request lines | Confirmed from code |
| Convert booking | `POST /api/bookings/[id]/convert` creates sale | Confirmed from code |
| Refund API | None dedicated — delete/update only | Confirmed from code |
| Reassign revenue | `POST /api/reports/employee-services/reassign` updates Detail EmpID | Confirmed from code |

**Future:** Branch from session day/shift; never accept `branchId` from sale payload for authorization.

---

## 9. Booking and operations analysis

| Component | Tables / modules | Branch need |
|-----------|------------------|-------------|
| Public create/plan/cancel | `Bookings`, `BookingServices`, helpers | Site branch config |
| Availability | `bookingAvailabilityEngine`, schedules, attendance, queue intervals | Filter busy by branch **and** keep **global employee conflict** if staff shared |
| Schedule integrity | applock `operations-schedule:{empId}:{date}` | Include BranchID in lock **or** keep emp-global lock if emp cannot double-book across branches |
| Queue | `QueueTickets`, `UQ_QueueTickets_Code_Date` | Branch in unique key |
| Flow board | `GET /api/operations/flow-board` (edge-public) | Active branch |
| Settings cache | `globalThis.__pos_public_settings_cache_v1` TTL 45s | Key by BranchID |
| Overrides | `TblEmpScheduleOverrides` | Hybrid |

**Employee conflict policy (recommendation):** If employees can work only one chair at a time globally, conflict checks stay **cross-branch**. Capacity/visibility for public booking stays **per branch**.

**After-midnight risk:** Mixing Cairo business date with `TblNewDay` without branch can attribute 00:00–04:00 bookings/sales to the wrong site day.

---

## 10. HR / payroll / ledger / target analysis

| Process | Work date source | Amount source | Cash source | Future branch rule |
|---------|------------------|---------------|-------------|--------------------|
| Attendance | Request/admin date | N/A | N/A | Branch of attendance site |
| Daily payroll generate | WorkDate | Hours × rate / rules | Optional post-to-cash | Branch of attendance |
| Monthly salary ledger post | Month | Entitlement calc | None (ledger only) | Policy decision |
| Advance (deduction) | Open day | Request | Paying CashMove | Branch of paying treasury |
| Payout / funding / tip | Open day | Request | Paying CashMove | Branch of paying treasury |
| Target generate | WorkDate + invoice revenue | Invoice details | Ledger sync | Branch of invoice revenue |
| Target recalc queue | EmpID+WorkDate unique | Sales side effects | Ledger | Same as invoice branch |
| Employee ledger balance | Sum of entries | Mixed sources | Mixed | **Business decision:** one global balance vs per-branch balances |

**Risk:** One `TblEmpLedgerEntry` balance today is **global per employee**. Advances at branch A and sales targets at branch B already mix in one balance (**Confirmed from code** — no branch column on ledger). Multi-branch makes this financially ambiguous.

---

## 11. Clients and loyalty analysis

| Topic | Recommendation |
|-------|----------------|
| `TblClient` | Global shared |
| Phone normalize / duplicate prevention | Keep global uniqueness behavior |
| Invoice history | Show all branches with branch name on each operation |
| Loyalty points | Shared identity; earn/redeem may record branch on ledger for audit |
| Cashier view | May see client profile + recent visits; should **not** see other branch treasury/P&L |
| Follow-up `UX_TblCustomerFollowUp_ClientMonth` | Still global per client-month unless product wants per-branch follow-up |

---

## 12. Inventory / services analysis

| Topic | Finding |
|-------|---------|
| `TblPro.Qty` as stock | **Not used** as product stock — `Qty` is line quantity on bookings/invoice details | Confirmed from code |
| Service catalog | `TblPro` + `TblCat` global | |
| Prices | `SPrice1` global today → likely hybrid overrides | |
| Quick sale | `QuickSales` flag + sales-count ordering | Hybrid possible |
| Classic purchases/returns/stock moves | Not implemented for `TblPro` | Confirmed from code |
| Loyalty store stock | `TblLoyaltyStoreItem.StockQuantity` + optional `SalonID` | Align with BranchID |
| Offers | Loyalty personal offers computed; no branch assignment | Decision needed |
| Branch transfers | No transfer document exists — introducing stock transfers is new scope | |

---

## 13. Authentication and permissions analysis

### Current

```text
Role (partial): UserLevel admin|user + TblRoles/page access
Where: nowhere — implied single site
Session: { UserID, UserName, UserLevel, iat }
```

### Recommended separation

```text
Role permission: What can this user do?
Branch permission: Where can this user do it?
```

| Topic | Recommendation |
|-------|----------------|
| Active branch storage | Server-side session (signed cookie claim) + optional DB session row; validate against `TblUserBranchAccess` |
| Temporary access | `ExpiresAt` on mapping; re-validate every request |
| `ALL_BRANCHES` reports | Super-admin / explicit report role only; never default for cashiers |
| Dangerous `branchId` from request | All money writes, day/shift, payroll post, deletes, transfers, public booking admin overrides |

**Unguarded / weak auth hotspots:** `/api/admin/*` edge bypass; `api/db/toggle`; flow-board public; optional session on some payroll target GETs; UI-only nav hiding via `useMyAccess`.

---

## 14. Caching and integrations analysis

| Cache | Key | Needs BranchID? | Leakage |
|-------|-----|-----------------|---------|
| Public settings | `__pos_public_settings_cache_v1` | Yes | High |
| Queue schema exists caches | module vars | No | Low |
| Recent invoices (client) | filter JSON | Yes | High |
| Partners overrides file | single JSON file | Yes / per branch files | High |
| Rate limit Map | IP | Optional per site | Med |
| Report server cache | none found | — | — |

| Integration | Notes |
|-------------|-------|
| WhatsApp | `WHATSAPP_DEFAULT_BRANCH_NAME` default `جليم` — single name | Confirmed from code |
| Print | localhost:7788 per workstation | OK per branch machine |
| Google Calendar | Not found | Confirmed from code |
| Sync-service | Local↔cloud CT — redesign before two live branches share one cloud DB | |
| Env | `CLOUD_DB_*` / `LOCAL_DB_*` — environment, not branch | |

---

## 15. Existing constraints and indexes

| Name | Columns | Branch impact |
|------|---------|---------------|
| `UQ_QueueTickets_Code_Date` | TicketCode, QueueDate | Must add BranchID |
| `UX_Bookings_BookingCode` | BookingCode (filtered) | Prefer globally unique codes OR (BranchID, code) |
| `UQ_TblEmpAttendance_Emp_Date` | EmpID, WorkDate | Add BranchID if emp can attend two sites same day; else keep global |
| `UQ_TblEmpWorkSchedule_Emp_Day` | EmpID, DayOfWeek | Hybrid if schedules differ by branch |
| `UQ_TblEmpDayOff_Emp_Date` | EmpID, OffDate | Same |
| `UQ_TblEmpDailyTarget_Emp_WorkDate` | EmpID, WorkDate | Add BranchID if targets per site |
| `UX_TblEmpTargetRecalcRequest_EmpID_WorkDate` | EmpID, WorkDate | Same |
| `UX_TblEmpTargetPlan_EmpID_EffectiveFrom` | EmpID, EffectiveFrom | Hybrid |
| `UX_TblEmpLedgerEntry_ActiveRefReason` | RefType, RefID, EntryReason filtered | Keep; add BranchID column separately |
| `UX_TblEmpLedgerEntry_DailyTargetRef` | filtered | Same |
| `UQ_StoreCategory_Code` / `UQ_StoreItem_Code` | Code, SalonID | Align SalonID→BranchID |
| `UQ_ClientInventory_VoucherCode` | VoucherCode global | OK shared |
| App: budget Year+Month | — | Add BranchID |
| App: single open NewDay | — | Per branch |
| App: `allocateInvID` | per invType | Per branch or branch-prefixed |
| Applock schedule | empId+date | Decide global vs per-branch |
| Applock inv allocator | table+invType | Per branch |

**Requires verification on live DB:** uniqueness of `TblNewDay.NewDay`; PK column name of `TblShiftMove` (`ID` in app vs `ShiftMoveID` in recon migration); `PaymentID` vs `PaymentMethodID` naming mismatch.

---

## 16. Data migration risks

| Risk | Severity | Notes |
|------|----------|-------|
| Backfill all history to Branch 1 | High | Correct if truly single site historically |
| Split historical data by heuristic (cashier, machine) | Very high | Error-prone |
| Ledger balances already mix sources | High | Need opening balance policy per branch |
| Target/payroll unique keys | High | Duplicates if naively adding BranchID without rebuild |
| Sync CT anchors | High | Two branches in one DB vs two DBs |
| Partners % applied to mixed history | High | Restate prior settlements |
| Queue codes reuse per date | Med | Collision after branch split |
| Loyalty SalonID NULL rows | Med | Treat as Branch 1 or global catalog |

---

## 17. Security risks

1. **Critical:** Money and day APIs have no branch authorization model yet — adding client-supplied `branchId` would enable cross-branch fraud.  
2. **Critical:** `/api/admin/` edge-public + unguarded mutate routes.  
3. **Critical:** Cross-branch data leakage on every unfiltered report/list.  
4. **High:** `api/db/toggle` can switch entire database.  
5. **High:** Public booking availability reveals capacity across sites if unscoped.  
6. **High:** Flow-board publicly readable at edge.  
7. **Medium:** Session secret fallback hardcoded in `session.ts`.  
8. **Medium:** UI-only permission hiding.

---

## 18. Recommended future branch ownership rules

```text
1. Branch registry table (global).
2. Session active BranchID validated against user branch access every request.
3. TblNewDay / TblShiftMove / TblinvServHead / TblCashMove / Bookings / QueueTickets / Attendance / DailyPayroll / DailyTarget / BudgetMonth / TreasuryCloseRecon → direct BranchID.
4. Child lines inherit from aggregate root — do not require BranchID unless queried independently at scale.
5. TblClient / TblEmp / TblUser / catalogs → global.
6. UserBranchAccess / EmpBranchAssignment → hybrid mappings.
7. Employee time conflicts → global if shared staff; display boards → branch.
8. Advances/payouts/tips → branch of paying treasury (CashMove).
9. Targets → branch of invoice.
10. Hourly wage → branch of attendance.
11. Loyalty points balance → global; optional branch on ledger lines.
12. ALL_BRANCHES → report-only, privileged.
13. Never trust branchId from browser for writes.
14. Nightly jobs iterate branches explicitly.
15. Align/replace SalonID with BranchID for store tables.
```

---

## 19. Recommended implementation dependency order

1. **Business decisions** (section 20)  
2. **Branch registry + seed founding branch** (schema only in a later phase)  
3. **User/employee branch mappings + session active branch**  
4. **Auth hardening** (remove dangerous public admin mutates; forbid client branch spoofing)  
5. **TblNewDay / ShiftMove branch uniqueness** + backfill  
6. **Stamp BranchID on CashMove + invoice head** (inherit elsewhere)  
7. **Filter POS/treasury writes and reads**  
8. **Bookings/queue/settings/availability**  
9. **Attendance/payroll/targets**  
10. **Ledger attribution rules + report rewrites** (full-day, partners)  
11. **Caches/WhatsApp/print labels**  
12. **Sync-service redesign** if still dual-DB  
13. **Partner % configuration per branch**  
14. **Optional:** service price overrides, store SalonID migration  

---

## 20. Unresolved questions requiring business decision

1. Can the same employee work two branches the same day?  
2. Should employee ledger balances be global or per-branch?  
3. Are partner ownership percentages identical per branch or different?  
4. Is public booking one website per branch or one site with branch picker?  
5. Should service prices be global or overridable per branch?  
6. Will inventory/product stock be introduced, or remain services-only + loyalty store?  
7. Is historical data 100% one physical branch for backfill?  
8. Should queue ticket sequences be per-branch or globally unique?  
9. Does `ALL_BRANCHES` owner view need comparison charts in Phase 1 or later?  
10. Keep local↔cloud sync, or move to single cloud DB with branches?  
11. Naming: reuse `SalonID` or standardize on `BranchID`?  
12. Can a cashier hold shifts on two branches without re-login?

---

## 21. Final go/no-go recommendation for starting Phase 1

### **GO — with constraints**

The current architecture is well enough understood to start **Phase 1 foundation only**:

- Branch registry design  
- Mapping tables design  
- Session/active-branch design  
- Ownership rules freeze  
- Auth gap remediation plan  
- Backfill strategy for founding branch  

### Explicitly out of scope until decisions in §20 are answered

- Adding `BranchID` columns  
- Migrations  
- UI branch switcher  
- Dual open days in production  
- Report rewrites  

### Confidence

| Area | Confidence |
|------|------------|
| Day/shift/sales/treasury write gating | High (code-confirmed) |
| Report mixing risk | High (code-confirmed) |
| Booking/queue concurrency | High (code-confirmed) |
| Live DB constraint parity vs migrations | Medium (**Requires verification** scripts) |
| Whether production already has multi-site data in one DB | Low (**Requires verification**) |

---

## Appendix A — Evidence index (key files)

| Topic | Path |
|-------|------|
| DB pools / allocateInvID | `src/lib/db.ts` |
| Session types | `src/lib/session-types.ts` |
| Day open | `src/app/api/day/open/route.ts` |
| Cairo business date | `src/lib/businessDate.ts` |
| Sales create | `src/app/api/sales/route.ts` |
| Schedule applock | `src/lib/scheduleIntegrity.ts` |
| Full-day report | `src/lib/reports/full-day-report.ts` |
| Partners % | `src/lib/types/monthly-report.ts` |
| Public settings cache | `src/lib/publicBookingHelpers.ts` |
| Edge proxy public prefixes | `src/proxy.ts` |
| Queue unique | `db/migrations/queue-booking-system.sql` |
| SalonID store | `db/migrations/cut-club-economy-store.sql` |
| Sync schema | `sync-service/sql/02-create-sync-schema.sql` |

## Appendix B — How to run read-only audit scripts

See `scripts/audit-branches/README.md`.

```bash
node scripts/audit-branches/01-list-tables-and-rowcounts.cjs
node scripts/audit-branches/02-list-constraints-and-indexes.cjs
node scripts/audit-branches/03-branch-readiness-probes.cjs
```
