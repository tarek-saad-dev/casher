# DRVO-002 — Decision Register

| Field | Value |
|-------|-------|
| Document | `DRVO-002-DECISION-REGISTER` |
| Issue | https://github.com/tarek-saad-dev/casher/issues/7 |
| **Decided against Git HEAD** | `9dcb83e` |
| Evidence baseline | DRVO-001 audited SHA `f5e43773545d25467af7b302b974191418a3f8dd` |
| Authority | Decision records. Narrative map: [PLATFORM-BLUEPRINT](./DRVO-002-PLATFORM-BLUEPRINT.md). Ports: [BOUNDARY-CONTRACTS](./DRVO-002-BOUNDARY-CONTRACTS.md). Sequence: [IMPLEMENTATION-ROADMAP](./DRVO-002-IMPLEMENTATION-ROADMAP.md). |

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

## D1 — Platform boundary and runtime shape

**DECISION.** DRVO is a modular monolith: Platform Core + Shared Domains + Independent Apps + Industry Packs, one deployment, one database, until a level gate in the blueprint is met. Dependency direction is pack → app → shared → platform. Apps do not import each other. Shared domains do not import each other. Cross-app calls happen only through a public port wired at the composition root, or through the platform outbox.

**RATIONALE.** Casher is already one Next.js process and one SQL Server database (`src/lib/db.ts`, no separate ORM). Correctness for sales, conversion, and booking conflicts is a SQL transaction plus SQL locks (EXTRACTION-AUDIT §§15–18). A microservice split would break those invariants before replacement contracts exist. Messaging workers are already separate processes for delivery only; that pattern is the exception, not the template.

**CURRENT LEGACY CONSTRAINT.** Domain logic lives in `src/lib` and uneven `src/modules`. `src/app` is both UI and a large route surface. There is no tenant module and no app registry.

**REJECTED / DEFERRED ALTERNATIVES.**

- Microservices as the starting shape. Deferred until LEVEL 2 gates. Rejected as the default.
- Putting day/shift, cash, or customers inside Platform Core. Rejected. Core would become the salon monolith under a new name.
- A salon-specific repository fork. Rejected. Industry behavior is a pack.

**MIGRATION IMPACT.** DRVO-003 adds package boundaries around existing code. Behavior stays in place behind adapters. No process split for Booking in DRVO-004.

**RISKS.** Facade-only folders that still call `src/lib` SQL of another domain. The import lint in DRVO-003 is the control.

**VALIDATION / OPEN QUESTIONS.** None for the shape. Worker process list on the salon host is **NEEDS RUNTIME VERIFICATION** and does not change the decision.

## D2 — Extraction levels

**DECISION.** Use the DRVO-001 LEVEL 1–5 vocabulary. Assign the targets in the blueprint level table. Booking scheduling's first extraction phase is LEVEL 1. Its medium-term target is LEVEL 3 on the shared database. LEVEL 2 runtime for Booking is deferred. LEVEL 4 is not a medium-term target for Booking or POS. LEVEL 5 packaging can sit on LEVEL 1 modules. Entitlement is not a database split.

**RATIONALE.** DRVO-001 showed Booking scheduling is cohesive enough to wrap, and also showed global emp applocks, global BookingCode, global idempotency keys, and shared Client/Emp/Pro. That evidence supports a module boundary. It does not support an independent Booking database.

**CURRENT LEGACY CONSTRAINT.** Typical code is an informal LEVEL 1 at best. Messaging and AI workers are already LEVEL 2 runtimes with shared tables. Nothing is LEVEL 3, 4, or 5.

**REJECTED / DEFERRED ALTERNATIVES.**

- Treating "extract Booking" as LEVEL 4. Rejected for the medium term.
- Assigning no level. Rejected. DRVO-001 deferred this on purpose.
- Raising POS to LEVEL 2 before the posting contract replaces `InsCashMoveSales`. Deferred until Treasury cutover.

**MIGRATION IMPACT.** DRVO-004 stops at LEVEL 1. Later tasks move a module to LEVEL 3 by becoming the exclusive writer, still on the shared database.

**RISKS.** A later task upgrades a level in a diagram without meeting the gate. The roadmap gates are mandatory.

**VALIDATION / OPEN QUESTIONS.** None.

## D3 — Tenant model

**DECISION.** Initial topology is **shared database / shared schema**. `TenantId` is a required column namespace on tenant-owned rows. The current Casher database seeds as one bootstrap tenant. Locations are the successor of `TblBranch`, many per tenant. `SalonID` is not TenantId. Cookie and `BranchID` are not tenant isolation.

