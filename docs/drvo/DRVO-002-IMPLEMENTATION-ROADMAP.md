# DRVO-002 — Implementation Roadmap

| Field | Value |
|-------|-------|
| Document | `DRVO-002-IMPLEMENTATION-ROADMAP` |
| Issue | https://github.com/tarek-saad-dev/casher/issues/7 |
| **Decided against Git HEAD** | `9dcb83e` |
| Evidence baseline | DRVO-001 audited SHA `f5e43773545d25467af7b302b974191418a3f8dd` |
| Authority | The only committed implementation sequence. [PLATFORM-BLUEPRINT](./DRVO-002-PLATFORM-BLUEPRINT.md) · [DECISION-REGISTER](./DRVO-002-DECISION-REGISTER.md) · [BOUNDARY-CONTRACTS](./DRVO-002-BOUNDARY-CONTRACTS.md) |

This roadmap stops after DRVO-004. Later apps are not sequenced here.

---

## Canonical decisions (DRVO-002)

These statements are identical in all four DRVO-002 documents.

1. Runtime shape: modular monolith. Same deployment and same database until a later level gate is met.
2. Tenancy: shared database / shared schema. One TenantId column namespace. The current Casher database maps to one bootstrap tenant.
3. Identity: four separate identities — platform admin, tenant staff user, customer/end user, service/integration identity.
4. Boundaries: Platform Core, Shared Domains (Customers, Catalog, Workforce, Operational Calendar), Independent Apps, Industry Packs. Salon Pack is a recipe, not a fork.
5. Extraction: first phase for Booking scheduling is LEVEL 1. Medium-term data ownership target is LEVEL 3 on the shared database. LEVEL 2 runtime for Booking is deferred. LEVEL 4 is not a medium-term target for Booking or POS.
6. Day/Shift owner: Shared Domain Operational Calendar.
7. CashMove owner: Treasury app, through the Money Movement posting API.
8. Booking conversion: POS owns the invoice. Booking owns completion and ConvertedInv linkage. Consistency is one shared SQL transaction while co-located. An orchestrated saga is allowed only when a shared transaction is impossible. A bare dual-call is forbidden.
9. Scheduling conflict authority: Workforce Shared Domain. Occupancy is tenant-global per employee, including cross-location conflicts. Queue and Booking are claimants.
10. Events: Platform Core owns the transactional outbox. Messaging/WhatsApp is a product app and is not the bus.
11. Sequence: DRVO-003 Platform Core Bootstrap, then DRVO-004 Booking Scheduling Extraction.

---

## 1. How Casher keeps running

The salon deployment stays one Next.js process and one SQL Server database. Staff keep the current routes. New modules wrap current tables through `src/legacy` adapters.

| Rule | Meaning |
|------|---------|
| Source of truth | Legacy table until that module's exit criteria name its repository as the only writer |
| Anti-corruption | Adapters translate `BranchID`, `ClientID`, `EmpID`, `ProID`, and invoice composites. New ports speak DRVO ids plus the legacy map |
| Shared database | Remains through DRVO-004. No second database and no schema-per-tenant |
| Dual-read | Allowed for the operations board shadow comparison |
| Dual-write | Forbidden for cash, invoices, and booking completion across two stores |
| Canary | A tenant setting or a single location flag on the bootstrap tenant |
| Rollback | Turn the flag back to the legacy adapter. Do not drop the new tables in that release |
| Production | `last132` is not migrated by DRVO-003 or DRVO-004 unless a later human-approved issue says so. Staging database name remains `last132_agent` |
| Deploy | Merge to `main` deploys via `Deploy Casher to VPS`. These tasks do not merge themselves |

Level changes follow decision D14. DRVO-003 and DRVO-004 stay at LEVEL 1 for product modules. Outbox publish is in-process. Existing messaging workers are left as they are.

## 2. Not required before the first extraction

DRVO-004 does not wait for:

- a Booking or POS database
- a second tenant
- customer OTP
- POS extraction or sale-trigger removal
- Treasury becoming the exclusive ledger writer
- Messaging product extraction
- a Booking worker process
- slot-claim enforce mode
- retirement of every env flag

## 3. DRVO-003 — Platform Core Bootstrap

Goal: make the platform real enough that Booking can extract against ports, without changing salon behavior.

### 3.1 Deliverables

