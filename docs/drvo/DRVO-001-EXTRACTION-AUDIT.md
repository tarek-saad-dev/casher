# DRVO-001 — Extraction Audit

| Field | Value |
|-------|-------|
| Document | `DRVO-001-EXTRACTION-AUDIT` |
| Phase | Casher → DRVO extraction audit (**documentation only**) |
| **Audited Git HEAD SHA** | `f5e43773545d25467af7b302b974191418a3f8dd` |
| Branch at audit | `chore/drvo-001-extraction-audit` |
| Authority | **This is an audit, not a final architecture decision.** Recommendations are **provisional** / **candidate** / **evidence-backed**. Final decisions belong to **DRVO-002**. |

Companion docs: [DOMAIN-MAP](./DRVO-001-DOMAIN-MAP.md) · [DEPENDENCY-GRAPH](./DRVO-001-DEPENDENCY-GRAPH.md) · [MIGRATION-ORDER](./DRVO-001-MIGRATION-ORDER.md)

---

## 1. Purpose and constraints

### 1.1 Goal

Classify major Casher domains against a **target DRVO shape** (Platform Core / Shared Domains / Independent Apps / Industry Extensions) using **repository evidence**, and record migration risks and provisional extraction sequencing inputs for DRVO-002.

### 1.2 Hard constraints for this phase

- Read-only w.r.t. production/business code, schema, env, runtime, deploy.
- Only documentation under `docs/drvo/` may be created/updated.
- Unrelated dirty working-tree files are **out-of-baseline** and must not be treated as audited architecture unless the same fact is verified at HEAD.

### 1.3 Evidence labels (mandatory)

| Label | Meaning |
|-------|---------|
| **VERIFIED CURRENT STATE** | Confirmed against HEAD code, API handlers, domain services, and/or SQL migrations/schema references |
| **INFERRED FUTURE DESIGN** | Provisional DRVO recommendation derived from evidence — **not** a decision |
| **NEEDS RUNTIME VERIFICATION** | Cannot be fully confirmed from static inspection of this repo alone |
| **OUT-OF-BASELINE** | Present only in uncommitted working tree; not used as verified evidence |

Historical files under `docs/**` were used for **discovery only**. Important claims below were re-checked against code/migrations/APIs.

---

## 2. Verification methodology

1. Inventory UI (`src/app/**/page.tsx` ≈ **102** pages) and API (`src/app/api/**/route.ts` ≈ **402** handlers) at HEAD.
2. Trace domain services in `src/lib/**` and module boundaries in `src/modules/**`.
3. Inspect `db/migrations/**` (**82** `.sql` files) plus runtime `src/lib/migrations/**` ensure-helpers.
4. Treat `src/lib/branch/domainOwnershipRegistry.ts` as **verification metadata / hint**, then confirm classifications against writers/readers.
5. For dirty paths (`nightly-close.service.ts`, session components, etc.), use `git show HEAD:…` rather than working-tree contents.

**Audited HEAD:** `f5e43773545d25467af7b302b974191418a3f8dd`

---

## 3. System snapshot (VERIFIED CURRENT STATE)

### 3.1 Runtime stack

- **App:** Next.js App Router (UI + Route Handlers).
- **DB:** Microsoft SQL Server via raw `mssql` pool (`src/lib/db.ts`). **No Prisma/Drizzle/TypeORM schema layer.**
- **Auth:** HMAC-signed cookie `pos_session` (`src/lib/session.ts`); edge gate `src/proxy.ts` + public allowlist; handlers re-auth via `src/lib/api-auth.ts`.
- **Permissions:** DB roles/pages (`TblRoles`, `TblUserRoles`, `TblSystemPages`, `TblPageRoleAccess`) via `src/lib/permissions-server.ts`; legacy `userLevel` map still exists.
- **Multi-location:** `BranchID` on operational roots; session `ActiveBranchID` / `ActiveBranchCode`; client distinguishes **viewBranch** vs **operationalBranch**.
- **Multi-tenant SaaS:** **No `TenantId` / `tenant_id` anywhere in `src/`** (search at audit time). Nullable `SalonID` on Cut Club store tables is **not** an active tenant model.

### 3.2 Code layout

| Layer | Role |
|-------|------|
| `src/app` | UI pages + `api/**` handlers |
| `src/lib` | Primary domain logic (booking, hr, payroll, branch, treasury, …) |
| `src/modules` | **Mixed maturity (see §3.5):** Messaging + AI are substantive. Attendance has substantive application/domain services that still reach into `src/lib/hr`. Operations has substantive day/shift lock + mutation infrastructure. `business-day` / `transfers` / `availability` remain closer to Phase-A facades. `src/modules/README.md` is **stale** relative to attendance/operations HEAD code. |
| `db/migrations` | Incremental T-SQL evolution; legacy POS tables often **predate** in-repo CREATE |

### 3.3 External integrations (VERIFIED CURRENT STATE)

| Integration | Evidence | Notes |
|-------------|----------|-------|
| WhatsApp (local bot HTTP) | `src/lib/integrations/whatsapp`, `src/modules/messaging`, internal webhook routes | Feature-flagged message types |
| Google Gemini | `src/modules/messaging/ai`, `src/modules/ai-control-plane` | AI receptionist / learning |
| Cloudinary | `src/lib/cloudinary.ts` | Image upload |
| SQL Server | `src/lib/db.ts` | System of record |
| YouTube Data API | `/api/operations/music/youtube-search` | Ops floor music |
| Local print agent | `src/lib/localPrintClient.ts` | Device-local |
| Card PSP / SMS SaaS | **Not found** as first-class SDKs | Payments are internal methods + CashMove |
| **DB trigger `InsCashMoveSales`** | `db/migrations/add-financial-branch-ownership.sql`; legacy snapshot `scripts/audit-branches/_insCashMoveSales.sql`; sales API comments | AFTER INSERT on `TblinvServHead` → `TblCashMove` (see §6.5a) |

### 3.4 Central UI hubs (VERIFIED CURRENT STATE)

| Hub | Path | Couples |
|-----|------|---------|
| Floor ops | `/operations` | Queue + booking + HR presence + transfers |
| POS | `/income/pos` | Sales + customer + attendance widget + WhatsApp quick actions |
| HR | `/admin/hr` | Employees, attendance, daily payroll, ledger |
| Admin ops | `/admin/operations` | Day/shift/treasury governance |
| CUT Club | `/admin/cut-club` | Loyalty store ecosystem |
| Nav source | `src/components/layout/nav-config.ts` | Domain navigation |

### 3.5 Module boundary classification (VERIFIED CURRENT STATE)

Do **not** describe Attendance/Operations as “thin facades only.” Accurate HEAD classification:

| Module | Facade / re-export pieces | Substantive application services | Persistence / TX / lock infra | Still couples to legacy |
|--------|---------------------------|----------------------------------|-------------------------------|-------------------------|
| `messaging` | Public barrel | Campaigns, inbox/outbox, AI receptionist, handoff | Outbox/inbox repositories, webhook routes | Calls booking tools; WhatsApp HTTP |
| `ai-control-plane` | Barrel | Learning interpret/approve flows | AI learning tables | Gemini |
| `attendance` | `index.ts` still re-exports many symbols; some infra wrappers over `src/lib/hr` | **`AttendanceCommandService.ts`** (~1.3k lines): admin/legacy/bulk/work-on-day-off/restore/schedule-control commands; domain policy modules | `AttendanceRepository`, break DB adapters | **Heavy** imports from `src/lib/hr/*`, availabilityEngine, WhatsApp notify |
| `operations` | Some service facades bridge older branch APIs | `BusinessDayService`, `ShiftSessionService`, bootstrap, open/close/handoff, reconcile | **`businessDayLock.ts`**, **`businessDayMutationTx.ts`**, **`shiftMutationTx.ts`**, **`requestScope.ts`** — UPDLOCK day/shift serialization used by financial writes | Types/errors from `src/lib/branch`; SQL against `TblNewDay`/`TblShiftMove` |
| `business-day` | Mostly re-export / thin | Limited | Limited | `src/lib` |
| `transfers` | Re-export | Limited | Limited | `src/lib/hr/temporaryBranchTransfer` |
| `availability` | Re-export notifier | Limited in-module | Limited | `src/lib/booking` |

**Not fully isolated:** even substantive modules still reach legacy SQL domains / `src/lib`. Extraction would still need anti-corruption boundaries.