Namespace rules (normative detail in boundary contracts):

| Concern | Rule |
|---------|------|
| Row identity | New public ids are tenant-scoped. Legacy ints live in a map `(tenantId, entity, legacyId)` |
| Uniqueness | Composite unique keys include `TenantId` |
| BookingCode | Unique per `(TenantId, BookingCode)` |
| Idempotency keys | Unique per `(TenantId, scope, key)` |
| Applocks | Resource string starts with `t:{tenantId}:` |
| Caches | Key prefix `t:{tenantId}:`. Cache is not correctness |
| Background jobs | Claim query includes `TenantId`. Worker memory holds one tenant at a time |
| Webhooks | Provider account resolves to one tenant. Correlation id contains `tenantId` |
| Auth/session | Staff and customer sessions carry `tenantId`. Platform admin does not |
| Secrets | Deployment secrets in env. Integration secrets keyed by tenant |

**RATIONALE.** One salon database is the verified current state. Shared schema matches a modular monolith and the rule that extraction is not a new database. Schema-per-tenant or database-per-tenant would multiply raw T-SQL, triggers, and applocks before a second customer exists.

**CURRENT LEGACY CONSTRAINT.** No `TenantId` anywhere in `src/` at the DRVO-001 audit. Global unique keys include `UX_Bookings_BookingCode`, public booking idempotency keys, and emp applock strings `booking:emp:{empId}:…`. Queue ticket uniqueness is already per branch and date. CUT Club `SalonID` is nullable and unused as a tenant key.

**REJECTED / DEFERRED ALTERNATIVES.**

- Database per tenant. Deferred until a LEVEL 4 decision for a specific store. Rejected as the initial topology.
- Schema per tenant. Rejected for the initial topology. Same migration cost, weaker shared-contract story.
- Treating `TblBranch` or `SalonID` as the tenant. Rejected.

**MIGRATION IMPACT.** DRVO-003 creates one tenant and a location row per branch. Existing queries keep working because they still run inside that one tenant. A second tenant cannot be inserted until the roadmap namespace gate passes. Production database `last132` is out of scope for every DRVO task unless a later issue explicitly says otherwise; this decision does not say otherwise.

**RISKS.** A global unique index left in place will collide on tenant two. The second-tenant gate exists for that reason. Integer ids collide across tenants if reused; the legacy map forbids that.

**VALIDATION / OPEN QUESTIONS.** Whether `allocateInvID` is already per branch is **NEEDS RUNTIME VERIFICATION**. The architecture rule is still: invoice identity is unique inside the tenant, and the legacy composite is stored in the tenant's map.

## D4 — Identity and authorization

**DECISION.** Four identities, four authenticators, no shared cookie:

1. **Platform admin** — operates the control plane. Not a member of a tenant by default. Impersonation of a tenant is an audited, explicit tenant argument.
2. **Tenant staff user** — membership in one tenant, location grants (view and operate), tenant-scoped RBAC. Legacy HMAC `pos_session` is the staff adapter for the bootstrap tenant.
3. **Customer / end user** — profile owned by Customers, authenticator owned by Platform. Target proof is a customer session (OTP or equivalent). Legacy phone match and `bookingAccessToken` are a named adapter, tenant-scoped, and are not staff RBAC.
4. **Service / integration identity** — non-human credential for workers, cron, and channel webhooks. Carries a tenant job context. Does not use the staff cookie.

Legacy `super_admin` becomes the bootstrap tenant owner role, not a platform admin.

Financial and other sensitive writes additionally require the Operational Calendar gate and, where the legacy audited-action wrapper applies, a reason recorded in the platform audit sink.

**RATIONALE.** EXTRACTION-AUDIT §16 separates staff RBAC, branch ACL, day/shift gates, internal bearer tokens, and public possession checks. Collapsing them into one cookie cannot survive a second tenant or a real customer account. DRVO-001 §16.3 already records that public client routes have no meaningful ownership proof beyond a numeric id or a phone string.

**CURRENT LEGACY CONSTRAINT.** Staff: HMAC cookie, page ACL, `TblUserBranchAccess`, `resolveBranchDayAndShiftForWrite`. Public booking: anonymous create, phone possession, HMAC access token without tenant claims. Internal: `CRON_SECRET` and WhatsApp bearer. Passwords in the legacy user model are a known adaptation item, not redesigned in DRVO-003.

**REJECTED / DEFERRED ALTERNATIVES.**