1. **Package skeleton** matching blueprint §7: `src/platform`, `src/shared/{customers,catalog,workforce,operational-calendar}`, `src/apps/{booking,queue,pos,inventory,purchasing,attendance,payroll,treasury,loyalty,messaging,ai-receptionist,reports,operations}`, `src/packs/salon`, `src/legacy`. Empty public entry points are acceptable. Do not move feature code in bulk.
2. **Import-boundary test** that fails if `platform` imports `shared`, `apps`, or `packs`; if an app imports another app; if a shared domain imports another shared domain; if a pack imports an app `internal` path. Include one fixture import that is expected to fail.
3. **Tenant and Location tables** plus `LegacyIdMap`, as in the boundary contracts. Staging migration only, database `last132_agent`.
4. **Bootstrap seed** on staging: one tenant; one location per `TblBranch` row; `branchCode` and `legacyBranchId` preserved. Tenant code is not `GLEEM`.
5. **Staff session adapter** adds `tenantId` of that bootstrap tenant and `membershipId` mapping from the current user. Authorization outcomes for current pages stay the same. Legacy `super_admin` is documented as tenant owner, and no platform-admin login is required for the salon to operate.
6. **Helpers** `tenantLockResource(tenantId, parts)` and `tenantCacheKey(tenantId, parts)` in platform. New code uses them. Existing applock call sites may stay until their own extraction.
7. **`PlatformOutbox` table and publisher** that inserts on the caller's `tx`. No new worker. A test rolls back the transaction and asserts the row is absent.
8. **App registry tables and salon manifest** under `src/packs/salon` listing the initial app codes. `operations` marked not separately entitled. **Enforcement off**, so no route disappears.
9. **Facades** with legacy adapters, no behavior change:
   - Customers over `TblClient`
   - Catalog over `TblPro` / `TblCat`
   - Workforce over `TblEmp` and assignments, including an occupancy port whose adapter still uses current applocks and busy-interval reads
   - Operational Calendar over current day/shift resolve and lock
   - Money Movement port whose adapter documents that sale create is still the trigger and does not add a second insert
10. **Unit of Work** wrapper around the existing SQL transaction helper.
11. **Docs note** in the DRVO-003 PR: staging only, enforcement off, trigger still live, no production migration.

### 3.2 Exit criteria

- Import-boundary test passes, and the forbidden fixture is proven to fail.
- On `last132_agent`, location row count equals `TblBranch` row count, and exactly one bootstrap tenant exists.
- A staff request in staging resolves that tenant id.
- Existing booking scheduling characterization tests pass.
- One existing POS or treasury characterization test passes, demonstrating sale behavior was not retargeted.
- Outbox rollback test passes.
- Registry contains the initial app codes and the salon manifest references only those codes plus the non-entitled operations surface.
- No connection to production database `last132`.
- No route removal and no change to who can open the current salon UI.
- `InsCashMoveSales` is not disabled.

DRVO-004 does not start until these exit criteria are true on `main` after a human merge.

### 3.3 Explicitly out of DRVO-003

- Moving booking engines
- Changing convert, POS posting, payroll, or nightly close
- Customer OTP
- Second tenant
- Enabling entitlement checks
- Production deploy or production migration

## 4. DRVO-004 — Booking Scheduling Extraction

### 4.1 Prerequisites

- DRVO-003 exit criteria met on `main`.
- Workforce occupancy port callable in-process with `tx`.
- `BookingConversion.createServiceInvoice` implemented by the POS legacy adapter.
- Outbox publisher available.
- Tenant lock and cache helpers available.
- Bootstrap tenant id available to booking commands.

### 4.2 Deliverables

1. Booking scheduling use cases live under `src/apps/booking` and are what new HTTP handlers call for hold, create, cancel, and reschedule.
2. Those use cases call Customers, Catalog, Workforce occupancy, and the outbox publisher. They do not contain SQL against `TblinvServHead`, `TblCashMove`, or `QueueTickets`.
3. Cross-location employee conflicts still fail closed, through the occupancy port.
4. Idempotency keys and BookingCode generation use the tenant namespace helpers for the bootstrap tenant.
5. Convert HTTP flow uses one Unit of Work and the conversion contract in boundary contracts §5.2: `خدمة` head and detail, booking `completed`, `ConvertedInv*` written, no payment, no loyalty, no cash post. Existing linkage returns the existing invoice. Allocation of the invoice id happens inside the transaction.
6. Scheduling package does not import `src/apps/pos`. The composition root wires the port.
7. Notification for the extracted events goes to `PlatformOutbox` only. The legacy notify row is not also written for those events.
8. Flow board may remain the legacy SQL adapter inside `src/apps/operations`. It is not rewritten unless required to compile against moved functions.
9. Slot-claim mode is unchanged. Claims are still not the occupancy authority.

### 4.3 What remains legacy after DRVO-004

- Physical tables `TblClient`, `TblEmp`, `TblPro`, `TblNewDay`, `TblShift`, `TblShiftMove`, `Bookings` storage, `TblCashMove`
- `InsCashMoveSales` and the POS sale create path
- Queue ticket commands
- Workforce adapter SQL that still reads booking and queue intervals
- Operations flow-board SQL adapter
- Customer phone-possession auth, now required to be tenant-scoped when the public path is touched
- Messaging product UI and existing workers
- Payroll, attendance, inventory, loyalty behavior
- A separate Booking process or database