---

## 4. Source-of-Truth Matrix

> **Candidate DRVO Owner** and **Sync Direction** are **INFERRED FUTURE DESIGN** (provisional).  
> **Current Source of Truth / Writers / Readers / Legacy Identity** aim for **VERIFIED CURRENT STATE**.

| Entity | Current Source of Truth | Current Writers | Current Readers | Candidate DRVO Owner (provisional) | Legacy Identity | Required Mapping (provisional) | Sync Direction During Migration (provisional) | Conflict Risk | Verification Status |
|--------|-------------------------|-----------------|-----------------|------------------------------------|-----------------|--------------------------------|-----------------------------------------------|---------------|---------------------|
| Tenant / business | **Does not exist** as entity; one DB deployment | N/A | Entire app implicitly | Platform Core — tenant | N/A | Introduce `TenantId`; map current DB → one tenant | Casher DB → DRVO tenant (one-shot seed) | Critical if multi-salon later | VERIFIED CURRENT STATE: absent; INFERRED FUTURE DESIGN: Platform Core |
| Location / Branch | `TblBranch` | Admin branch provision/lifecycle APIs | Session, ACL, all branch-scoped ops | Platform Core — locations | `BranchID` INT; `BranchCode` (e.g. GLEEM) | `BranchID` → `LocationId` (+ TenantId) | Dual-read then cutover; keep BranchCode stable | High if code assumes BranchID=1 | VERIFIED CURRENT STATE |
| User | `TblUser` | Users admin APIs; login | Session, permissions, shift open | Platform Core — users/auth | `UserID` INT | Map to DRVO User + credentials redesign | Auth cutover carefully; password model ADAPT/REPLACE | High (session/branch version) | VERIFIED CURRENT STATE |
| Customer | `TblClient` | Customers APIs; public booking upsert; POS | Booking, queue, sales, loyalty, follow-up | Shared Domain — customers | `ClientID` INT; phone identity | ClientID → CustomerId (+ TenantId) | Shared domain first; apps keep FK mapping table | High (duplicate phones) | VERIFIED CURRENT STATE |
| Employee | `TblEmp` (+ assignment maps) | Admin HR employee APIs | Booking, queue, attendance, payroll, POS lines | Shared Domain — workforce | `EmpID` INT | EmpID → EmployeeId; assignments → location eligibility | Shared domain; preserve global conflict semantics | Critical (cross-branch busy) | VERIFIED CURRENT STATE |
| Service | `TblPro` (service rows) + `TblCat` | Services/admin catalog APIs | Booking, queue, POS, packages, reports | Shared Domain — catalog | `ProID` INT | ProID → ServiceId/CatalogItemId | Catalog extract early | Medium (price global) | VERIFIED CURRENT STATE |
| Product | Same `TblPro` catalog family; retail/stock via branch inventory / store items | Catalog + inventory/store writers | Inventory, CUT Club store, POS product lines | Shared Domain — catalog (+ Inventory app for stock) | `ProID` / store `ItemID` | Split service vs product types in DRVO (candidate) | Catalog identity → apps for stock qty | Medium–High (TblPro dual use) | VERIFIED CURRENT STATE mixed service/product; INFERRED split |
| Booking | `Bookings` + `BookingServices` + claim/hold/projection tables | Public/staff scheduling APIs; convert route for commercial path | Flow-board, calendar, convert-to-sale, WhatsApp | Independent App — booking (**scheduling** candidate first) | `BookingID`; global `BookingCode` uniqueness | BookingID → BookingId; BranchID → LocationId | Scheduling extract candidate; **conversion** stays adapter/legacy until POS posting contract | High (slot races; convert TX) | VERIFIED CURRENT STATE (split A/B) |
| Queue ticket | `QueueTickets` + services/history | Queue APIs; ops queue | Flow-board, estimates, booking link | Independent App — queue | `QueueTicketID`; code unique per branch+date | TicketId mapping; BranchID | After or with booking scheduling; shared board composition | High (ops coupling) | VERIFIED CURRENT STATE |
| Invoice | `TblinvServHead` (+ detail/payment) | `/api/sales` (`مبيعات`); booking convert (`خدمة`); POS | Reports, targets, loyalty earn | Independent App — POS/sales | Composite `(invID, invType)` | Surrogate InvoiceId + legacy composite map | POS extract after shared identities + posting contract | Critical (financial) | VERIFIED CURRENT STATE |
| Payment / cash movement | `TblCashMove` (+ treasury recon); **sale rows also via `InsCashMoveSales`** | App: expenses/incomes/tips/payroll/transfers/split; **DB trigger** on matching invoice head INSERT | Treasury, reports, ledger FK, partners | Independent App — treasury **and/or** platform money movement contract (candidate) | `TblCashMove.ID` INT | CashMoveId; replace trigger with explicit posting when crossing DB boundary | Dual-run posting period | **Critical** | VERIFIED CURRENT STATE hub+trigger in-repo; production enablement NEEDS RUNTIME VERIFICATION |
| Attendance | `TblEmpAttendance` (+ breaks) | Attendance APIs; POS widget; nightly finalize | Payroll, ops presence, reports | Independent App — attendance | Attendance `ID`; unique Branch+Emp+WorkDate (post multi-branch) | AttendanceId; WorkDate semantics | Extract with workforce shared ID | High (open-session global conflict) | VERIFIED CURRENT STATE |
| Payroll entry | `TblEmpDailyPayroll`, ledger `TblEmpLedgerEntry`, targets | Payroll generate; nightly close; ledger dual-write; advances | HR UI, WhatsApp daily, accounting | Independent App — payroll | Payroll/Ledger `ID` INT | Map Emp+Branch+WorkDate accounts | Late extract after attendance + sales allocation contract | **Critical** | VERIFIED CURRENT STATE; dirty local regen scripts OUT-OF-BASELINE |
| Inventory item / stock | Catalog: `TblPro`; stock: `TblBranchInventory` / movements; Cut Club: store items + `TblClientInventory` | Purchases post; inventory APIs; store buy/use | Branch readiness, CUT Club UI | Inventory app for stock; Shared catalog for item identity; Cut Club industry for rewards | `ProID` / movement BIGINT often | Separate retail stock vs reward inventory | Stock after catalog; Cut Club parallel | Medium | VERIFIED CURRENT STATE (two inventory concepts) |
| Message / conversation | `TblMessageInbox`/`Outbox`, bot conversation/message/AI turn | Messaging module enqueue/send; WhatsApp webhook; campaigns | Inbox UI, AI context, correlations | Messaging app + Platform webhook/outbox infra (split candidate) | BIGINT IDs common | MessageId; channel account per tenant | **Infra prerequisite ≠ full WhatsApp app extract** | High (fan-in from many domains) | VERIFIED CURRENT STATE |

---

## 5. Day / Shift / Operational Session — candidate ownership (no decision)

### 5.1 VERIFIED CURRENT STATE

| Concept | Storage | Behavior |
|---------|---------|----------|
| Business day | `TblNewDay` with `BranchID` | Per-branch open day; used as financial and ops anchor |
| Shift definition | `TblShift` | Global catalog of shift names |
| Shift instance | `TblShiftMove` | Per-user open/closed shift; branch-scoped; stamped on financial docs |
| Write gate | `resolveBranchDayAndShiftForWrite` in `src/lib/branch/operationalGates.ts` | If user has OPEN shift → **SHIFT scope** uses **operational** branch (never view cookie). Else DAY scope via operate access on view/active branch |
| Session UX | SessionProvider + ActiveSessionBar | **viewBranch** (what you look at) vs **operationalBranch** (where open shift lives) |
| Ops composition | `loadFlowBoardForBranch` | Reads HR presence + bookings + queue for one `branchId` |
| Operations module | `src/modules/operations` | Substantive day/shift lock + mutation TX infra (see §3.5); **not** a thin facade; still not a DRVO ownership decision |

Financial writers that must resolve day/shift (registry markers): sales, expenses, incomes, deductions, purchases, treasury transfer, booking convert — **VERIFIED CURRENT STATE** via `domainOwnershipRegistry.BRANCH_OWNED_ROUTE_MARKERS`.

### 5.2 Candidate owners (provisional — DRVO-002 chooses)