- One user table for staff and customers. Rejected. Different lifecycle, different threat model.
- Promoting salon `super_admin` to platform admin. Rejected.
- Keeping phone possession as the long-term customer auth. Rejected as the target. Kept as a migration adapter.
- Customer OTP inside DRVO-003 or DRVO-004. Deferred. Not required for first scheduling extraction.

**MIGRATION IMPACT.** DRVO-003 adds `tenantId` to the staff session claim for the bootstrap tenant and does not change who can operate the current salon. Public token minting, when touched, must include `tenantId`. Service jobs stamp the bootstrap tenant on rows they write.

**RISKS.** Numeric `UserID` / `ClientID` / `BranchID` authorization after a second tenant. Repository tenant predicates are mandatory, not optional filters in the UI.

**VALIDATION / OPEN QUESTIONS.** Password hashing upgrade is deferred product work. No runtime fact blocks this decision.

## D5 — Shared domain contracts

**DECISION.**

| Domain | Canonical owner | Key | Write authority | Read contract | Snapshot rule | Legacy map | Scope |
|--------|-----------------|-----|-----------------|---------------|---------------|------------|-------|
| Customers | Shared Domain Customers | `CustomerId` | Customers commands only, including phone upsert used by Booking and POS | `getById`, `findByPhone(tenantId, phone)` | Apps may copy name and phone onto their own documents with a source version. They do not update the profile | `(tenantId, ClientID) → CustomerId` | Tenant. A customer is not owned by a location |
| Workforce | Shared Domain Workforce | `EmployeeId` | Workforce commands for master, assignment, transfer, schedule, day off, override. Occupancy commands from claimants through the occupancy port | Employee, eligibility at a location, availability projection | Apps copy display name. Eligibility is re-read at write time | `(tenantId, EmpID) → EmployeeId` | Identity is tenant-wide. Assignment is per location. Occupancy is tenant-wide per employee |
| Catalog | Shared Domain Catalog | `CatalogItemId` | Catalog commands for items, categories, packages, execution-step definitions, base price | Item, sellable list, price for a location | Invoice and booking lines snapshot name, price, and duration at write time. Later catalog edits do not rewrite history | `(tenantId, ProID or CatID) → CatalogItemId` | Tenant. Location price overrides are a later catalog feature. Today's global price is the tenant price |

Stock quantity is Inventory, not Catalog. Loyalty balance is Loyalty, not Customers. Payment method definitions are Treasury reference data, not Catalog.

**RATIONALE.** These three masters are the global identities every app already joins (DOMAIN-MAP, DEPENDENCY-GRAPH §1). One writer each prevents POS and Booking from both updating `TblClient` or `TblEmp` with different rules.

**CURRENT LEGACY CONSTRAINT.** `TblClient`, `TblEmp` plus assignment tables, `TblPro` / `TblCat` / packages. Phone uniqueness and price are global in a one-database sense. `TblPro` mixes services and stockable products.

**REJECTED / DEFERRED ALTERNATIVES.**

- Booking owns a private customer table. Rejected.
- Catalog owns stock on-hand. Rejected. Branch inventory is a different aggregate.
- Splitting service vs product identity in DRVO-003. Deferred. The map can record a type flag. The table split is not a bootstrap deliverable.

**MIGRATION IMPACT.** DRVO-003 introduces facades over the current tables. DRVO-004 scheduling calls Customers, Workforce, and Catalog ports instead of ad hoc SQL in new code. Old SQL may remain inside the legacy adapter until LEVEL 3.

**RISKS.** Duplicate phones inside one tenant. The Customers command remains the only upsert.

**VALIDATION / OPEN QUESTIONS.** Production edge cases for an employee working two locations on one date are **NEEDS RUNTIME VERIFICATION** (DRVO-001 §6.2). Ownership is still Workforce. The occupancy rule stays tenant-global per employee either way.

## D6 — Scheduling and conflict authority

**DECISION.** Workforce Shared Domain is the authority for employee occupancy. Booking and Queue are claimants. They do not lock each other's tables.

The authority covers:

- employee occupancy across locations
- booking conflicts
- queue conflicts
- cross-location employee conflicts
- the commit-time assert that replaces "re-read Bookings and QueueTickets" once occupancy rows exist
- lock acquisition for reschedule

Booking still owns its hold token UX and its optional slot-claim rows. A hold that must block an employee also takes a Workforce occupancy hold. Slot claims are not the authority. While `BOOKING_V2_SLOT_CLAIMS_MODE` is off or shadow, the authority is the tenant-scoped applock plus the in-transaction assert. That matches verified current behavior.

