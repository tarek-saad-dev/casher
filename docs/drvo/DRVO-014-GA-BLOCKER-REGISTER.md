# DRVO-014 — DRVOERP V1 GA Blocker Register

Issue: #62 · Parent epic: #60 · Companion: [`DRVO-014-GAP-AUDIT.md`](./DRVO-014-GAP-AUDIT.md)

This is the **authoritative** list of what stands between the current code and DRVOERP V1 GA.
Every finding has exactly one owner task in DRVO-013..DRVO-020. A finding is closed only by the owner
task's PR plus the staging/E2E proof listed in the gap audit (§6), never by unit tests alone.

## Baseline

| Ref | Commit | State |
| --- | --- | --- |
| `origin/main` | `2401620` | Audited code. All evidence paths/lines refer to this commit unless marked `[013]`. |
| `drvo-012-commercial-plans-tenant-apps` (PR #63) | `2c056a3` | Draft, unmerged. Migration 9 not applied to staging/production. |
| `drvo-013-authoritative-tenant-context` | `db87e66` | Stacked on DRVO-012, unmerged, no PR yet. Runtime staging proof **pending**. |

`[013]` = behaviour on the DRVO-013 branch. A finding marked "fixed on `[013]`" stays **open** until that
branch (and the DRVO-012 base under it) is merged and its staging gate passes (GA-007).

## Product decisions applied

- DRVOERP is a cross-industry Business Operating Platform; Salon is one Industry Pack.
- Messaging / WhatsApp / AI Receptionist are **cross-industry V1 capabilities** → their tenancy gaps are launch-blocking.
- Loyalty may stay **disabled for generic tenants** in V1 → loyalty tenancy is DEFERRED, but the *gate* that keeps it disabled is launch-blocking (GA-006).
- Booking is an **optional installable app** → public-booking gaps block GA only where they leak data from tenants that never enabled public booking (GA-050).
- Billing provider may be post-V1 → DEFERRED (operator-managed subscriptions via DRVO-012 are the V1 path).
- Marketing website is a separate repo/deploy → out of scope.

## Severity scale

- **CRITICAL** — cross-tenant data exposure/corruption, unauthenticated access to business data, or a new tenant cannot operate at all.
- **HIGH** — GA definition (#60) not met, or security/ops gap unacceptable for a paid multi-tenant product.
- **MEDIUM** — must be tracked; does not block GA on its own.
- **DEFERRED** — consciously post-V1 per product decision.

## Owner tasks

| Owner | Scope |
| --- | --- |
| DRVO-013 | Runtime tenant isolation: tenant context, route fail-closed, session/membership, platform operator boundary, jobs/cron tenant context, app entitlement gating |
| DRVO-015 | Master-data tenancy: customers, catalog (services/products), payment methods, finance categories, settings, inventory/purchasing identity |
| DRVO-016 | HR / attendance / payroll / employee ledger / partners de-CUT and tenancy |
| DRVO-017 | Onboarding, platform-operator UI, tenant admin shell, RBAC, branding, tenant settings |
| DRVO-018 | Messaging / WhatsApp / AI Receptionist tenancy |
| DRVO-019 | Optional public booking app |
| DRVO-020 | GA hardening: security, CI/deploy, migrations, backups, observability, two-tenant pilot |

---

## Register

Status legend: **Open** = present on main and on `[013]`. **Open (fixed on `[013]`)** = present on main, fixed on the unmerged DRVO-013 branch.

### DRVO-013 — Runtime tenant isolation

| ID | Sev | Finding | Evidence | Status | Blocking |
| --- | --- | --- | --- | --- | --- |
| GA-001 | CRITICAL | Every staff user is resolved against `CASHER_BOOT`; resolution errors are swallowed; composition roots fall back to the bootstrap tenant. A second tenant's staff would act inside CUT's tenant. | `src/platform/session/staffTenantContext.ts:23-71` (bootstrap lookup, `catch {}` at 69, 91); `src/app/api/auth/login/route.ts:160-171`; `src/lib/api-auth.ts:70-82`; `src/lib/bookingSchedulingComposition.ts:21-72`; `actor.tenantId ?? resolveBootstrapTenantId()` in `posComposition.ts:11`, `queueSchedulingComposition.ts:22`, `treasuryComposition.ts:17`, `operationalCalendarComposition.ts:10`; `lib/actions/incomeActions.ts:144-146`, `expenseActions.ts:236-238` | Open (fixed on `[013]`: `src/platform/tenant/tenantContext.ts`, static guard `drvo013StaticGuards.test.ts`) | YES |
| GA-002 | CRITICAL | Edge proxy only checks that a `pos_session` cookie **exists** (signature never verified). 40 non-public route files and 7 methods inside otherwise-guarded files have no handler-level auth, so any junk cookie reaches them. Includes writes (services, categories, customers, budget, finance categories, schedule overrides, voucher consumption) and payroll/customer reads. Not addressed on `[013]`. | `src/proxy.ts:51-57` (also 30, 41); unauthenticated examples: `api/payroll/monthly/route.ts` (runs `sp_GetMonthlyPayroll`), `api/customers/route.ts`, `api/customers/[id]`, `api/services/route.ts` (POST insert `TblPro`), `api/services/categories/[id]` (DELETE `TblCat`), `api/budget/[id]/seed`, `api/finance/categories/*`, `api/loyalty/{clients,stats,tiers,ledger,client/*}`, `api/operations/schedule-control/override/[id]` (DELETE), `api/pos/client-inventory/use` (POST, CORS `*`), `api/pos/voucher`, `api/reports/expenses/employee-advances`; unguarded methods: `employees` GET, `packages` GET, `packages/[id]` GET, `budget` GET, `expenses/distribute` GET, `payroll/daily/auto-generate` GET, `services/[id]/barber-durations` PATCH. Census: 410 route files → 192 api-auth helper, 84 branch-context helper, 51 `getSession` only, 36 public, 47 none (7 of those intentional/410/env-gated). | Open | YES |
| GA-003 | CRITICAL | Branch admin, user admin and branch grants are global: any tenant `admin` lists/mutates every tenant's branches; new users get access to **all** active branches and no `TenantMembership`. | `src/lib/branch/context.ts:199-207` (`requireBranchAdminAccess` = `requireAdmin`); `api/admin/branches/route.ts:18` (`listAllBranches`); `api/admin/branches/[id]/route.ts:22,58`; `api/admin/branches/[id]/setup/*` (branchId from URL, no ownership); `api/users/route.ts:21-33,106`; `src/lib/branch/userLoginBranch.ts:99,117-126` | Open (fixed on `[013]`: `branchAdminTenantScopeResponse`, `createTenantStaffUser`, tenant-filtered grants) | YES |
| GA-004 | HIGH | Platform operator = any `super_admin`; CUT's (or any tenant's) super_admin can provision tenants. Cron bearer also yields `isSuperAdmin: true`. | `src/lib/api-auth.ts:125-147` ("Temporary boundary"), `:225-254`; `api/admin/platform/tenants/route.ts:36,45` | Open (fixed on `[013]`: `requirePlatformOperator` requires platform-owner tenant membership) | YES |
| GA-005 | HIGH | Cron/system jobs run with `tenantId: null` and iterate **every** active `TblBranch` row across tenants (nightly close, business-day reconcile, auto-absence). Unchanged on `[013]`. | `src/lib/api-auth.ts:240` (`tenantId: null`); `src/lib/branch/repository.ts:106-115` (`listActiveBranches`, no tenant filter, same on `[013]`); `src/lib/hr/nightly-close.service.ts:221,263`; `src/modules/operations/application/reconcileBusinessDay.ts:259-268`; `vercel.json` crons; `scripts/run-nightly-close.ts:37` (bearer falls back to `'dev'`) | Open | YES |
| GA-006 | HIGH | App entitlement is not enforced for most apps. Main: `ENTITLEMENT_ENFORCEMENT_ENABLED = false` and every tenant is seeded with all 12 apps. `[013]` gates only booking/queue/POS composition roots and `requireTenantApp`; legacy routes for loyalty, inventory, purchasing, HR/payroll, messaging, reports remain reachable when the app is disabled. Without this, "loyalty disabled for generic tenants" and "booking optional" are unenforceable. | `src/platform/registry/constants.ts:28` (same on `[013]`); `src/platform/registry/seedTenantRegistry.ts:26-56`; `src/platform/onboarding/tenantReadiness.ts:242` (only reader of `TenantAppEntitlement` on main); `[013]` `docs/drvo/DRVO-013-IMPLEMENTATION-NOTE.md` §"DRVO-012 gates" | Open | YES |
| GA-007 | HIGH | Tenant runtime is not landed: DRVO-012 (PR #63, migration 9 `commercial-subscription-tenant-apps`) and DRVO-013 (stacked) are unmerged; two-tenant runtime staging proof not run; production rollout needs the `verifyPlatformBootstrap` preflight (missing `TenantMembership`/`Location` rows lock users out) and invalidates all sessions once. | PR #63 body ("STAGING_GATE_PENDING"); `[013]` `DRVO-013-IMPLEMENTATION-NOTE.md` §Status ("Runtime staging proof … PENDING") and §"Rollout preflight"; `[013]` `scripts/drvo/drvo-013-tenant-isolation-smoke.ts` | Open | YES |
| GA-008 | MEDIUM | Tenant-context failures in operational route catch blocks surface as generic 500 (body non-disclosing, status not normalized). | `[013]` `DRVO-013-IMPLEMENTATION-NOTE.md` Known limitation 7 | Open | NO |

### DRVO-015 — Master-data tenancy

| ID | Sev | Finding | Evidence | Status | Blocking |
| --- | --- | --- | --- | --- | --- |
| GA-010 | CRITICAL | Core master data is global with **neither `TenantId` nor `BranchID`**: customers (`TblClient`), services/products catalog (`TblPro`, `TblCat`), payment methods (`TblPaymentMethods`), finance categories (`TblExpINCat`), settings (`TblSettingValues`). Queries are unscoped, so even after DRVO-013 a second tenant's staff read and write CUT's customers, catalog and finance setup. Only platform tables + `TreasuryMovementRegistry` carry `TenantId`. | `db/drvo-migrations/001-platform-core/schema.sql` (only `TenantId` tables), `006-treasury-movement-registry/schema.sql:8`; `api/customers/route.ts:17-22`; `api/services/route.ts:114-120,200`; `src/lib/catalog/serviceCatalog.ts:197-202`; `api/payment-methods/route.ts:13,22-26`; `api/finance/categories/route.ts:13-18`; `api/admin/customers/follow-up/route.ts:81-91`; readiness admits it: `src/lib/branch/branchReadinessService.ts:673` ("Global TblPaymentMethods shared"), `:691` ("Global TblPro catalog shared") | Open | YES |
| GA-011 | HIGH | Customer identity is resolved by phone across the whole `TblClient` table (POS, store, messaging inbox), so one tenant's customer merges into another tenant's record. | `src/lib/client/clientPhoneLookup.ts:28-30`; `api/pos/client-inventory-by-phone/route.ts:71-72`; `src/lib/store/inventory.service.ts:170-171,297-298` (`TblClientInventory` by id only); messaging inbox client match `processInboxMessageAtomic.ts:113-117` | Open | YES |
| GA-012 | HIGH | Inventory/purchasing identity: product catalog is the global `TblPro`; purchase heads carry only `BranchID`; lookups by primary key only. Safe only while all IDs belong to one business. | `db/migrations/add-branch-inventory-and-purchase-ownership.sql:178`; `src/lib/inventory/purchaseInventory.service.ts:64-67`; `api/purchases/route.ts` | Open | YES |
| GA-013 | MEDIUM | `TblBranch.BranchCode` is globally unique while `Location` is unique per tenant; tenants cannot reuse branch codes and public tenant derivation depends on global uniqueness. | `provisionTenant.ts:214` (`assertBranchIdentityAvailable`); `db/migrations/add-drvo-003-platform-core.sql:42`; `src/lib/branch/repository.ts:91-104` | Open | NO |
| GA-014 | DEFERRED | Loyalty tenancy (`TblClientLoyalty`, `TblLoyaltyTier`, `TblLoyaltyPointLedger`, `TblClientInventory`, `TblLoyaltyStoreItem`, CUT CLUB) for generic tenants. V1: loyalty stays installed only for `CASHER_BOOT`; requires GA-006 gate. | `api/loyalty/**` (no tenant/branch predicate, e.g. `stats/route.ts:27-28`); `src/lib/loyalty/helpers.ts:55-56,165-184` (`CUT-${id}`, `cutsaloon.com/ref`) | Deferred | NO |

### DRVO-016 — HR / payroll de-CUT

| ID | Sev | Finding | Evidence | Status | Blocking |
| --- | --- | --- | --- | --- | --- |
| GA-020 | CRITICAL | HR, payroll, employee ledger, attendance and manager closing are hard-wired to exactly two branches (`GLEEM`, `CAMP_CAESAR`) in SQL, types and UI, with `GLEEM` as the legacy fallback. A new tenant's branches are invisible to payroll/ledger, and attendance row creation throws. | `src/lib/services/employeeLedgerService.ts:101-108,621`; `src/lib/types/employee-ledger.ts:68`; `src/lib/hr/dailyPayrollReadiness.service.ts:442-444,607-609`; `api/admin/manager-closing/status/route.ts:65-66`; `src/lib/payroll/dailyPayrollEmployeeScope.shared.ts:6,15-16`; `src/lib/hr/employeeBranchScheduleResolver.ts:305,396`; `src/lib/hr/attendance-break-schedule-sync.ts:40`; UI: `components/hr/{DailyPayrollPanel,AttendancePanel,EmployeeLedgerPanel}.tsx`, `app/manager/closing/page.tsx:62-63` | Open | YES |
| GA-021 | CRITICAL | Employee master (`TblEmp`) has no `TenantId`/`BranchID`; employee list GET and monthly payroll (`sp_GetMonthlyPayroll`, no branch filter) are global. Payroll/target tables are keyed by `EmpID`/`BranchID` only. | `api/employees/route.ts:43,58-60`; `api/payroll/monthly/route.ts:26-30`; `db/migrations/add-employee-financial-branch-ownership.sql:122-150`; `employee-target-recalc.repository.ts:80-81` | Open | YES |
| GA-022 | HIGH | CUT people, IDs and policies compiled into runtime code: partner EmpIDs and presets, partner share drafts and percentages, `GLEEM_BRANCH_ID = 1`, `branchId === 1` guards, accounting seed by personal names, expense advance categories by name, permission seed grants `super_admin` to loginName `Tarek`. | `src/lib/reports/partnersEmployeeOverrides.ts:42-65`; `src/lib/branch/campCaesarPartnerDraft.ts:3-12`; `src/lib/types/monthly-report.ts:34,38`; `src/lib/branch/partnerShares.ts:6`; `src/lib/branch/launchRosterService.ts:10`; `src/lib/branch/activatePartnerShares.ts:23`; `src/lib/branch/smokeExecutionContext.ts:56`; `src/lib/accounting/accountingSettingsSeed.ts:66,77`; `src/app/expenses/page.tsx:41`; `src/lib/services/employeeLedgerFundingSyncService.ts:19-20`; `api/admin/permissions/seed/route.ts:263` | Open | YES |
| GA-023 | HIGH | Runtime business config lives in **tracked** JSON files written to `process.cwd()/data`, keyed by branch code/month with no tenant; deploy runs `git reset --hard`, so production edits are overwritten and a multi-instance deploy diverges. | `src/lib/reports/partnersEmployeeOverridesStore.ts:16`; `src/lib/payroll/employee-target/employee-target-templates.store.ts:15`; tracked `data/partners-employee-overrides.json`, `data/employee-target-templates.json`; `deploy/deploy-casher:135` | Open | YES |
| GA-024 | MEDIUM | One-off CUT ops code shipped in `src/` (dev-gated): August fill for a named employee, named-barber debug route. | `src/lib/hr/opsFillYoussefMohamedGleemAugust.ts:23-24`; `api/dev/youssef-mohamed-fill/route.ts`; `api/admin/booking-debug/zeyad-1130-test/route.ts:12` | Open | NO |
| GA-025 | MEDIUM | Payroll automation is manual/paused: nightly-close timer disabled on deploy, payroll auto-generate only via a Windows Task Scheduler script; `payroll → attendance` dependency deferred by DRVO-012. | `deploy/deploy-casher:234-238`; `scripts/auto-generate-payroll.ps1:11-41`; PR #63 `DRVO-012-IMPLEMENTATION-NOTE.md` §"Install dependencies" | Open | NO |

### DRVO-017 — Onboarding / operator / tenant shell

| ID | Sev | Finding | Evidence | Status | Blocking |
| --- | --- | --- | --- | --- | --- |
| GA-030 | CRITICAL | A newly onboarded tenant owner **cannot log in**: onboarding creates the first branch `IsActive = 0 / SETUP` and login rejects inactive branches (`NO_BRANCH_ACCESS`). Activation needs a branch-admin session, so the tenant is locked out. Same on `[013]`. | `src/platform/onboarding/provisionTenant.ts:92-106` (`0, N'SETUP'` at 104); `src/lib/branch/access.ts:63-69`; `src/lib/branch/repository.ts:188`; readiness requires SETUP: `src/platform/onboarding/tenantReadiness.ts:113-138` | Open | YES |
| GA-031 | CRITICAL | A new tenant receives no operational baseline (catalog, payment methods, roles/role assignments, page access, settings, treasury setup, employees); the only paths are scripts and SQL. | `provisionTenant.ts:188-364` (creates tenant/branch/owner/registry only); `scripts/bootstrap-branch.ts:1-24`; `scripts/provision-camp-caesar-setup.ts:42-72` (hard-coded CAMP_CAESAR on `last132`); `scripts/seed-drvo-003-bootstrap-tenant.ts` | Open | YES |
| GA-032 | HIGH | RBAC is global: `TblRoles` (`RoleKey` unique), `TblUserRoles`, `TblSystemPages`, `TblPageRoleAccess` have no tenant; `TenantMembership` has no role. Permission migrate/seed write global tables and are callable by any tenant admin. | `src/lib/permissions-server.ts:41-79,107`; `api/admin/permissions/migrate/route.ts:8,18-76`; `api/admin/permissions/seed/route.ts:194-280`; `db/drvo-migrations/001-platform-core/schema.sql:63-71` | Open | YES |
| GA-033 | HIGH | No platform-operator UI. Operator surface is API-only (3 routes on main; 13 on `[013]` incl. subscription/apps). #60 DoD 9 requires onboarding from platform UI without SQL. | no pages under `src/app/{platform,operator,admin/platform,admin/tenants}` on main or `[013]`; `[013]` `src/app/api/admin/platform/**` | Open | YES |
| GA-034 | HIGH | No tenant admin / setup console (tenant-scoped users, branches, installed apps, settings, readiness). The 61 `src/app/admin/**` pages are the single-salon admin. | `src/app/admin/**` (users, branches, settings, permissions, cut-club …) | Open | YES |
| GA-035 | HIGH | Branding is hard-coded to "Cut Salon" in app shell, login, navigation logo, receipts, queue/booking tickets, shift-close receipts and PDF reports; theme default `cut-gold`; `Tenant` has no branding fields. A second tenant prints "صالون كت للرجال" on customer receipts. | `src/app/layout.tsx:20-21`; `src/app/login/page.tsx:31`; `components/layout/MainNav.tsx:1050,1086-1087`; `components/pos/PrintInvoiceModal.tsx:604,796`; `components/operations/ShiftCloseReceipt.tsx:421,642`; `src/lib/printQueueTicket.ts:198-216`; `src/lib/printBookingTicket.ts:463`; `src/lib/services/MonthlyReportPDFService.ts:330-415`; `src/lib/theme.ts:12,26`; `db/migrations/add-drvo-003-platform-core.sql:15-26` | Open | YES |
| GA-036 | HIGH | Branch setup wizard and branch bootstrap are CAMP_CAESAR/GLEEM-specific (default name, location choices, `TRANSFER_FROM_GLEEM`, copy-from `GLEEM`, CUT currency/name). | `src/app/admin/branches/[id]/setup/page.tsx:66`; `setup/employees/page.tsx:41-521`; `setup/opening-inventory/page.tsx:10,79,106`; `src/lib/branch/branchSetupPolicy.ts:7,87`; `src/app/admin/branches/new/page.tsx:25`; `src/lib/branch/bootstrap.ts:246-251,474-476` | Open | YES |
| GA-037 | MEDIUM | Timezone, currency and business-day cutoff hard-coded (`Africa/Cairo` in 152 TS/TSX files, `EGP` ~45 hits, cutoff 4/5/6 duplicated). Acceptable for an Egypt-only V1. | `src/lib/businessDate.ts:18-21`; `src/lib/reports/*.types.ts` (`timezone: 'Africa/Cairo'` as type); `src/lib/reports/reportFormatters.ts:64`; `src/lib/booking/publicBookingServicePolicy.ts:10` | Open | NO |
| GA-038 | MEDIUM | Login has no tenant selector; `loginName` uniqueness is enforced only in code (global); multi-membership users fail `TENANT_AMBIGUOUS` on `[013]`. | `api/auth/login/route.ts:28-31,120-125`; `provisionTenant.ts:46-60`; `[013]` Known limitation 1 | Open | NO |
| GA-039 | MEDIUM | Printing assumes a local print agent at `127.0.0.1:7788` and fixed 80mm/58mm widths; no per-branch/device printer config (browser print fallback exists). | `src/lib/printService.ts:2`; `src/lib/printBookingTicket.ts:44`; `src/lib/localPrintClient.ts:6`; `src/lib/branch/branchConfigurationTemplate.ts:384-387` | Open | NO |

### DRVO-018 — Messaging / WhatsApp / AI tenancy

| ID | Sev | Finding | Evidence | Status | Blocking |
| --- | --- | --- | --- | --- | --- |
| GA-040 | CRITICAL | No messaging or AI table has `TenantId` (`TblMessageOutbox`, `TblMessageInbox`, `TblBot*`, `TblMessageTemplate`, `TblWhatsAppCampaign*`, `TblWhatsAppGroup`, `TblSalon*`); inbound webhook payload carries no tenant; conversations are unique on `(Channel, Provider, ExternalContactKey)` globally; campaign audiences select from all of `TblClient`. | `db/migrations/create-tbl-message-outbox.sql:29,37`; `create-tbl-message-inbox.sql:33`; `create-tbl-bot-conversation.sql:29-30`; `create-tbl-salon-concierge.sql:40-184`; `api/internal/messaging/inbox/whatsapp/route.ts:18-27`; `messageInboxRepository.ts:174-203`; `buildAudienceQuery.ts:152`; `whatsappGroupRepository.ts:136-145` | Open | YES |
| GA-041 | CRITICAL | One global WhatsApp gateway/sender (`WHATSAPP_API_BASE_URL`, default loopback bot); no per-tenant channel/credentials. Workers claim without tenant filter; `[013]` binds the outbox worker to `CASHER_BOOT` through the `legacy-messaging-worker` seam, so non-CUT tenants get **no** messaging — contradicting the V1 decision. | `src/lib/integrations/whatsapp/config.ts:50-75`; `client.ts:66-81,279-294`; `messageOutboxRepository.ts:242-262`; `inbox/infra/messageInboxRepository.ts:264-280`; `ai/infra/aiTurnRepository.ts:207-222`; `[013]` `scripts/messaging-outbox-worker.ts` (seam), `DRVO-013-IMPLEMENTATION-NOTE.md` Known limitation 5 | Open | YES |
| GA-042 | HIGH | AI Receptionist is CUT-specific: official site URLs, verified phone numbers, scraped prices, two-branch routing and hours, CUT knowledge bootstrap, salon-only system prompt, AI control-plane branch enum; confirmed bookings act as `AI_BOOKING_ACTOR_USER_ID || 1`. | `src/modules/messaging/ai/salonConcierge/officialSite.ts:6-12,107-135`; `branchBusinessHours.ts:5,20-44`; `routing.ts:71-75`; `bootstrapKnowledge.ts:405`; `processConciergeTurn.ts:234,371`; `ai/domain/systemInstructions.ts:2,25`; `src/modules/ai-control-plane/domain/enums.ts:138`; `learningInterpreterPrompt.ts:18`; `ai/planner/executeConfirmedBookingPlan.ts:98` | Open | YES |
| GA-043 | HIGH | One global Gemini key/model; no per-tenant enablement, quota, rate limit or cost attribution (only `maxOutputTokens: 700`). AI entitlement not checked anywhere. | `src/modules/messaging/ai/config.ts:6,25-30`; `geminiModelClient.ts:33-60,96-99`; `processAiTick.ts:40` | Open | YES |
| GA-044 | HIGH | Message templates and defaults are CUT-branded (template catalog, sale receipt, WhatsApp config fallbacks to `جليم`/`cutsaloon.com`/"Cut Salon", POS quick-message, owner/employee daily reports with owner name `طارق`). | `src/modules/messaging/templates/catalog.ts:29,46,57`; `templates/defaults/saleCustomerReceipt.ts:8`; `src/lib/integrations/whatsapp/config.ts:71-75`; `components/pos/QuickWhatsAppModal.tsx:16`; `src/lib/hr/owner-daily-whatsapp-report.service.ts:19`; `src/lib/hr/employee-daily-whatsapp-report.service.ts:32` | Open | YES |
| GA-045 | HIGH | Webhook trust is one static global bearer (`WHATSAPP_INBOX_WEBHOOK_TOKEN`) compared with `===`, no signature, no per-tenant secret; `outbound-observed` route is missing from the proxy allowlist (cookie required → bot calls fail). | `src/modules/messaging/inbox/config.ts:12-16`; `src/lib/proxyPublicRoutes.ts:34-49,92-102`; `api/internal/messaging/outbound-observed/whatsapp/route.ts:27` | Open | YES |
| GA-046 | MEDIUM | Worker identity/poll tuning not multi-host safe: AI worker id `ai-${pid}` (no hostname), idle poll 5–100 ms. | `ai/application/processAiTick.ts:24`; `ai/config.ts:11-12` | Open | NO |

### DRVO-019 — Optional public booking

| ID | Sev | Finding | Evidence | Status | Blocking |
| --- | --- | --- | --- | --- | --- |
| GA-050 | HIGH | `POST /api/public/booking/upcoming` returns upcoming bookings (branch, employee, times) for a phone number across **all** tenants and branches, including internally created bookings of tenants that never enabled public booking. Blocks GA as long as the Booking app can be installed for any non-`CASHER_BOOT` tenant. Unchanged on `[013]`. | `src/lib/booking/publicBookingReader.ts:588-643` (`WHERE c.Mobile = @phone`, no tenant/branch predicate) | Open | YES |
| GA-051 | HIGH | Public booking defaults to CUT: `GLEEM` as catalog host, `settingsBranchId = 1`, "Cut Salon"/EGP defaults, ops controllable branch `GLEEM`, `IN (GLEEM, CAMP_CAESAR)` queries. Blocks *enabling public booking* for another tenant, not GA. | `src/lib/booking/publicBookingBarbers.ts:223-227,709,728`; `src/lib/booking/publicBookingOperations.ts:21,72-76,276`; `src/lib/publicBookingHelpers.ts:214-255,327-329` | Open | NO |
| GA-052 | MEDIUM | Public identity is global: one `PUBLIC_BOOKING_ALLOWED_ORIGINS` list, no per-tenant public site/domain, `logoUrl: null`. | `src/lib/booking/publicBookingCors.ts:146-187`; `api/public/booking/config/route.ts:74`; `src/proxy.ts` (no host parsing) | Open | NO |
| GA-053 | MEDIUM | Booking codes use `Math.random` (`BK-` + 6 chars) in one global code space. | `src/lib/publicBookingHelpers.ts:46-53`; `publicBookingReader.ts:30` | Open | NO |
| GA-054 | MEDIUM | Public read routes (config/services/barbers) rely on branch `PublicBookingEnabled`, not the tenant's Booking entitlement; legacy single-public-branch fallback is global. | `src/lib/booking/publicBookingBranchContext.ts:248-311`; `src/lib/branch/bookingQueueOwnership.ts:158-172`; `api/public/booking/barbers/route.ts:35,53-54`; `[013]` Known limitation 4 | Open | NO |
| GA-055 | DEFERRED | Separate multi-tenant public booking frontend, per-tenant domains/subdomains, tenant-branded booking site. | #60 Phase 5; product decision "Booking optional" | Deferred | NO |

### DRVO-020 — GA / hardening

| ID | Sev | Finding | Evidence | Status | Blocking |
| --- | --- | --- | --- | --- | --- |
| GA-060 | CRITICAL | Passwords are stored and compared in plaintext (`NVarChar(50)`), including onboarding owners; no hashing library. | `src/app/api/auth/login/route.ts:101,116-126` (same on `[013]`); `src/platform/onboarding/provisionTenant.ts:123-132`; `package.json` (no bcrypt/argon2) | Open | YES |
| GA-061 | CRITICAL | Customer-facing APIs trust a raw `clientId`/mobile with no customer authentication (`// TODO: Replace with authenticated session / OTP token`), CORS `*`, no rate limit; they redeem points, buy store items and update any `TblClient` row. | `src/app/api/public/client/**` (11 routes, e.g. `loyalty/me/route.ts:34,52-63`, `loyalty/rewards/[rewardId]/redeem/route.ts:63-65,188,217`, `store/buy/route.ts:45-47,92`); `api/client/lookup` (`publicClientWebsite.service.ts:36-64`); `api/client/update/route.ts:34-48` | Open | YES |
| GA-062 | CRITICAL | SQL injection: `search` and `tierCode` are interpolated into SQL in an unauthenticated route. | `src/app/api/loyalty/clients/route.ts:32,34,39` | Open | YES |
| GA-063 | HIGH | No login rate limit/lockout; failed logins not audited; all rate limiting is in-memory per process; HMAC/bearer comparisons are not constant-time. | `api/auth/login/route.ts:129`; `src/lib/booking/publicBookingRateLimitPolicy.ts:2-3,75`; `src/lib/session.ts:90`; `src/lib/proxyPublicRoutes.ts:99,140` | Open | YES |
| GA-064 | HIGH | No security headers (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy) and no CSRF/Origin check; only `sameSite: 'lax'`. | `next.config.ts` (no `headers()`); `src/proxy.ts`; `src/lib/session.ts:181-187` | Open | YES |
| GA-065 | HIGH | Every push to `main` deploys to production with no CI dependency; CI runs a hand-picked test subset; no typecheck/lint; build ignores TS errors. | `.github/workflows/deploy-vps.yml:3-8`; `.github/workflows/ci.yml:28-53`; `next.config.ts:8-10` | Open | YES |
| GA-066 | HIGH | Schema changes outside the DRVO control plane: deploy runs legacy messaging/concierge migrations and the CUT concierge data bootstrap on every deploy (scripts refuse non-`last132` DBs); 18 HTTP `*migrate*` routes run DDL in production behind admin roles (tenant admins after onboarding); an anonymous public route runs DDL. ~150 legacy migration artifacts are outside the ledger. | `deploy/deploy-casher:169-212`; `scripts/run-salon-concierge-migration.ts:37,50`; `api/admin/migrate-audit-log/route.ts:16-27`; `api/admin/permissions/migrate/route.ts:8`; `api/public/services/[id]/steps/route.ts:56`; `db/migrations/*.sql` (84 files) vs `scripts/drvo/migrations/` (8) | Open | YES |
| GA-067 | HIGH | No backup tooling, restore drill or DR runbook; the migration control plane records `backup_reference` as free text without verification. | `scripts/drvo/migration-control.ts:140-142`; `.github/workflows/drvo-production-migration.yml:63`; no tracked backup/restore scripts | Open | YES |
| GA-068 | HIGH | No observability: ~1,288 raw `console.*` calls, no error tracking, no tenant-tagged logs, no public health endpoint (deploy health check fetches `/login`), audit table has no `TenantId`, login not audited, no request-ID propagation in proxy. | `src/lib/migrations/sensitive-audit-log.sql:10-38`; `src/lib/api-auth.ts:257-268`; `deploy/deploy-casher:269-270`; `.github/workflows/deploy-vps.yml:122-131` | Open | YES |
| GA-069 | HIGH | No runtime tenant-isolation proof: main's tenant tests only match source text; `[013]` tests use a fake SQL layer; no two-tenant E2E in CI; second-tenant pilot and CUT regression suite (#60 Phase 8) not run. | `scripts/drvo/__tests__/platformBootstrapMultiTenant.test.ts:6-18`; `src/platform/__tests__/staffTenantContext.test.ts:15-22`; `[013]` `drvo013TenantIsolation.test.ts` | Open | YES |
| GA-070 | MEDIUM | Deploy builds in place (`git reset --hard`, `npm run build`), no atomic release/rollback; `casher.service` not tracked; stale `vercel.json` crons; nightly-close timer disabled. | `deploy/deploy-casher:135-157,234-242`; `vercel.json` | Open | NO |
| GA-071 | MEDIUM | `PlatformOutbox` has no lease columns; rows stuck in `delivering` after a crash need manual requeue (`[013]` adds the first consumer). | `[013]` `src/platform/outbox/consumer.ts`; Known limitation 2 | Open | NO |
| GA-072 | MEDIUM | Session is a stateless 24h token without revocation for `getSession()`-only routes; non-production fallback secret; `SESSION_COOKIE_SECURE=false` override exists. | `src/lib/session.ts:17,34,53-60,102` | Open | NO |
| GA-073 | MEDIUM | `GET /api/public/booking/v2/isolated-probe` is anonymous and returns DB name/login/stacks when its env gate passes (gate refuses `last132`). Remove before GA. | `api/public/booking/v2/isolated-probe/route.ts:1-20,76,89`; `src/lib/booking/bookingV2WriteSafety.ts:55-80` | Open | NO |
| GA-074 | MEDIUM | Repo/ops hygiene: 154 tracked `tmp/` production probe scripts, tracked logs; deploy token embedded in VPS remote URL; stale open items (draft PR #22 / issue #21, issue #32, issue #7). | `git ls-files tmp`; `.github/workflows/deploy-vps.yml:83-84` | Open | NO |
| GA-075 | DEFERRED | Billing-provider integration (trial→paid, webhooks, dunning). V1 uses operator-managed subscriptions from DRVO-012. | no provider code on main/`[013]`; PR #63 subscription lifecycle | Deferred | NO |
| GA-076 | DEFERRED | Marketing / platform website. Separate repo and deploy; must not touch ERP DB/migrations. | #60 "Parallel Platform Website Track" | Deferred (out of repo) | NO |

---

## Summary

### By severity

| Severity | Count | IDs |
| --- | --- | --- |
| CRITICAL | 13 | GA-001, GA-002, GA-003, GA-010, GA-020, GA-021, GA-030, GA-031, GA-040, GA-041, GA-060, GA-061, GA-062 |
| HIGH | 26 | GA-004, GA-005, GA-006, GA-007, GA-011, GA-012, GA-022, GA-023, GA-032, GA-033, GA-034, GA-035, GA-036, GA-042, GA-043, GA-044, GA-045, GA-050, GA-051, GA-063, GA-064, GA-065, GA-066, GA-067, GA-068, GA-069 |
| MEDIUM | 16 | GA-008, GA-013, GA-024, GA-025, GA-037, GA-038, GA-039, GA-046, GA-052, GA-053, GA-054, GA-070, GA-071, GA-072, GA-073, GA-074 |
| DEFERRED | 4 | GA-014, GA-055, GA-075, GA-076 |
| **Total** | **59** | |

All 13 CRITICAL and 25 of 26 HIGH findings are launch-blocking (GA-051 is not: it only blocks enabling public booking for another tenant).

### Owner mapping

| Owner | Blocking | Non-blocking | Blocking IDs |
| --- | --- | --- | --- |
| DRVO-013 | 7 | 1 | GA-001, GA-002, GA-003, GA-004, GA-005, GA-006, GA-007 |
| DRVO-015 | 3 | 2 | GA-010, GA-011, GA-012 |
| DRVO-016 | 4 | 2 | GA-020, GA-021, GA-022, GA-023 |
| DRVO-017 | 7 | 3 | GA-030, GA-031, GA-032, GA-033, GA-034, GA-035, GA-036 |
| DRVO-018 | 6 | 1 | GA-040, GA-041, GA-042, GA-043, GA-044, GA-045 |
| DRVO-019 | 1 | 5 | GA-050 |
| DRVO-020 | 10 | 7 | GA-060, GA-061, GA-062, GA-063, GA-064, GA-065, GA-066, GA-067, GA-068, GA-069 |
| **Total** | **38** | **21** | |

Of the 7 DRVO-013 blockers, GA-001, GA-003 and GA-004 are already fixed on the unmerged DRVO-013 branch and close when GA-007 closes. GA-002, GA-005 and GA-006 are **not** covered by the current DRVO-013 branch and must be added to it (or to a DRVO-013 follow-up PR) before #61 can close.

### Unowned blockers

**None.** No CRITICAL gap required a task outside DRVO-013..DRVO-020.
DRVO-012 (#52, PR #63) is a predecessor, not a new task: its landing is tracked inside GA-007 because DRVO-013 is stacked on it.

### GA blocker count

**38** launch-blocking findings (13 CRITICAL + 25 HIGH).

## Maintenance rules

1. IDs are permanent. Do not renumber; mark closed findings `Closed (#PR)` in the Status column.
2. A finding moves owner only by editing this file in a reviewed PR with a reason.
3. New findings take the next free ID inside the owner block (GA-0x9 slots are reserved for growth).
4. GA is declared only when every `Blocking = YES` row is `Closed` with the staging/E2E proof listed in the gap audit §6.