| Candidate | Supporting evidence | Tradeoffs |
|-----------|---------------------|-----------|
| **A. Platform Core** | Nearly every financial and ops write needs day/shift; session bootstrap is global chrome | Risk of Platform Core becoming a dumping ground for salon ops rituals; hard to version per industry |
| **B. Workforce / shared operational domain** | Attendance WorkDate, emp branch work-day close, payroll day generation, nightly close are workforce-centric | Underfits cashier shift cash ownership and treasury recon; booking may not want HR ownership of “day” |
| **C. POS / Operations app** | Shift open/close, shift recon, POS default landing, treasury close, ops board are cashier/floor UX | Booking/public availability still need a “business date” without POS; multi-app tenants may run booking without POS |
| **D. Industry-specific extension** | Cutoff times, salon floor board, barber presence UX feel salon-shaped | **Weak** as sole owner: day/shift tables are generic multi-branch financial primitives — extension may own **UX/policy**, not identity |

### 5.3 Explicit non-decision

**DRVO-001 does not select an owner for Day / Shift / Operational Session.**  
Domain map marks placement as **undecided**. Migration docs treat day/shift as a **coupling risk** and a **platform prerequisite topic**, not as “extract into Platform Core.”

---

## 6. Per-domain audit summaries

Each subsection: VERIFIED CURRENT STATE facts, then provisional recommendations (INFERRED FUTURE DESIGN).

### 6.1 Platform: auth, permissions, branches

- **UI:** `/login`, `/admin/users`, `/admin/permissions/*`, `/admin/branches/*`
- **APIs:** `/api/auth/*`, `/api/admin/branches/*`, `/api/permissions/*`
- **Libs:** `session.ts`, `api-auth.ts`, `permissions-server.ts`, `src/lib/branch/*`
- **Writes:** users, roles, page ACL, branch lifecycle, user-branch access
- **Reads:** every authenticated handler
- **Isolation:** branch package is relatively cohesive; auth is cross-cutting
- **Provisional:** ADAPT into Platform Core tenant + location + auth; introduce TenantId (**INFERRED**)
- **Risks:** session BranchSessionVersion upgrades; partner-only shells; plaintext password legacy

### 6.2 Shared: customers, catalog, workforce

- **Customers:** global `TblClient`; follow-up UI only under admin; operational UX embedded in POS/booking
- **Catalog:** `TblPro`/`TblCat`/packages/execution steps; global price until overrides exist
- **Workforce:** `TblEmp` + `TblEmpBranchAssignment` + transfers + schedules; **EMPLOYEE_GLOBAL_CONFLICT** for booking/queue busy intervals (`domainOwnershipRegistry` + `empIntervalLockResource` in `publicBookingCreateLocks.ts`)
- **Provisional:** EXTRACT as Shared Domains early so apps take stable identity APIs
- **Risks:** integer IDs everywhere in TS `number`; phone uniqueness; employee dual-branch same day edge cases (**NEEDS RUNTIME VERIFICATION** for all production edge policies)

### 6.3 Booking — scheduling lifecycle vs commercial conversion

Treat Booking as **two capability bundles**. Provisional extraction may advance them on different timelines (**INFERRED FUTURE DESIGN** — not a DRVO-002 decision).

#### A. Booking scheduling lifecycle (create / availability / hold / cancel / reschedule)

- **UI:** `/bookings/*`, `/admin/booking/operations`
- **APIs:** `/api/bookings/*` (non-convert), `/api/public/booking/*`
- **Libs:** `src/lib/booking/**` engines, claims, projections, idempotency; post-commit WhatsApp notify
- **Tables:** `Bookings`, `BookingServices`, claims/holds/projections/`TblPublicBooking*`
- **Isolation:** relatively strong engine boundaries; still SQL-joins shared masters
- **Provisional:** **EXTRACT** — **valid candidate for first major business-app** scheduling slice
- **Risks:** SERIALIZABLE create/cancel; global emp applocks; public surface

#### B. Booking commercial conversion (`POST /api/bookings/[id]/convert`)

VERIFIED CURRENT STATE from `src/app/api/bookings/[id]/convert/route.ts`:

| Step | Behavior |
|------|----------|
| Gate | `resolveBranchDayAndShiftForWrite` + `finalizeCurrentFinancialWrite` + `lockOperationalWrite` |
| Invoice head | INSERT `TblinvServHead` with **`invType = N'خدمة'`** (not `مبيعات`) |
| Invoice detail | INSERT `TblinvServDetail` from `BookingServices` |
| Booking update | `Status='completed'`, `ConvertedInvID` / `ConvertedInvType` |
| One SQL TX? | **Yes** — head + details + booking update; rollback on failure |
| Payment rows | **No** `TblinvServPayment` inserts in this route |
| Loyalty / WhatsApp / target recalc | **Not** invoked here |
| Idempotency | If `ConvertedInvID` already set → **409**; no convert RequestID table |
| CashMove via `InsCashMoveSales`? | Trigger matches `مبيعات` / `مبيعات بالكارت` (+ reverse types), **not** `خدمة` → **no trigger CashMove expected** for convert (VERIFIED from migration trigger body). Live treasury treatment of `خدمة` = **NEEDS RUNTIME VERIFICATION** |

**Provisional recommendation:** scheduling (A) may extract earlier; conversion (B) should remain behind an **adapter / legacy transactional boundary** until POS financial posting contracts exist. Do **not** assume A extract automatically moves B.

### 6.4 Queue + operations floor

- **UI:** `/queue/*`, `/operations`
- **APIs:** `/api/queue/*`, `/api/operations/*`
- **Libs:** `queueLifecycleEngine`, `loadFlowBoardForBranch`, ops bootstrap; operations module lock/mutation infra (§3.5)
- **Coupling:** flow-board Promise.all loads barbers/bookings/queue + HR presence + availability — **direct cross-domain SQL composition**
- **Provisional:** EXTRACT queue app; treat `/operations` as composition UI (candidate)
- **Risks:** Critical product UX dependency on join query

### 6.5 POS / sales / invoices

- **UI:** `/income/pos`, sales/income-review routes
- **APIs:** `/api/sales/*` (canonical `invType=N'مبيعات'`), `/api/pos/*`, `/api/incomes/*`
- **Tables:** invoice head/detail/payment
- **Gate:** `resolveBranchDayAndShiftForWrite`
- **Cash posting:** app **does not** INSERT initial sale CashMove; **`InsCashMoveSales` DB trigger** does (§6.5a)
- **Same TX as sale (VERIFIED `/api/sales` POST):** head, detail, payment, trigger CashMove, optional split redistribute, target-recalc enqueue
- **After commit (async / best-effort):** loyalty `sp_Loyalty_EarnPointsFromSale`, WhatsApp
- **Provisional:** EXTRACT POS only with explicit posting/reversal contract replacing trigger semantics
- **Risks:** Critical — composite identity; trigger-backed atomicity; convert uses different `invType`

### 6.5a Database trigger `InsCashMoveSales`

| Question | Finding |
|----------|---------|
| Event | `AFTER INSERT` on `dbo.TblinvServHead` |
| Canonical body | `db/migrations/add-financial-branch-ownership.sql` (multi-row; inherits `BranchID`/`BusinessDayID`) |
| Legacy snapshot | `scripts/audit-branches/_insCashMoveSales.sql` (older scalar form; superseded by migration intent) |
| Rows created | `TblCashMove` copying inv identity/amounts/ShiftMoveID/PaymentMethodID (+ Branch/Day); `inOut` by invType |
| Matching invTypes | `مبيعات` (in, `ReservTime IS NULL`), `مبيعات بالكارت` (out, `ReservTime IS NULL`), `م.مبيعات` (out), `م.مبيعات بالكارت` (in) |
| Non-matching | e.g. convert `خدمة` — no CashMove from these rules |
| API TX dependence | Sales API: “trigger is the single code path.” Trigger runs **inside the same SQL TX** as head INSERT; API rollback rolls back trigger rows |
| Split payments | Trigger inserts clearing “in”; app `redistributeFromClearing` in same TX |
| Reversal | Reverse invTypes insert opposite `inOut` on reverse head INSERT; full void/recon parity **NEEDS RUNTIME VERIFICATION** |
| Treasury recon | Depends on CashMove rows existing |
| Production enablement | `scripts/verify-financial-branch-ownership.ts` can probe live DB; **this audit did not** → **NEEDS RUNTIME VERIFICATION** |