Reschedule is one transaction: lock old and new employee intervals, assert the new interval, update the booking, swap occupancy. Release-first is forbidden.

Idempotency of create, cancel, and reschedule stays with Booking, tenant-scoped.

**RATIONALE.** `EMPLOYEE_GLOBAL_CONFLICT` and `empIntervalLockResource` are cross-branch on purpose (DEPENDENCY-GRAPH §6). If Booking owned the lock, Queue could double-book the same employee, and a later Booking database could not see Queue. One workforce authority is the replacement for the global applock.

**CURRENT LEGACY CONSTRAINT.** Applock resource `booking:emp:{empId}:{start}:{end}` has no tenant prefix. Busy-interval SQL reads both bookings and queue tickets inside the booking transaction. Slot-claim unique index is feature-flagged and default off (EXTRACTION-AUDIT §17).

**REJECTED / DEFERRED ALTERNATIVES.**

- Booking remains the owner of employee locks. Rejected.
- A separate lock microservice in DRVO-004. Deferred. Same-database applocks behind the Workforce port meet LEVEL 1.
- Turning slot claims on as part of this decision. Rejected. Production mode is unverified, and the audit forbids treating claims as authority while the flag is off.

**MIGRATION IMPACT.** DRVO-004 routes scheduling locks through the Workforce port. The first adapter may still read legacy booking and queue tables from inside Workforce only. New Booking code does not query `QueueTickets`.

**RISKS.** Two writers if a path forgets the port and takes the old applock. Import and code review for DRVO-004 should ban new `sp_getapplock` call sites outside Workforce.

**VALIDATION / OPEN QUESTIONS.** Production claims mode and stale-hold cleanup cadence are **NEEDS RUNTIME VERIFICATION**. The decision does not depend on them. Claims stay non-authoritative until a later issue verifies enforce mode and still subordinates them to Workforce occupancy.

## D7 — Booking boundary and conversion

**DECISION.** Keep the four bundles.

| Bundle | Target level in DRVO-004 | Owner |
|--------|--------------------------|-------|
| A Scheduling | LEVEL 1, medium-term LEVEL 3 on the shared database | Booking |
| B Commercial conversion | Stays a POS capability behind a port. LEVEL 1 shared transaction | POS for the invoice, Booking for completion and linkage |
| C Composition | LEVEL 1 BFF | Operations |
| D Notifications | LEVEL 1 outbox emit | Booking emits, Messaging delivers |

Conversion contract:

- POS creates the invoice (`invType = خدمة`, head and detail, no payment rows, no loyalty, no cash posting).
- Booking writes `Status = completed` and `ConvertedInvID` / `ConvertedInvType` (and the future invoice reference).
- The composition root runs both inside one platform Unit of Work. Rollback undoes both.
- If linkage already exists, the result is the existing linkage (conflict), not a second invoice.
- Invoice id allocation happens inside that transaction.
- Day/shift financial gate runs before the invoice insert.

When a future boundary makes a shared SQL transaction impossible, the only allowed replacement is the orchestrated saga in the boundary contracts: `conversion_pending`, one invoice, completion retried idempotently, compensation that returns the booking to its prior status if the invoice is terminally refused. DRVO-004 does not implement that saga.

A bare dual-call is forbidden.

**RATIONALE.** DRVO-001 §6.3 and §19 verified one SQL transaction for head, detail, and booking completion, and verified that `خدمة` does not match `InsCashMoveSales`. Scheduling can move to a module now. Splitting that transaction without a protocol was the hazard DRVO-001 handed over. Keeping the transaction, and hiding invoice SQL behind a port, gives a real module boundary without a consistency regression.

**CURRENT LEGACY CONSTRAINT.** `POST /api/bookings/[id]/convert` performs the gate, the invoice insert, and the booking update. Idempotency is "already converted → 409". There is no convert request table. `allocate` of `invID` outside the transaction is a known race to close when the port is built. Loyalty and WhatsApp are not part of this route.

**REJECTED / DEFERRED ALTERNATIVES.**

- Move conversion into the scheduling extract as one blob. Rejected.
- Leave conversion as an unscoped HTTP call from a future Booking service. Rejected (bare dual-call).
- Implement the saga in DRVO-004. Deferred until a runtime split exists.
- Post cash or take payment inside conversion. Rejected. That is not current behavior and is not required for scheduling extraction.

**MIGRATION IMPACT.** DRVO-004 removes invoice SQL from the scheduling package. The convert route's observable result stays the same on the monolith.