### 4.4 Exit criteria

- Scheduling characterization tests for create, cancel, and reschedule pass, including a cross-location employee conflict.
- A conversion test shows that a thrown invoice insert leaves the booking uncompleted, and that a second convert does not create a second invoice.
- A package test fails if `src/apps/booking` imports `src/apps/pos` or references `TblinvServHead` / `TblCashMove`.
- Notification test shows one outbox row and no parallel legacy notify insert for that event.
- No production database access. Staging smoke on `last132_agent` only if a runtime path is exercised: create and cancel one booking on a non-production location fixture, then convert one booking and confirm a single `خدمة` invoice and a completed booking.
- POS sale characterization from DRVO-003 still passes (trigger path untouched).

### 4.5 Explicitly out of DRVO-004

- Queue extraction
- POS or Treasury cutover
- The conversion saga
- LEVEL 2 Booking runtime
- LEVEL 4 anything
- Turning entitlement enforcement on
- Admitting a second tenant

## 5. Second-tenant gate (not a scheduled task)

A later issue may admit tenant two only after all of the following are already true:

- Unique keys that DRVO-001 listed as global include `TenantId` (BookingCode, idempotency, applocks in use, queue codes).
- Repositories used by enabled routes predicate `tenantId`.
- Workers claim by tenant.
- Webhook channel accounts map to a tenant.
- An automated test with two tenants shows no read or lock bleed.
- Customer auth no longer trusts a bare numeric `ClientID`.

Until that issue, seed scripts must refuse to insert a second `Tenant` row.

## 6. Rollback

| Stage | Rollback |
|-------|----------|
| DRVO-003 | Enforcement is already off. Revert the session claim only if it breaks login. Leave empty registry tables. Do not point writes at a new store that does not exist yet |
| DRVO-004 | Feature flag `booking.scheduling.port` (tenant setting, default on after exit). Off routes handlers to the previous `src/lib/booking` path. Conversion flag off uses the previous convert route body. Do not drop `Bookings` or invoices |

Flags are tenant settings with a deployment default, per decision D11.

## 7. Cross-document consistency checklist

Verified while writing DRVO-002. Reviewers can re-check by searching the four files for the canonical list.

| Topic | Agreed statement |
|-------|------------------|
| Tenancy topology | shared database / shared schema |
| Identity model | platform admin, tenant staff user, customer/end user, service/integration identity |
| Boundaries | Platform Core, Shared Domains (Customers, Catalog, Workforce, Operational Calendar), Independent Apps, Industry Packs. Salon Pack is a recipe |
| Extraction levels | Booking scheduling first phase LEVEL 1. Medium-term LEVEL 3 on the shared database. LEVEL 4 is not a medium-term target for Booking or POS |
| Day/Shift owner | Shared Domain Operational Calendar |
| CashMove owner | Treasury app, through the Money Movement posting API |
| Booking conversion | One shared SQL transaction while co-located. Saga only when a shared transaction is impossible. Bare dual-call forbidden. POS owns the invoice. Booking owns completion and linkage |
| Scheduling conflicts | Workforce Shared Domain. Tenant-global per employee. Booking and Queue are claimants |
| Events | Platform Core outbox. Messaging/WhatsApp is not the bus |
| Sequence | DRVO-003 Platform Core Bootstrap, then DRVO-004 Booking Scheduling Extraction |

## 8. Completion of DRVO-002

| Check | Result |
|-------|--------|
| STATUS | PASS |
| TENANCY DECIDED | YES |
| DAY_SHIFT OWNER DECIDED | YES |
| CASHMOVE OWNER DECIDED | YES |
| BOOKING CONVERSION CONTRACT DECIDED | YES |
| SCHEDULING CONFLICT AUTHORITY DECIDED | YES |
| APP / SHARED / PACK BOUNDARIES DECIDED | YES |
| EXTRACTION LEVELS ASSIGNED | YES |
| DRVO-003 DEFINED | YES |
| DRVO-004 DEFINED | YES |
| CROSS-DOC CONSISTENCY | PASS |
| Application code or schema changed by DRVO-002 | NO |
| READY FOR PR REVIEW | YES |
| READY FOR DRVO-003 | YES, as a decision baseline. DRVO-003 still needs its own issue, human execution, and human merge |

Open items marked **NEEDS RUNTIME VERIFICATION** in the decision register (trigger enablement, `خدمة` reporting treatment, slot-claim mode, invoice allocator scope, worker uptime) do not block DRVO-003. They must be re-checked before the Treasury cutover and before anyone treats slot claims as authority.