**Extraction implication (INFERRED, not a designed contract):** moving POS/Sales across a service/database boundary **can break trigger-backed atomic behavior** unless replaced by an **explicit posting contract**. DRVO-001 does **not** design that contract.

### 6.5b Financial coexistence (current atomicity boundaries)

| Participant | Relationship | Status |
|-------------|--------------|--------|
| Invoice head/detail/payment | Same app TX on POS create | VERIFIED |
| `InsCashMoveSales` | Same TX as head INSERT | VERIFIED |
| Split redistribution | Same TX after trigger | VERIFIED |
| Target recalc enqueue | Same TX; process after commit | VERIFIED |
| Loyalty earn / reverse | After commit / separate APIs; best-effort earn | VERIFIED |
| Tips / ledger dual-write | Separate TX paths; CashMove + ledger | VERIFIED pattern |
| Payroll post / nightly | Orchestration across domains; not one TX with POS | VERIFIED HEAD shape |
| Purchases → inventory | SERIALIZABLE purchase TX + stock post; not InsCashMoveSales | VERIFIED |
| Booking convert | Own TX; `خدمة`; no payment/loyalty; no matching sale trigger CashMove | VERIFIED |

### 6.6 Treasury / expenses

- **UI:** `/treasury/*`, `/expenses*`, `/deductions`, budget
- **APIs:** `/api/treasury/*`, `/api/expenses/*`, `/api/deductions/*`, `/api/budget/*`
- **Hub:** `TblCashMove` (app writers + sale trigger)
- **Provisional:** EXTRACT with explicit ledger API
- **Risks:** Critical hub; recon naming hazards

### 6.7 Attendance / payroll / ledger

- **UI:** `/admin/hr` tabs; salary expense screens
- **APIs:** `/api/payroll/*`, `/api/admin/hr/*`, attendance routes; nightly close
- **Orchestration (HEAD):** `runNightlyClose` — attendance finalize → payroll (+ ledger dual-write) → targets → monthly salary → WhatsApp (`git show HEAD:…`)
- **Dual-write:** `employeeLedgerDualWrite.ts`
- **Module:** `src/modules/attendance` has **substantive** `AttendanceCommandService` + domain policies; still heavily imports `src/lib/hr` (§3.5) — **not** “facade-only”
- **Provisional:** EXTRACT attendance before payroll
- **Risks:** Critical; dirty regen scripts **OUT-OF-BASELINE**

### 6.8 Inventory / purchasing

- **UI:** thin (branch opening inventory; CUT Club inventory)
- **APIs:** `/api/purchases`, `/api/inventory/*`
- **TX:** purchase create can post stock in same SERIALIZABLE TX
- **Provisional:** EXTRACT; lower UI coupling than POS/ops
- **Risks:** Medium

### 6.9 Loyalty / CUT Club

- **UI:** `/admin/loyalty`, `/admin/cut-club/*`
- **Earn:** post-commit SP from sales; reverse via `/api/loyalty/reverse-sale`
- **Provisional:** EXTRACT loyalty points; CUT Club branding as Industry Extension
- **Risks:** `SalonID`; non-atomic earn vs sale

### 6.10 Messaging / WhatsApp / AI

- **Infra vs app:** outbox/webhook infra may precede Booking; full Messaging app is not a hard Booking gate
- **Risks:** fan-in from booking/HR/POS

### 6.11 Reports / accounting / partners — not assumed read-only

**Separate:**

| Kind | Evidence | Provisional class |
|------|----------|-------------------|
| Report / query read models | `/api/reports/*`, many `/api/admin/reports/*` GETs, monthly/full-day reads | Independent App — reports (read models) **ADAPT** |
| Reporting-adjacent **commands / config** | `PUT /api/admin/reports/partners-overrides` (override store writes); `POST …/full-day/owner-whatsapp`; partner branch `PUT`; accounting classification settings writes; cash-move classification audit UIs | Config/command surfaces — **ADAPT** separately from pure read models; may sit with partners/admin or accounting |

Do **not** treat “Reports” as a pure read-only query service.

### 6.12 Industry-specific (salon)

Provisional Industry Extension candidates: salon concierge knowledge, barber floor UX, groom packages, CUT Club mystery-box branding, salon AI tools.

---

## 7. Integer IDs, multi-tenancy hazards, future TenantId

### 7.1 VERIFIED CURRENT STATE — IDs

- Dominant `INT IDENTITY` masters; invoices composite `(invID, invType)`; messaging/AI/movements often `BIGINT`; TS `number`.

### 7.2 Material SaaS / global-scope hazards (beyond missing TenantId)

| Hazard | Evidence | Tenant scoping later? |
|--------|----------|----------------------|
| Global `UX_Bookings_BookingCode` | `add-booking-code-column.sql`; preserved in branch ownership migration | **Yes** — codes collide across tenants if DB shared |
| Queue ticket uniqueness | Originally `(TicketCode, QueueDate)`; branch migration → `(BranchID, QueueDate, TicketCode)` | Branch-scoped today; still needs **TenantId** if multi-tenant DB |
| Public booking idempotency keys | `TblPublicBooking*Request` UNIQUE on `IdempotencyKey` (global in table) | **Yes** |
| Inventory/campaign idempotency | `UQ_TblInventoryMovement_Idempotency`, WhatsApp campaign recipient keys | **Yes** |
| Emp applock resources | `booking:emp:{empId}:{start}:{end}` — EmpID-global, no tenant prefix | **Yes** (or tenant-isolated DB) |
| Process cache keys | `__pos_public_booking_*`, settings caches | **Yes** if multi-tenant process |
| Session signing | `SESSION_SECRET`; **dev fallback** `hawai-pos-secret-key-change-in-prod`; production requires env | Per-deployment secret; multi-tenant SaaS needs tenant-safe auth design |
| Message/conversation IDs | BIGINT identities; bot conversation uniqueness indexes | **Yes** if shared DB |
| Webhook correlation | WhatsApp outbound correlation / bearer tokens | **Yes** / per-tenant credentials |
| Background job locks | Operational day UPDLOCKs; applocks; nightly close by workDate | **Yes** for multi-tenant workers |
| Filesystem / local print / Cloudinary | Device-local print; shared CDN config patterns | Deployment/tenant isolation design needed |
| `SalonID` on Cut Club | Nullable; historically unused | **Do not** treat as TenantId |

### 7.3 INFERRED FUTURE DESIGN

- Introduce `TenantId` (or equivalent namespace) on masters and branch-owned roots; keep legacy ID maps; avoid assuming INT reuse across tenants.

---

## 8. Cross-domain SQL, triggers, and transaction boundaries

### 8.1 Direct cross-domain access

| Pattern | Evidence | Severity |
|---------|----------|----------|
| Flow-board multi-domain SQL | `loadFlowBoardForBranch.ts` | Critical |
| Nightly close orchestration | HEAD `nightly-close.service.ts` | Critical |
| Ledger dual-write | `employeeLedgerDualWrite.ts` | Critical |
| **DB trigger sale→CashMove** | `InsCashMoveSales` | Critical |
| Booking locks + HR schedules | `publicBookingCreateLocks`, availability | High |
| Booking convert → invoice | convert route TX | High (commercial path) |
| Financial write gate | `operationalGates` + ops locks | High |
| WhatsApp fan-in | booking/HR/POS | High |

### 8.2 Important transaction hubs

- Public booking create/cancel/reschedule — SERIALIZABLE + applock
- POS sale — SERIALIZABLE + **trigger CashMove** + split + target enqueue
- Booking convert — single TX invoice(`خدمة`)+booking complete
- Purchases — SERIALIZABLE + inventory post
- Employee ledger funding / dual-write / tips
- Operations day/shift mutation locks (`businessDayLock` / mutation TX)
- Sensitive action audit; mystery box; target recalc enqueue

See [DEPENDENCY-GRAPH](./DRVO-001-DEPENDENCY-GRAPH.md) for HARD / SOFT / ADAPTER-SAFE edge classes.

---

## 9. Production / runtime coupling assessment