**RISKS.** A partial commit if a developer "simplifies" the port into two requests. Tests specified in the roadmap must fail that shape.

**VALIDATION / OPEN QUESTIONS.** How treasury and reports treat `خدمة` invoices on the live database is **NEEDS RUNTIME VERIFICATION**. The contract still posts no cash for conversion, matching the trigger body in-repo.

## D8 — Day / Shift ownership

**DECISION.** Shared Domain **Operational Calendar** owns business day, shift definition, and shift instance. It is not Platform Core, not Workforce, not POS, not Treasury, and not the Salon Pack.

Write authority: only Operational Calendar commands open or close a day or a shift.

Read contract: any app may ask whether a location is open on a business date and whether an actor has an open shift.

Financial-write gate: `resolveFinancialWriteContext(actor, requestedLocation)` returns tenant, location, business day, optional shift instance, and scope.

- Open shift → scope `SHIFT`, location is the shift's location. The view-location cookie is ignored.
- No open shift → scope `DAY`, location is a location the actor may operate.

Treasury recon writes recon rows and calls calendar close in the same transaction. Calendar refuses a second close.

Relationship: a business day belongs to one Location. The location's timezone defines the business date. Payroll and attendance use that business date as `WorkDate`. They do not own `TblNewDay`.

Impact:

| Consumer | Effect |
|----------|--------|
| POS | Must take a gate context before invoice writes |
| Treasury | Owns money and recon. Closes the calendar through the calendar command |
| Booking conversion | Same financial gate as POS, inside the conversion transaction |
| Booking scheduling | May read business date and location hours. Does not open or close a day |
| Payroll | Reads closed-day facts and WorkDate. Posts cash through Treasury when it posts cash |
| Attendance | Owns attendance rows. Aligns WorkDate to the location business date |
| Operations BFF | Reads day state for the floor. Does not mutate it except by calling calendar commands from explicit admin actions |

**RATIONALE.** Day and shift are cashier and financial primitives used by more than one app, including a future tenant that runs Booking without POS. That eliminates POS as owner and Workforce as owner. They are business documents with open/close lifecycle, so they are a poor fit for Platform Core identity services. The salon pack may set cutoff policy and labels. It does not own the row. This is the shared operational domain option, with an explicit name so POS and Treasury do not both think they own it.

**CURRENT LEGACY CONSTRAINT.** `TblNewDay` per branch, `TblShift` name catalog, `TblShiftMove` per user and branch, `resolveBranchDayAndShiftForWrite` in `operationalGates.ts`. Operations module already has day/shift lock and mutation transactions. Registry markers list sales, expenses, incomes, deductions, purchases, treasury transfer, and booking convert as financial writers that must resolve the gate.

**REJECTED / DEFERRED ALTERNATIVES.**

- Platform Core owns day/shift (audit candidate A). Rejected. Dumping ground, and hard to vary per industry.
- Workforce owns day/shift (candidate B). Rejected. Does not fit cashier shift cash or recon.
- POS or Operations app owns day/shift (candidate C). Rejected as owner. Operations may display it. A booking-only tenant still needs a business date.
- Salon industry extension owns the identity (candidate D). Rejected. Pack may own policy and UX copy only.
- Leaving ownership undecided. Rejected. DRVO-001 required this choice.

**MIGRATION IMPACT.** DRVO-003 places a facade over the existing operations day/shift services. Table names may stay until a later migration. New financial code calls the gate port.

**RISKS.** Two close paths if Treasury still updates `TblNewDay` directly. After the facade, close SQL lives in Operational Calendar only.

**VALIDATION / OPEN QUESTIONS.** None for ownership. Exact production timezone source per branch is **NEEDS RUNTIME VERIFICATION** and is a location field either way.

## D9 — Money movement / CashMove

**DECISION.** The Treasury app is the canonical money-movement domain. `TblCashMove` semantics become the Treasury ledger. Platform Core does not own the ledger. POS, Payroll, and other apps do not insert ledger rows.

Treasury exposes `post` and `reverse`, both idempotent, both able to enlist in the caller's SQL transaction while co-located.

Covered movements: sale cash, split payment parts, tips, expenses, incomes, deductions, transfers, payroll postings to cash. Each carries a source reference and a tenant-scoped idempotency key.

Reconciliation documents stay in Treasury. Closing the day or shift is the Operational Calendar command, called in the same transaction as the recon write.

Relationship to invoices: creating an invoice does not implicitly create cash. Posting is a Treasury command. The current trigger is a legacy implementation of that command for specific sale types only.

Cutover from `InsCashMoveSales`:

