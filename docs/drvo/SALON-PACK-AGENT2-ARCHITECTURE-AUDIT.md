# Salon Pack — Architecture Audit & Delivery Gates (Agent 2)

**Baseline:** `main@9c21f3847b354af9a128b953242a5b00c51953ea` (2026-10-26)  
**Owner:** Agent 2 — Salon Pack / Industry Integration  
**Status:** Stage A audit, not launch approval  
**Non-goal:** Perfecting each CUT feature, changing financial semantics, or deploying production.

## Product acceptance contract

A newly created independent salon must be able to assemble the operational equivalent of Cut Salon **without copying CUT data**, via UI-led setup. Booking, Queue, POS, HR/Payroll, Treasury, and Reports must cooperate. A smaller `booking + queue` composition must work without POS or Payroll. A module may evolve behind its public port without breaking the other installed apps.

**Done means evidence, not commits:** repeatable fresh-tenant Staging E2E, module composition/uninstall/reinstall checks, Cut regression, tenant isolation, clean provisioning/retry/rollback, and reviewed merge/release. P0/P1 only block launch; polish is P2 backlog.

## Baseline observed — do not rebuild

- **Platform Core:** `src/platform/tenant`, `auth`, `commercial`, `registry`, `apps`, `onboarding`, `uow`, `outbox`.
- **Recipe, not fork:** `src/packs/salon/manifest.ts`. Required `booking`; recommended `queue,pos,attendance,payroll,treasury,reports`; optional `inventory,purchasing,messaging,ai-receptionist`.
- **Module catalog:** `src/platform/registry/constants.ts`; `src/platform/apps/appCatalog.ts`. The only proven **install-time** dependency currently recorded is `purchasing → inventory`. This is **not** a complete runtime dependency map.
- **Composition:** `compositionResolver.ts` validates required apps, disables via entitlement, rejects missing hard dependencies; `tenantApps.ts` retains historical records on disable. `operations` is a composition surface, not an app.
- **Onboarding:** `src/platform/onboarding/wizard/coordinator.ts` creates core once, then applies separately transacted setup stages and reports failed/blocked stages. It is **not** one atomic wizard transaction and must be retry-safe.
- **Safety limits:** `loyalty` is `legacy-only`; `messaging` and `ai-receptionist` are not self-service available in V1. `ENTITLEMENT_ENFORCEMENT_ENABLED = false` in registry constants; verify actual commercial route enforcement before claiming an uninstalled app cannot run.
- **Existing source contracts:** `docs/drvo/DRVO-001-DEPENDENCY-GRAPH.md` and `docs/drvo/DRVO-002-BOUNDARY-CONTRACTS.md` define the shared-DB modular-monolith direction; they must be reused, not contradicted.

## Ownership matrix and seams

| Capability | Canonical owner | Shared contracts needed by Salon Pack | Current assessment / gate |
|---|---|---|---|
| Tenant / Locations / Staff identity / entitlements | Platform Core (Agent 1) | TenantContext, Location, access, app composition | Existing; coordinate Core changes via issue #102 |
| Customer identity / service catalog / employee schedule & occupancy | Shared Domains | Customers.upsert/find; Catalog.list/snapshot; Workforce occupancy lock/commit/release | Existing legacy adapters; port coverage and isolation need tests |
| Business day / shift | Shared Operational Calendar | Open/close day/shift, resolve financial write context | Existing infra; treasury direct close bypass in issue #148 must be resolved |
| Booking | Booking app | Customer, Catalog, Workforce, calendar date, booking events | Create/reschedule/cancel fresh-tenant E2E established; keep port stable |
| Walk-in queue | Queue app | Workforce/Calendar + Booking optional association | Staging walk-in through done established; queue duration branch-scoped |
| Invoice / payments | POS | Catalog snapshots, Calendar gate, Treasury posting | **P0 candidate:** verify invoice + money posting atomicity and branch/tenant correctness; CUT trigger semantics |
| Cash movement / reconciliation | Treasury | Calendar, money posting, auditable recon | **P0 candidate:** #148 close path bypass; reconcile day-vs-shift and variance before final gates |
| Attendance + salary + commission | Attendance / Payroll apps | Workforce + Calendar, invoice commissions, immutable ledger | Require multi-tenant end-to-end calculation, no ledger double post |
| Daily / monthly reports | Reports | Read-only projections from transactional modules | Confirm tenant and branch scope, no global reports bleed |
| Messaging / AI | Product apps, optional | Outbox integration without forcing WhatsApp | Keep excluded from first generic self-service full pack |
| Inventory / Purchasing | Product apps, optional | POS stock posting and purchasing → inventory | Not mandatory for minimal Salon; prove optional composition later |

### Critical integration rules (target contracts, not falsely marked implemented)