| Domain | Reasonably isolated today? | Notes |
|--------|----------------------------|-------|
| Messaging module | Partially | Best hexagonal shape; fan-in callers |
| Booking scheduling engines | Partially | Strong structure; shared masters |
| Booking conversion | No | Crosses POS/day/shift in one TX |
| Branch package | Partially | Clear helpers |
| Attendance module | Partially advancing | Substantive commands; still `src/lib/hr` |
| Operations module | Partially advancing | Real lock/mutation infra; still shared DB |
| Payroll/ledger | No | Dual-write + nightly |
| Ops floor UI | No | Composition query |
| CashMove (+ trigger) | No | Hub + DB side effects |
| Reports | Mixed | Reads + override/config commands |
| CUT Club | Partially | Separate store; SalonID dead weight |

---

## 10. Provisional migration actions (rolled up)

| Area | Provisional action |
|------|--------------------|
| Tenant | REPLACE (introduce) |
| Auth/branch/permissions | ADAPT |
| Customers / workforce / catalog | EXTRACT (shared) |
| Booking **scheduling** | EXTRACT (**first business-app candidate**) |
| Booking **conversion** | Leave on legacy only with **explicit convert contract** (§19.1); not bare dual-call |
| Queue / POS / treasury / attendance / payroll / inventory | EXTRACT (ordered by coupling) |
| Messaging app | EXTRACT (not hard gate before Booking scheduling) |
| Event/outbox/webhook infra | ADAPT prerequisite |
| Reports | Split read-model ADAPT vs config/command ADAPT |
| Approvals / inactive calendar sync | RETIRE |
| Day/Shift ownership | **Undecided** |

---

## 11. Uncertain / NEEDS RUNTIME VERIFICATION

- Production `InsCashMoveSales` enabled + matches migration body (vs legacy scalar).
- Treasury/reporting treatment of booking-convert `خدمة` invoices (no sale-trigger CashMove).
- Full void/delete/recon parity for triggered CashMove rows.
- `TblEmpPayrollTxn` / alternate `TblServices` / `sync.*` on live DBs.
- Cut Club `SalonID` null rates.
- Payment method column naming on live recon.
- Dirty working-tree payroll/session changes (**OUT-OF-BASELINE**).
- WhatsApp bot topology beyond env defaults.
- Budget table naming per environment.

---

## 12. Contradiction notes (internal)

- Ownership registry `BRANCH_OWNED_ROOT` for day/shift ≠ Platform Core decision.
- `SalonID` ≠ TenantId.
- Messaging outbox infra ≠ Messaging app extract.
- Attendance/operations are **not** uniformly “thin facades.”
- Booking scheduling extract ≠ booking→POS conversion extract.
- Reports ≠ purely read-only.

---

## 13. Decisions handed to DRVO-002 (unresolved)

DRVO-001 does **not** decide these; DRVO-002 must:

1. Definition of **“extraction” level** per domain (see §14 LEVEL 1–5)  
2. Tenant isolation topology / namespace rules (shared DB vs DB-per-tenant, uniqueness, applocks, caches, jobs, auth)  
3. Staff users vs customer identities vs platform administrators  
4. Scheduling/conflict **write authority**  
5. Booking **conversion** ownership and transaction semantics  
6. Financial **posting / reversal / reconciliation / retry** contracts (trigger replacement; update≠create CashMove asymmetry; unused `reverseSplitPaymentTransfers`)  
7. Day / Shift ownership (candidates in §5) — **still undecided**  
8. CashMove ownership (Platform money vs Treasury) — **still undecided**  
9. Master data vs snapshots / projections / balances  
10. Shared domain vs app vs industry-policy boundaries  
11. Durable job recovery / messaging intent (outbox vs booking `after()` notify)  
12. Config storage (DB vs env vs filesystem JSON vs process memory)  
13. Cutover + rollback gates  
14. Authorization adapter for multi-tenant ID collision safety  

---

## 14. Extraction LEVEL definitions (terminology — not decisions)

| Level | Name | Meaning | Casher today (typical) |
|-------|------|---------|------------------------|
| **LEVEL 1** | Module boundary | Same deployment, same DB; clearer packages/APIs | Partial (`src/modules/*` uneven) |
| **LEVEL 2** | Application/service boundary | Separate runtime; may still share DB | Messaging workers already separate Node processes |
| **LEVEL 3** | Data ownership boundary | App owns its tables/contracts; others use APIs/events | Mostly **not** achieved (shared SQL) |
| **LEVEL 4** | Physical database boundary | Separate database/storage | **Not** achieved; single SQL Server DB |
| **LEVEL 5** | Commercial product packaging | Installable DRVO App / entitlement | **Not** present (no subscriptions) |

**DRVO-001 does not assign a target level per domain.**  
“EXTRACT” in DOMAIN-MAP / MIGRATION-ORDER means **provisional intent to separate capability**, not “ready for LEVEL 4.”  
Evidence does **not** support claiming Booking can already move to an **independent database** (LEVEL 4): global emp applocks, global BookingCode, global create idempotency keys, shared Client/Emp/Pro, and process caches assume one DB/process model.

---

## 15. Financial Consistency Boundary Matrix (VERIFIED CURRENT STATE)

Consistency mechanism tags: **APP TX** | **DB TRIGGER** | **SHARED TABLE** | **POST-COMMIT EVENT** | **MANUAL RECONCILIATION**

| Flow | Initiator | Isolation | Tables written | Triggers | Post-commit | Rollback | Reverse/delete | Idempotency | Day/Shift | Branch | Mechanisms | Must stay atomic together (current) |
|------|-----------|-----------|----------------|----------|-------------|----------|----------------|-------------|-----------|--------|------------|-------------------------------------|
| POS sale create | `POST /api/sales` | SERIALIZABLE | Head, Detail, Payment; inventory; target enqueue; CashMove via trigger; optional split pairs | `InsCashMoveSales` | Loyalty SP (best-effort); WA; target process | Full TX rollback | N/A | Payment/split existence guards; `allocateInvID` | OPEN day+shift preferred | Operational branch | APP TX + DB TRIGGER + SHARED TABLE + POST-COMMIT | Head+detail+payment+stock+trigger CashMove+split+target enqueue |
| Sale update | `PUT /api/sales/[id]` + audited action | SERIALIZABLE | Rewrite detail/payment; **manual** CashMove rewrite; loyalty delete/re-earn; stock reverse/reapply | Trigger **not** on UPDATE | Loyalty re-earn; targets | Audit TX rollback | Soft mutate | Audited mutate | From invoice ownership | Must own invoice | APP TX + SHARED TABLE + POST-COMMIT | Update path ≠ create trigger path |
| Sale delete | `DELETE /api/sales/[id]` | SERIALIZABLE | Delete CashMove/loyalty/detail/payment/head; reverse stock | N/A | Target process | Audit TX rollback | Hard DELETE (loyalty rows deleted, not necessarily SP reverse) | Audited | Ownership load | Must own invoice | APP TX + SHARED TABLE | **Gap:** `reverseSplitPaymentTransfers` **defined but unused** — split orphan risk |
| InsCashMoveSales | AFTER INSERT head | Caller TX | `TblCashMove` | Self | None | With caller | Via app delete CashMove by invID | Set-based `inserted` | Inherited | Inherited | DB TRIGGER → SHARED TABLE | With matching head INSERT |
| Split redistribute | `redistributeFromClearing` | Caller TX | Paired CashMove (own invIDs) | None | None | With caller | Helper unused on delete | Notes/ExpINID guard on create | Stamped | Stamped | APP TX + SHARED TABLE | With sale create when split |
| Tips | `POST /api/pos/tips` | SERIALIZABLE | CashMove + ledger tip | None | WA | Rollback both | No tip reverse API found | Dual-write flag required | OPEN day/shift | Operational | APP TX dual-write + POST-COMMIT | CashMove + ledger tip |
| Expense | `POST /api/expenses` | SERIALIZABLE | CashMove out; optional advance ledger | None | WA | Rollback | Edit paths elsewhere | Soft dup same day/cat/amount/shift | OPEN day+shift | Operational | APP TX + optional dual-write + POST-COMMIT | Cash + optional ledger |
| Income | `POST /api/incomes` | SERIALIZABLE | CashMove in; funding ledger | None | WA | Rollback | Bulk re-sync | Weak | OPEN day+shift | Operational | APP TX + dual-write + POST-COMMIT | Cash + funding ledger |
| Deduction | `POST /api/deductions` | SERIALIZABLE | Paired CashMove + advance ledger | None | WA | Rollback | No dedicated reverse in route | Weak | OPEN day+shift | Operational + emp eligibility | APP TX | Paired cash + ledger |
| Treasury transfer | `POST /api/treasury/transfer` audited | SERIALIZABLE | Paired CashMove | None | Audit log | Rollback | No auto reverse | Audit required | Current: open shift; historical: day-only | Gated branch | APP TX + SHARED TABLE | Transfer pair |
| Day recon close | `POST /api/treasury/reconciliation` | SERIALIZABLE | `TblTreasuryCloseRecon`; close `TblNewDay` | None | None | Rollback | Block if already closed | Guard | Closes day | Operator branch | APP TX + MANUAL RECON | Recon rows + day status |
| Shift recon close | `POST /api/treasury/shift-reconciliation` | SERIALIZABLE | Recon + close `TblShiftMove` | None | None | Rollback | Block if exists | Guard | Closes shift only | Shift user/branch | APP TX + MANUAL RECON | Recon + shift status |
| Payroll gen + ledger | nightly / generate APIs | begin (default isolation) | `TblEmpDailyPayroll`; ledger upserts | None | Heal sync | Rollback | Void if wage→0 | Upsert by ref; skip if posted/CLOSED | WorkDate + close flags | Per branch | APP TX + POST-COMMIT heal | Payroll row + ledger when dual-write on |
| Payroll post-to-cash | `POST /api/payroll/daily/post-to-cash` | begin default; may be flag-disabled | Paired CashMove; payroll CashMoveIDs | None | None | Rollback | Repair path | Dup guards | Historical day; often no ShiftMoveID | Branch access | APP TX + SHARED TABLE; legacy path | Payroll status + cash pair when enabled |
| Purchase + stock | `POST /api/purchases` | SERIALIZABLE | Purchase head/detail; inventory on post | None | None | Rollback | Stock reverse elsewhere | Movement IdempotencyKey | Day stamped; shift optional | Session branch | APP TX + IDEMPOTENCY KEY | Purchase post + stock movement |
| Loyalty earn | sales post-commit SP | Outside sale TX | Loyalty ledger/balance | None | Is the post-commit | N/A for sale | SP reverse API; delete hard-deletes rows | SP “already reversed” | No day/shift gate | Client-global | POST-COMMIT EVENT | **Not** atomic with sale |
| Loyalty reverse | `POST /api/loyalty/reverse-sale` | READ_COMMITTED | Loyalty tables via SP | None | None | SP TX | Self | SP | No | Global client | APP TX + SP | Loyalty only |
| Booking convert | `POST /api/bookings/[id]/convert` | begin default | Head+detail `invType=خدمة`; booking completed | **No** InsCashMoveSales match | None | Rollback | 409 if ConvertedInv set | Pre-check; invID alloc outside TX (race) | OPEN day+shift | Booking branch match | APP TX only | Head+detail+booking status — **no** CashMove/payment/loyalty |