- Until cutover, the trigger remains the sale-create poster for matching `مبيعات` types, inside the sale transaction.
- The cutover release switches sale create to `post` inside that same transaction and drops or disables the trigger in the same release.
- Running both is forbidden.
- Sale update and sale delete must use `reverse` and `post`, including split parts. The unused `reverseSplitPaymentTransfers` gap is closed at cutover, not by a second writer.
- Booking conversion does not call `post`.

Atomicity that must survive while co-located: invoice head, detail, payment, stock movement, cash post, and split parts, one transaction. Loyalty earn stays post-commit and is not part of that atomic set.

**RATIONALE.** CashMove is the hub for treasury UI, reports, ledger foreign keys, and the sale trigger (DEPENDENCY-GRAPH §2, EXTRACTION-AUDIT §15). The product already thinks of this as treasury. Putting the ledger in Platform Core repeats the dumping-ground failure mode. Leaving POS as a second writer of the same table is the trigger problem. One posting API preserves the current same-transaction guarantee without a database split.

**CURRENT LEGACY CONSTRAINT.** Application writers insert CashMove for expenses, incomes, deductions, tips, payroll, transfers, and splits. Sale create relies on `InsCashMoveSales` AFTER INSERT. Sale update rewrites CashMove in application code. The trigger does not fire on update. Conversion `خدمة` does not match the trigger. Production enablement of the trigger was not executed by DRVO-001.

**REJECTED / DEFERRED ALTERNATIVES.**

- Platform ledger primitive as the owner. Rejected. Treasury is the product owner. The API is still a stable port other apps can call.
- A new Accounting app as owner in this phase. Rejected. Classification maps stay in Reports. They label entries. They do not post them.
- POS keeps writing CashMove forever. Rejected as the target. POS calls `post`.
- Remove the trigger in DRVO-003 or DRVO-004. Deferred to the POS/Treasury cutover. Scheduling extraction does not need it.
- Database-per-app before the posting port is exclusive. Rejected.

**MIGRATION IMPACT.** DRVO-003 publishes the port and a legacy adapter that documents trigger coexistence. It does not change sale posting. Later POS work performs the single cutover release.

**RISKS.** Double cash if trigger and `post` both run. The cutover rule is the mitigation. Idempotency keys must include the source document so retries do not duplicate.

**VALIDATION / OPEN QUESTIONS.**

- Trigger enabled on the live server, and whether its body matches `db/migrations/add-financial-branch-ownership.sql`: **NEEDS RUNTIME VERIFICATION**. Ownership does not wait on that probe.
- Full void parity for triggered rows: **NEEDS RUNTIME VERIFICATION**. `reverse` is still the target API.
- This decision was made from in-repo evidence. No staging query was run, because the owner is decidable without it and this task must not touch production `last132`.

## D10 — Events, outbox, jobs

**DECISION.** Platform Core owns the transactional outbox and the worker rules. Domain modules emit past-tense events in the same transaction as their aggregate write. Delivery is at-least-once. Consumers are idempotent on `(tenantId, consumerName, eventId)`. Retry with backoff, then a dead-letter row, then explicit replay. Webhook correlation ids include `tenantId`.

Worker claims include `TenantId` in the predicate. A process may loop tenants. It may not hold two tenants' rows in one in-memory batch that shares mutable context. There is no process-global "current tenant".

Scheduler ownership: the module that owns the aggregate owns the job definition (payroll owns nightly payroll steps, calendar owns day reconcile, messaging owns send). Platform owns claim, lease, and dead-letter mechanics.

Messaging/WhatsApp is a product app. It is a consumer of domain events and an owner of conversation documents. It is not the bus. Booking notification moves from post-commit `after()` and `TblBookingNotifyRequest` (no reclaim worker) onto the outbox. A failed WhatsApp send does not undo the booking.

**RATIONALE.** DRVO-001 separated outbox infrastructure from the WhatsApp product and showed booking notify can orphan a `sending` row. A platform outbox gives every app the same retry story. Tenant-scoped claims prevent a worker from applying Tenant A templates to Tenant B messages in one drain loop.

**CURRENT LEGACY CONSTRAINT.** `TblMessageOutbox` / `Inbox` use global UPDLOCK READPAST. Nightly close has no lease. Booking notify has no reclaim. Several jobs are global drains (EXTRACTION-AUDIT §20).

**REJECTED / DEFERRED ALTERNATIVES.**