1. POS owns invoice; Treasury owns cash postings; both participate in the **same shared SQL unit of work** while co-located. Reuse `docs/drvo/DRVO-002-BOUNDARY-CONTRACTS.md`.
2. Booking→POS conversion updates the booking completion link and invoice atomically; **no unsafe two-step dual write**.
3. Workforce owns staff schedules and employee occupancy; booking and queue are claimants, never separate sources of availability truth.
4. Operational Calendar owns BusinessDay/Shift state, including treasury-triggered close. Avoid alternate mutations of `TblNewDay.Status` by product apps.
5. Module disable must not delete historical financial records; boundaries must enforce tenant-scoped entitlement. Track contract changes/versioning with regression.
6. Cross-module events use Platform Outbox transactionally; WhatsApp is not the event bus.

## Verified blockers / gaps to schedule (not scope creep)

| ID | Priority | Evidence | Acceptance proof needed |
|---|---|---|---|
| A-01 | P0 before finance launch | `src/lib/actions/treasuryActions.ts::closeTreasuryDay` directly `UPDATE dbo.TblNewDay SET Status=0`; bypasses operational close invariants (#148) | One atomic, branch-locked close contract with pending queue/open-shift & treasury guards; staging adversarial path |
| A-02 | P1 | `appCatalog.ts` only encodes purchasing→inventory; functional POS/Treasury/Booking/Queue dependencies exist outside install-time catalog by design | Dependency map distinguishing mandatory install dependencies from shared infrastructure and optional integrations; partial-pack E2E |
| A-03 | P1 | Onboarding post-core stages commit independently; failure is recorded | Retry partial-stage failure without duplicate tenant/staff/services or incomplete hidden features |
| A-04 | P1 | Financial posting relies on cash movement trigger and shared DB transaction (DRVO-001/002) | POS full transaction + cash movement + reversal, branch and tenant isolation, replay idempotency |
| A-05 | P1 | `loyalty` legacy-only and messaging/AI self-service unavailable | Ensure default full Salon pack exposes only supportable apps; optional selection reports truthful restrictions |
| A-06 | P1 | App entitlement constant disabled; separate tenant guards exist | Runtime evidence that an uninstalled module is inaccessible without affecting shared services |
| A-07 | P1 | Payroll/attendance have shared employee, business-day, invoice relations | Fresh-tenant wage + commission ledger end-to-end, no dual posting |
| A-08 | P1 | Reports project operational and accounting legacy tables | Tenant/branch reporting and full flow consistency on fresh salon |

## Sequence (minimum critical path)

- **A. Architecture audit:** this document + source-linked matrix; review Core and Treasury seams. Exit only once owners and P0/P1 are agreed; documenting risks alone ≠ close.
- **B. Contracts and composition:** port contract tests; confirm full and minimal pack dependency validation; no unnecessary rewrite.
- **C. Salon full-pack assembly:** activate required/recommended apps from UI; service/staff/branch initialization, rollback and resume.
- **D. Essential integration:** Booking→Queue→POS→Treasury; staff attendance→payroll; reports. Fix blockers, not P2 polish.
- **E. Regression & self-service:** fresh full pack + minimal pack, CUT behavior unchanged, module disable/re-enable, ownership checks.
- **F. Release:** staging logs and fixtures cleanup, P0/P1 zero, security review, human-reviewed merge/deployment.

### Evidence ledger, as of this baseline

- Fresh-tenant booking create/move/cancel: staging E2E green on prior PRs (#126, #129).
- Walk-in queue lifecycle: staging E2E green (#137).
- Pending queue guards manual close: staging E2E green (#142).
- **Not proven:** complete full-pack assembly, POS invoice+Treasury+Payroll integrated run, minimal-pack disable, end-user self-service setup, cross-module contract evolvability. These cannot be counted Done.
- PR #145 (manager close checklist) may still be unmerged; recheck status before reuse.

### Explicit non-goals for Agent 2

- Reimplement Platform Core tenant/location ownership; coordinate Agent 1.
- Polish every feature or rewrite all legacy components.
- Merge PRs or deploy without human authorization.
- Invent fresh-tenant safety by copying bootstrap tenant data.

## Scorecard

| Stage | Status | Exit evidence |
|---|---|---|
| 1 Architecture audit | **In review** | This map reviewed; ownership decisions and P0/P1 triaged |
| 2 Module contracts | Not accepted | Versioned port tests and agreed owners |
| 3 Pack assembly | Not accepted | Full + minimum fresh-tenant UI setup |
| 4 Salon integration | Not accepted | Booking→invoice→cash→wages→report end-to-end |
| 5 CUT compatibility | Not accepted | Golden-path regression plus totals parity |
| 6 Self-service UX | Not accepted | No manual DB/CLI provisioning |
| 7 Staging acceptance | Partial evidence | Repeatable green complete scenario and isolation |
| 8 Release/handoff | Not accepted | Security, docs, P0/P1 closure, reviewed deploy |

**Reporting rule:** PR merged ≠ module done, unit test green ≠ E2E done, a non-blocking treasury warning ≠ financial settlement verified.