**Extraction note (INFERRED):** Crossing a LEVEL 4 DB boundary without replacing **DB TRIGGER** + **SHARED TABLE** CashMove writers breaks POS/treasury consistency. Sale **update/delete** already diverge from create (manual CashMove; unused split reverse). Loyalty earn must not be assumed atomic with invoice.

---

## 16. Authorization Boundary Matrix (VERIFIED CURRENT STATE)

### 16.1 Layer distinctions

| Layer | Mechanism | Evidence |
|-------|-----------|----------|
| Authentication | HMAC cookie `pos_session` (`SESSION_SECRET`) | `session.ts` |
| Platform permission / roles | `TblRoles` / `TblUserRoles`; `super_admin`; partner-only | `permissions-server.ts`, `api-auth.ts` |
| Page permission | `TblSystemPages` + `TblPageRoleAccess` | `requirePageAccess` |
| Branch access | `TblUserBranchAccess` (operate/view/switch/default + validity) | `branch/access.ts` |
| Operational branch access | Session ActiveBranch + `canOperate` | `branch/context.ts` |
| Open-shift / open-day | `resolveBranchDayAndShiftForWrite` (SHIFT ignores view cookie) | `operationalGates.ts` |
| Sensitive-action authorization | `executeAuditedAction` + reason + audit log | `sensitiveActionAudit.ts` |
| Internal service authentication | Bearer `CRON_SECRET` / WhatsApp webhook token | `proxyPublicRoutes.ts`, messaging inbox auth |
| Public API authorization | Anonymous allowlist + rate limit + plan/access HMAC tokens | `proxy.ts`, public booking tokens |

**Composition (staff mutations):** proxy cookie presence → handler HMAC verify → optional page/role → branch operate → financial day/shift gate → optional audited action. Proxy does **not** verify HMAC (handlers authoritative).

### 16.2 Domain enforcement pattern

| Domain | Central helpers? | Duplicated in routes? | Cookie-dependent | BranchID-dependent | Open-shift dependent | Reusable boundary gap |
|--------|------------------|----------------------|------------------|--------------------|----------------------|------------------------|
| Booking public | Route gate + tokens | Light | No (anonymous) | Yes (resolved branch) | No | OK for public; tenant collision on numeric IDs later |
| Booking staff (non-convert) | Often raw `getSession` | Yes | Yes | Variable / weaker | No | Weaker than POS pattern |
| Booking convert | Financial gate | Thin | Yes | Yes | Yes | Aligned with financial writes |
| POS / sales | Day/shift gate; tips page access | Sales often `getSession` not full `authenticate` | Yes | Operational branch | Prefer yes | Cookie+branch+shift tightly coupled |
| Treasury | Mix authenticate/session + gates | Per-route | Yes | Yes | Transfer current-day yes | Same |
| Payroll | Page `/admin/hr` + operate; auto = system job | Consistent | Manual yes | Yes (body BranchID rejected) | No (work-date/close) | Relatively clear |
| Messaging | Webhook/cron tokens | Thin | Optional | Weak / conversation | No | Separate from staff RBAC |
| Operations | Page `/operations` + operate | Per-route | Yes | Yes | Day locks on mutations | Composition UI auth ≠ data isolation |

**SaaS risk (INFERRED):** Tenant A user must never authorize Tenant B resources if numeric `UserID`/`BranchID`/`ClientID` collide. Today auth is **single-DB + BranchID**, not TenantId. Cookie session binds one ActiveBranch at a time — insufficient alone for multi-tenant shared runtime without tenant claim + server-side resource tenancy checks.

### 16.3 Public customer ownership boundary (VERIFIED CURRENT STATE)

**Public customer ownership is a separate authorization concern from staff RBAC / branch ACL.** Staff layers (§16.1–16.2) do **not** apply to anonymous public booking/client routes.

| Flow | Caller identification | Ownership proof | Proof type | Replay / enumeration risk | Branch vs Tenant | Status |
|------|----------------------|-----------------|------------|---------------------------|------------------|--------|
| Public booking **create** | Anonymous (+ optional `planToken` HMAC fingerprint); rate limit / request id | None for “customer account”; phone upserts/links `TblClient` | **No customer auth** — possession of phone number at create time | Idempotency key replay; phone not OTP-verified | Branch from `branchCode`; no TenantId | CURRENT LEGACY |
| Lookup by **code only** | Anonymous | None → response **minimal** DTO if public-origin booking exists | **No ownership** (existence leak of code) | BookingCode enumeration | Branch on row | CURRENT LEGACY |
| Lookup **full** detail | Phone and/or `bookingAccessToken` | Phone must match stored customer phone **or** HMAC token (code + phoneDigest, `SESSION_SECRET`, ~30d TTL) | **Possession-based** (phone knowledge) and/or **signed possession token** — **not** OTP/session login | Token theft ≈ owner until expiry; phone guess + code | Token has no TenantId/BranchId claims | CURRENT LEGACY |
| **Upcoming** list | Phone required | SQL `TblClient.Mobile = @phone` | Possession of phone string | Phone enumeration of appointments | Cross-branch by phone in one DB | CURRENT LEGACY |
| **Cancel** | Phone and/or accessToken + BookingCode; idempotency key | Same ownership assert as reader before cancel TX | Possession / token | Idempotent replay OK; wrong phone → not found/unauthorized | Branch on booking | CURRENT LEGACY |
| **Reschedule** | Phone + BookingCode required (accessToken path not used in `loadOwnedBookingHead`) | Phone must match `TblClient.Mobile` for booking’s client | Possession of phone | Idempotency table + fingerprint | Desired branch via branchCode | CURRENT LEGACY |
| Public **client** loyalty/store APIs | Often `clientId` query/body | Comments: **TODO replace with authenticated session / OTP**; weak/no real customer auth | **No meaningful ownership proof** beyond knowing numeric ClientID | Cross-customer if ClientID guessed | Global client | CURRENT LEGACY + FUTURE DRVO REQUIREMENT (real customer auth) |