- The Messaging module remains the only outbox. Rejected.
- Extracting the full WhatsApp app before Booking scheduling. Rejected. DRVO-001 already classed notify as adapter-safe.
- Exactly-once delivery. Rejected as a promise. Idempotent consumers are the contract.
- A new broker in DRVO-003. Deferred. A SQL outbox table in the same database matches the monolith.

**MIGRATION IMPACT.** DRVO-003 adds `PlatformOutbox` and an in-process publisher. Existing messaging tables keep working. DRVO-004 emits booking events. The legacy sender may be the first consumer adapter.

**RISKS.** Dual notification if both `after()` and the outbox send. DRVO-004 must switch a given event to one path.

**VALIDATION / OPEN QUESTIONS.** Whether inbox and outbox workers are always on in production is **NEEDS RUNTIME VERIFICATION**. The ownership decision stands.

## D11 — Configuration model

**DECISION.** Configuration sits at platform, tenant, location, app, industry pack, or environment secret, as listed in the blueprint. Business rules do not live in process env. Deployment secrets do not live in tenant tables in plaintext in git.

Named hazards and their target:

| Hazard | Target |
|--------|--------|
| Global env flags such as `BOOKING_V2_*` | Tenant or location setting. Env may hold a deployment kill-switch default only |
| Filesystem JSON such as partner overrides | Database rows owned by Reports config |
| Hardcoded `GLEEM` and salon constants | Location lookup by code inside the tenant. Pack templates for salon defaults |
| Process-memory caches | Tenant prefix. Never the correctness path |
| Local printer and WhatsApp on `127.0.0.1` | Location or tenant integration record. Loopback is a single-deployment default, not a platform assumption |

**RATIONALE.** EXTRACTION-AUDIT §21 lists these as multi-tenant runtime hazards. A shared monolith process will bleed flags and caches across tenants the moment a second tenant shares the process.

**CURRENT LEGACY CONSTRAINT.** Env flags, `data/partners-employee-overrides.json`, `PUBLIC_BOOKING_OPS_CONTROLLABLE_BRANCH='GLEEM'`, `__pos_*` caches, local print agent, WhatsApp bot default host.

**REJECTED / DEFERRED ALTERNATIVES.**

- One global settings document per deployment. Rejected.
- Rewriting every flag in DRVO-003. Deferred. New code follows the model. Legacy flags stay until the module that owns them is extracted.

**MIGRATION IMPACT.** DRVO-003 introduces the settings tables' home and does not bulk-migrate every flag. DRVO-004 scheduling reads tenant-scoped settings through the port when it needs a flag that affects correctness.

**RISKS.** A kill-switch env and a tenant setting disagree. Precedence is: tenant setting if present, otherwise deployment default.

**VALIDATION / OPEN QUESTIONS.** `.env.example` completeness vs code is a known audit note. No secret values are copied into this decision.

## D12 — App registry, entitlements, packs

**DECISION.** Platform App Registry lists each app: code, required shared domains, required peer apps, permission catalog, config schema. `TenantApp` is the entitlement: installed, enabled, or disabled per tenant.

Enable fails if a required app or shared domain is disabled. Disable rejects new commands and keeps historical reads. Disable does not drop tables.

Feature availability is entitlement and RBAC permission.

Salon Pack is a manifest that enables Booking, Queue, POS, Inventory, Purchasing, Attendance, Payroll, Treasury, Loyalty, Messaging, AI Receptionist, and Reports, and that installs salon roles, the operations floor dashboard, templates, and the CUT Club extension. Operations BFF is implied by the floor dashboard and is not its own SKU.

Future Retail or Hotel packs are new manifests over the same apps. They are not forks and not new copies of Booking or POS.

**RATIONALE.** Subscriptions are absent today (DOMAIN-MAP). A registry with enforcement off lets DRVO-003 exist without hiding the current salon UI. Packs are how industry differences stay out of `if (salon)` inside apps.

**CURRENT LEGACY CONSTRAINT.** Navigation is `nav-config.ts`. Page ACL is global. No install lifecycle. CUT Club uses a nullable `SalonID`.

**REJECTED / DEFERRED ALTERNATIVES.**

- Enforcement on in DRVO-003. Rejected. It would change production behavior before entitlements are proven.
- A separate commercial microservice for billing. Deferred. LEVEL 5 is a table and a manifest first.
- Forking the repo per industry. Rejected.

**MIGRATION IMPACT.** Bootstrap tenant is marked enabled for the salon manifest. Routes stay mounted.

**RISKS.** Pack code slowly absorbing app logic. Import rules forbid packs from copying app internals. Packs call public ports and register templates.

**VALIDATION / OPEN QUESTIONS.** None.

## D13 — Repository and module rules

**DECISION.** Layout and rules in blueprint §7 are normative.

- Import direction: `src/app` and process bootstrap may wire ports. `platform` imports none of the product layers. `shared` imports platform public only. `apps` import platform and shared public only. `packs` import public extension points only. `legacy` adapters may import current `src/lib` until removed.
- New domain code does not import another domain's `src/lib` SQL module.
- SQL ownership follows the table owner. Cross-app SQL is forbidden in the target. Two named strangler exceptions: Workforce occupancy adapter reads of booking and queue intervals, and Operations BFF flow-board SQL. Both expire at LEVEL 3 of the relevant readers.
- Public commands and queries are the API. Events are versioned, include `tenantId`, and name an idempotency key.
- Migrations live with the owning module. Coordinated `TenantId` backfill is a platform migration reviewed with each owner. An app does not `ALTER` another app's table.

**RATIONALE.** DRVO-001 §8 and §10 show direct cross-domain SQL as the extraction hazard. Package rules are the practical form of the dependency direction for the next implementation phase.

**CURRENT LEGACY CONSTRAINT.** `loadFlowBoardForBranch.ts`, nightly close, ledger dual-write, and booking engines join shared tables freely.

**REJECTED / DEFERRED ALTERNATIVES.**

- A big-bang move of `src/lib` into the new tree in DRVO-003. Rejected. Skeleton plus lint, then strangler.
- Allowing cross-app SQL "temporarily" with no named exception. Rejected. Unnamed exceptions become the architecture.

**MIGRATION IMPACT.** DRVO-003 adds the tree and a failing test for illegal imports. Existing `src/lib` remains legal only from `src/legacy` and from files not yet moved.

**RISKS.** Lint gaps around dynamic imports. The DRVO-003 test should include one static forbidden import fixture.

**VALIDATION / OPEN QUESTIONS.** None.

## D14 — Migration strategy and next sequence

**DECISION.** Casher continues as the running monolith. Adapters are the anti-corruption layer. The shared database remains the store through DRVO-004. Source of truth stays the legacy table until a module's own exit criteria switch writers. Dual-read is allowed for composition shadow. Dual-write of financial facts to two stores is forbidden. Canary for the single salon is a location or a tenant setting flag, not a forked deployment. Rollback is the flag back to the legacy adapter. Tables are not dropped in the cutover release.

Level moves:

| Move | Condition |
|------|-----------|
| Stay at LEVEL 1 | Default for DRVO-003 and DRVO-004 |
| LEVEL 1 → 2 | Blueprint LEVEL 2 gate |
| LEVEL 2 → 3, or LEVEL 1 → 3 directly | Exclusive writer, callers on ports, same database allowed |
| LEVEL 3 → 4 | Blueprint LEVEL 4 gate, plus a new explicit decision |

Not required before the first extraction (DRVO-004): second database, second tenant, customer OTP, POS extraction, Treasury trigger removal, Messaging app extraction, Booking LEVEL 2 or LEVEL 4.

**Next sequence, and no further roadmap in this decision:**

1. **DRVO-003 — Platform Core Bootstrap**
2. **DRVO-004 — Booking Scheduling Extraction**

Deliverables, exit criteria, prerequisites, and what stays legacy are in [IMPLEMENTATION-ROADMAP](./DRVO-002-IMPLEMENTATION-ROADMAP.md).

**RATIONALE.** MIGRATION-ORDER §A and §B1 already pointed at platform scaffolding then Booking scheduling bundle A. This decision adopts that order and closes the ownership questions that blocked it. Expanding into POS, payroll, and hotel packs here would pretend those extractions are designed. They are not. They wait until these two stages exist.

**CURRENT LEGACY CONSTRAINT.** Single deployment, single database, trigger-backed sales, global locks, no tenant.

**REJECTED / DEFERRED ALTERNATIVES.**

- Queue as the first business extract. Deferred. It shares the occupancy port but is a worse first cut because the floor board is the product surface.
- Booking LEVEL 4 first. Rejected.
- A multi-year app sequence in this issue. Rejected by the issue scope.

**MIGRATION IMPACT.** Implementation starts only when a human executes DRVO-003. This register does not migrate anything.

**RISKS.** Skipping DRVO-003 and wrapping Booking alone would leave TenantId, locks, and conversion without a home. The sequence forbids that skip.

**VALIDATION / OPEN QUESTIONS.** Open runtime probes are listed on D6, D7, D9, and D10. None of them block DRVO-003.