Notes:

- `bookingAccessToken` is explicitly **“lookup/cancel authorization only — not a reservation”** (`publicBookingAccessToken.ts`).
- There is **no OTP**, **no customer session cookie**, and **no login** on public booking ownership paths audited here.
- DRVO multi-tenant must not treat phone match alone as Tenant-safe identity without TenantId namespace + stronger customer auth (**FUTURE DRVO REQUIREMENT**).

---

## 17. Booking Concurrency Boundary Matrix (VERIFIED CURRENT STATE)

Enforcement classes used below: **hard DB-enforced** | **transaction-enforced** | **application lock (sp_getapplock)** | **unique-constraint** | **advisory/cache only** | **best-effort** | **post-commit** | **recovery/reconciliation dependent** | **feature-flagged (default off)**.

| Mechanism | Resource / key | Primary enforcement | Notes / failure modes | Tenant namespace later? |
|-----------|----------------|---------------------|----------------------|-------------------------|
| Emp interval applock | booking:emp:{empId}:{startMs}:{endMs} | application lock + transaction-owned | Timeout fails create / cancel / reschedule paths | Yes |
| Any-barber applock | booking:any:{branchId}:… | application lock + TX | Timeout | Branch+tenant |
| Cancel applock | booking:cancel:{code} | application lock + TX | Timeout | Tenant+code |
| Schedule staff applock | operations-schedule:{empId}:{date} | application lock + TX | Used by reschedule move | Yes |
| Busy-interval assert (incl. queue conflicts) | SQL re-read after applock in TX | transaction-enforced | Final correctness guard; queue intervals included | Same DB |
| TblBookingSlotClaim UNIQUE (EmpID, AbsoluteSlotStartUtc) | HOLD / BOOKING rows | unique-constraint **when written** | Writers gated by BOOKING_V2_SLOT_CLAIMS_MODE; default **off** → enforce helpers **no-op** | Yes |
| HOLD claims | HoldToken + TTL | unique + TX if **enforce**; **shadow** = best-effort / post-commit telemetry | Expired HOLDs deletable; not authority when mode off | Yes |
| BOOKING claims | bookingId-linked | unique + TX if **enforce** | HOLD→BOOKING convert in place when enforce | Yes |
| Claim release | txReleaseBookingClaims / delete by booking | transaction-enforced **only if enforce on**; else no-op | Cancel path releases claims inside TX when enforce | — |
| Claim replacement (reschedule) | txAtomicRescheduleClaims | transaction-enforced **only if enforce on** | Insert NEW first, then delete OLD-only; never release-first | — |
| Create idempotency | UNIQUE IdempotencyKey alone | unique-constraint + autonomous claim row | Global key scope (no TenantId) | **Yes — critical** |
| Cancel / reschedule idempotency | Request tables UNIQUE keys | unique-constraint | Replay returns stored body; fingerprint conflict | Yes |
| BookingCode uniqueness | UX_Bookings_BookingCode | unique-constraint (global) | Insert fails on duplicate | **Yes** |
| Cancellation concurrency | cancel applock + SERIALIZABLE TX + busy release | application lock + transaction-enforced | Claim release only if enforce on | Tenant+code |
| Occupancy / hot cache | projections, __pos_* | advisory/cache only | Explicitly not correctness authority | Process bleed |
| Cache invalidation after move | post-commit callers | best-effort / post-commit | Must not be treated as atomic with booking row | Process |
| Public rate limit | in-memory maps | advisory/process | Best-effort per process | Per-tenant process |
| Stale HOLD cleanup | deleteExpiredHolds* | recovery/reconciliation dependent (+ in-TX on enforce paths) | Background/runtime cadence **NEEDS RUNTIME VERIFICATION** | Yes |
| Shadow / off claim modes | feature flag | feature-flagged (default **off**) | Do **not** imply claim atomicity when off or shadow | — |

**Do not imply slot-claim atomicity when mode is off (default) or shadow.** Legacy correctness then rests on **applock + busy-interval assert** inside a SERIALIZABLE TX. Production claims mode = **NEEDS RUNTIME VERIFICATION**.

**Independent DB (LEVEL 4) for Booking scheduling:** **not** supported by current evidence without redesign of applocks, BookingCode, idempotency keys, shared Emp/Client masters, and caches.

### 17.1 Reschedule recovery semantics (VERIFIED from rescheduleBookingMove + claim ops)

| Step | Behavior | Enforcement class |
|------|----------|-------------------|
| OLD SLOT | Prior booking absolute interval (assigned emp + start/end) | — |
| NEW SLOT | Proposed start/end after validate | — |
| Pre-check | validateBookingMove **outside** write TX (may be stale by commit time) | best-effort / advisory relative to write TX |
| CLAIM / LOCK ACQUIRE ORDER | SERIALIZABLE begin → acquireScheduleLocksSorted (applocks on old+new emp) → service-support re-check → assertEmployeeIntervalAvailable → enforceAtomicRescheduleInTx (**no-op unless claims enforce**) | application lock + transaction-enforced (+ feature-flagged claims) |
| CLAIM ACQUIRE (NEW then OLD release) | When enforce: txAtomicRescheduleClaims inserts NEW slots first, then deletes OLD-only; **never release-first** | transaction-enforced if enforce; else no-op |
| BOOKING UPDATE | UPDATE Bookings after claim dual-guard block, still inside same TX | transaction-enforced |
| CLAIM RELEASE ORDER | After NEW secured: delete OLD-only slots (intersection kept); cancel path uses full txReleaseBookingClaims | transaction-enforced if enforce |
| TRANSACTION BOUNDARY | Single SQL TX: locks + assert + optional claims + row update; WhatsApp **outside** after commit | transaction-enforced core; post-commit notify |
| FAILURE BEFORE COMMIT | Rollback — prior booking row + prior claims remain | hard DB / TX rollback |
| FAILURE AFTER COMMIT | Booking already moved; WhatsApp / cache invalidation may fail independently | post-commit / best-effort |
| Process crash mid-TX | DB aborts uncommitted work — no partial booking commit | hard DB-enforced |
| Crash after commit before idempotency success body stored | Move may commit without durable success payload for public idempotency replay | recovery/reconciliation dependent — **NEEDS RUNTIME VERIFICATION** |
| Stale HOLDs on target | Cleared for target slots inside atomic reschedule when enforce on | transaction-enforced if enforce; else N/A |
| Idempotency / retry | Public: reschedule request table claimed **before** move; success stores JSON; failed marked — auto-retry of failed rows **NEEDS RUNTIME VERIFICATION** | unique-constraint + app flow |
| Cache invalidation | Post-commit / best-effort — **advisory only** | advisory/cache only |
| Queue conflicts | Included in busy-interval assert inside TX (not a separate claim table) | transaction-enforced |

**Public reschedule ownership:** phone + BookingCode only (loadOwnedBookingHead); accessToken path not used for ownership on this flow (see §16.3).

## 18. General concurrency / locking inventory (material)

| Mechanism | Examples | Class | Tenant namespace risk |
|-----------|----------|-------|----------------------|
| SERIALIZABLE app TX | Sales, expenses, incomes, deductions, purchases, booking create/cancel, sensitive audit | DATABASE TRANSACTION | Per-DB |
| UPDLOCK/HOLDLOCK/READPAST | Business day/shift (`businessDayLock`), queue numbering, outbox/inbox/AI claim, inventory balances, target recalc | DATABASE LOCK | Per-DB; claim often **global drain** |
| sp_getapplock | Booking locks; `SqlAllocator`; attendance active session; `auto_absence_scan` | DATABASE LOCK | Resource strings lack TenantId |
| Unique as concurrency | BookingCode; queue branch+date+code; outbox idempotency; inventory IdempotencyKey; slot claims | UNIQUE CONSTRAINT | Many keys global |
| Background claim | Outbox/inbox/AI UPDLOCK READPAST; target recalc queue | BACKGROUND-JOB CLAIM | Global workers |
| Process caches / rate maps | `__pos_*` | PROCESS LOCK | Multi-tenant process bleed |
| Soft guards | Payroll skip if posted/CLOSED; nightly no lease | (soft) | Concurrent cron+local double-fire |

Extraction that bypasses these (e.g. app writes without day UPDLOCK, or booking without emp applock) can create double-books, double CashMove, or overlapping barber slots.

---

## 19. Booking extraction boundary (A/B/C/D) — refined

| Bundle | Contents | Edge class vs “Booking scheduling first” | Feasible extract level (evidence) |
|--------|----------|------------------------------------------|-----------------------------------|
| **A. Scheduling domain** | Availability, holds, create, cancel, reschedule, occupancy, slot claims | Target candidate | LEVEL 1–2 with adapters; **not** LEVEL 4 without redesign |
| **B. Commercial conversion** | Convert→invoice `خدمة`, completed, ConvertedInv | **HARD BLOCKER** to include in A extract; leaving convert on legacy Casher is **operationally feasible** but is **not** a consistency-preserving “dual-call” by itself | If Booking ownership moves while convert stays in Casher, DRVO-002 must define an explicit contract (below) — not generic HTTP calls |
| **C. Composition** | `/operations` flow-board, queue linkage, workforce presence | **SOFT PREREQUISITE** (UX read-model/BFF) | Adapter read OK short-term |
| **D. Notifications** | WhatsApp post-commit / `TblBookingNotifyRequest` | **ADAPTER-SAFE** | Weaker durability than messaging outbox |

### What “Booking first” can mean (provisional)

- **Can mean:** LEVEL 1/2 separation of **scheduling** APIs/services while sharing DB; conflict API or co-located locks; convert left on legacy adapter; ops board via read-model; notify via adapter/outbox.  
- **Cannot mean (without more work):** LEVEL 4 independent Booking database, or moving convert+CashMove with scheduling.

Dependency classes (scheduling-first):

| Dependency | Class |
|------------|-------|
| Customer / Emp / Catalog identity | SOFT PREREQUISITE |
| Emp global conflict locking | HARD BLOCKER (correctness) unless shared lock service / same DB |
| Availability reads | SOFT / ADAPTER-SAFE |
| Flow-board composition | SOFT (UX) |
| WhatsApp notify | ADAPTER-SAFE |
| Day/Shift scheduling reads | ADAPTER-SAFE / SOFT |
| Day/Shift financial (convert) | HARD for B; N/A for pure A |
| Booking→POS conversion | HARD to extract with A; leaving on legacy needs **explicit cross-system contract** (not bare dual-call) |
| CashMove / trigger | HARD for POS; N/A for pure A |
| Loyalty | ADAPTER-SAFE for A |
| Auth cookie/branch | SOFT for staff routes; public token/phone possession path separate (§16.3) |
| Public customer ownership | Separate from staff RBAC — possession/token today; stronger auth = FUTURE DRVO REQUIREMENT |

### 19.1 Booking conversion cross-system contract (deferred to DRVO-002)

Today convert is **one Casher SQL TX**: invoice head(`خدمة`)+detail + booking `completed`/`ConvertedInv*` (no sale-trigger CashMove).

If Booking **data ownership** moves while convert remains in Casher, DRVO-002 must decide an explicit contract covering at least:

1. Who creates the invoice (Casher POS vs Booking callback)  
2. How booking completion / `ConvertedInv` linkage is written and by whom  
3. Whether invoice + booking completion remain **one shared transaction**, a **saga with compensation**, or another consistency model  
4. Failure, retry, and idempotency (duplicate convert, partial invoice without completed booking, reverse)  
5. Interaction with Day/Shift financial gates and (future) posting contracts  

**Do not treat “call convert API twice / dual-call” as inherently adapter-safe.** Current behavior requires shared transactional coupling; splitting without a designed protocol is a consistency risk. Protocol design is **out of scope for DRVO-001**.

---

## 20. Background job / recovery boundary

| Job | Entrypoint | Claim | Retry / idempotency | Partial failure | Branch scope | Durable state | Tenant / ops risk |
|-----|------------|-------|---------------------|-----------------|--------------|---------------|-------------------|
| Nightly close | `/api/admin/hr/nightly-close`; scripts; Vercel cron | **No lease** | Skip posted/CLOSED; re-runnable pieces | Per-branch continue | Active branches | `TblAutoGenLog` + downstream | Double-fire cron+local **NEEDS RUNTIME VERIFICATION** |
| Message outbox | `messaging-outbox-worker` script | UPDLOCK READPAST → sending | IdempotencyKey; backoff MaxAttempts | Per-row | Claim **global** | `TblMessageOutbox` | Multi-worker OK; wrong env → wrong gateway |
| Message inbox | inbox-worker + WA webhook | UPDLOCK READPAST | ProviderMessage unique; stale requeue | Per-row | Global | `TblMessageInbox` | **NEEDS RUNTIME VERIFICATION** always-on |
| AI worker | ai-worker script | UPDLOCK on `TblBotAiTurn` | MaxRetries | Per-turn | Global | `TblBotAiTurn` | Needs GEMINI_API_KEY |
| Payroll auto-gen | API + optional schtasks; also nightly | Soft skip posted | Per branch | Per-branch | Active branches | Payroll + AutoGenLog | TZ for “before 6” **NEEDS RUNTIME VERIFICATION** |
| Target recalc | Admin/CLI process; post-commit try | UPDLOCK READPAST queue | Versioned finalize | Per request | Per request BranchID | `TblEmpTargetRecalcRequest` | Queue can stall without drain |
| Booking WA notify | `after()` post-commit | CAS notify row | Unique wa:event:booking:version; **no reclaim worker** | Booking OK if WA fails | Booking-scoped | `TblBookingNotifyRequest` | Crash after `sending` orphan risk |
| Business-day reconcile | internal API; hourly cron | Peek then mutate | Re-runnable | Per branch | Active branches | Day tables | Branch TZ config |
| Auto-absence | admin API; Vercel cron | `sp_getapplock auto_absence_scan` | Threshold settings | Scan | Optional branch | Attendance | Overlap nightly |

---

## 21. Configuration storage (multi-tenant runtime hazards)

| Kind | Examples | Problem if many tenants share one runtime |
|------|----------|-------------------------------------------|
| Env secrets | `SESSION_SECRET`, `CRON_SECRET`, WhatsApp, Gemini, Cloudinary, DB | One secret space; HEAD `.env.example` incomplete vs code |
| Env feature flags | `BOOKING_V2_*`, `EMP_LEDGER_*`, handoff/canary phones | Global process flags bleed |
| DB settings | `QueueBookingSettings`, `TblSettingValues`, branch rows, salary history | OK if TenantId added; today Branch-only |
| Filesystem JSON | `data/partners-employee-overrides.json` | **Not tenant-safe** on shared disk |
| TS constants | Print `127.0.0.1:7788`; `PUBLIC_BOOKING_OPS_CONTROLLABLE_BRANCH='GLEEM'` | Hardcoded single-salon assumptions |
| Process memory | `__pos_*` caches, rate maps, hot availability | Cache bleed across tenants |
| Local machine | Print agent, WhatsApp bot default `127.0.0.1:3001` | Device/deployment local |
| Session | Dev fallback secret string | Production requires env; multi-tenant needs tenant-safe auth design |

---

## 22. Contradiction notes (updated)

- Day/Shift ownership **undecided**; CashMove ownership **undecided**.  
- Messaging **infra** (outbox tables/workers) ≠ Messaging **app**.  
- Booking **scheduling** ≠ **conversion** ≠ **composition** ≠ **notifications**.  
- EXTRACT ≠ LEVEL 4 DB split.  
- Dual-call / leave-on-legacy convert is **not** inherently ADAPTER-SAFE without an explicit cross-system contract (§19.1).  
- Public customer ownership ≠ staff RBAC (§16.3).  
- Slot-claim uniqueness is **not** correctness authority while claims mode is off/shadow (§17).  
- Reports include **commands** (overrides), not read-only only.  
- Sale create uses **trigger** CashMove; sale update uses **manual** CashMove — asymmetry is VERIFIED.

---

## 23. Ready for DRVO-002?

**YES — as an architecture decision input**, provided DRVO-002 treats §§13–21 as mandatory open questions and does not skip LEVEL definitions / financial / auth / concurrency matrices.

Booking **scheduling** remains a valid first major business-app **candidate** at LEVEL 1–2 with adapters — **not** an evidenced LEVEL 4 move.
