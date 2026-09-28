# DRVO-002 — Platform Blueprint

| Field | Value |
|-------|-------|
| Document | `DRVO-002-PLATFORM-BLUEPRINT` |
| Issue | https://github.com/tarek-saad-dev/casher/issues/7 |
| **Decided against Git HEAD** | `9dcb83e` (`main` after DRVO-CTRL-001) |
| Evidence baseline | DRVO-001 audited SHA `f5e43773545d25467af7b302b974191418a3f8dd` |
| Authority | **Final architecture decisions for the next extraction stages.** Supersedes provisional labels in DRVO-001. Does not change application code or schema. |
| Control plane | [CONTROL-PLANE.md](./CONTROL-PLANE.md) (read on `main`). It governs agent execution, not product boundaries. |

Companions: [DECISION-REGISTER](./DRVO-002-DECISION-REGISTER.md) · [BOUNDARY-CONTRACTS](./DRVO-002-BOUNDARY-CONTRACTS.md) · [IMPLEMENTATION-ROADMAP](./DRVO-002-IMPLEMENTATION-ROADMAP.md)

Evidence: [EXTRACTION-AUDIT](./DRVO-001-EXTRACTION-AUDIT.md) · [DOMAIN-MAP](./DRVO-001-DOMAIN-MAP.md) · [DEPENDENCY-GRAPH](./DRVO-001-DEPENDENCY-GRAPH.md) · [MIGRATION-ORDER](./DRVO-001-MIGRATION-ORDER.md)

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

## 1. Product shape

DRVO is a modular SaaS business platform. Composition is Odoo-like. The product is not a salon fork with optional modules bolted on.

```text
Industry Packs          Salon, later Retail, later Hotel
        │               recipes, roles, dashboards, templates, pack extensions
        ▼
Independent Apps        Booking, Queue, POS, Inventory, Purchasing,
                        Attendance, Payroll, Treasury, Loyalty,
                        Messaging, AI Receptionist, Reports
                        + Operations composition BFF (not a separate entitlement)
        ▼
Shared Domains          Customers, Catalog, Workforce, Operational Calendar
        ▼
Platform Core           Tenant, Location, identity, membership, RBAC,
                        app registry, audit, config, transactional outbox
```

Dependency direction is downward only. A pack may configure apps. An app may call shared-domain and platform public ports. A shared domain may call platform public ports. Platform Core does not import shared domains, apps, or packs. An app does not import another app. Shared domains do not import each other.

The composition root (`src/app` route handlers and the process bootstrap) is the only place that wires an app-defined port to another app's adapter. That wiring is how Booking can complete a conversion through POS without a Booking → POS source import.

## 2. What each layer owns

### 2.1 Platform Core

- Tenant registry and TenantId rules.
- Location registry, mapped from legacy `TblBranch`. `BranchCode` stays a location code.
- The four identity kinds and their authenticators.
- Tenant membership and location grants (successor of `TblUserBranchAccess`).
- RBAC permission keys (successor of page ACL).
- App Registry and tenant entitlements.
- Sensitive-action audit sink.
- Configuration storage for platform, and the secret boundary for deployment secrets.
- Transactional outbox, worker claim rules, dead-letter, webhook correlation.
- Unit of Work so co-located modules can enlist in one SQL transaction.
- Session shell claims: actor, tenant, view location. The shell does not own business day or cashier shift.

Platform Core does not own customers, catalog, employees, day/shift documents, invoices, or cash rows.

### 2.2 Shared Domains

| Domain | Owns | Does not own |
|--------|------|----------------|
| Customers | Customer profile and tenant-scoped phone identity | Loyalty balances, bookings, invoices |
| Catalog | Item identity, categories, packages, execution-step definitions, base price | Stock quantities, invoice lines |
| Workforce | Employee identity, location assignment, transfers, schedules, availability inputs, **occupancy authority** | Attendance rows, payroll results, booking rows |
| Operational Calendar | Business day, shift definition, shift instance, financial-write gate | Treasury recon amounts, POS invoices |

### 2.3 Independent Apps

Each app owns its commands, its tables, and its invariants. Initial apps:

| App | Owns |
|-----|------|
| Booking | Scheduling aggregate (holds, create, cancel, reschedule), booking status, conversion linkage columns |
| Queue | Queue tickets and queue lifecycle |
| POS | Invoices, including conversion invoices with legacy `invType = خدمة`, payments on sale invoices, stock effects that are part of the sale transaction |
| Inventory | On-hand quantities and stock movements |
| Purchasing | Purchase documents and their posted stock requests |
| Attendance | Attendance sessions and breaks |
| Payroll | Payroll results, employee ledger, targets |
| Treasury | Cash ledger (CashMove successor), expenses, incomes, deductions, transfers, tips cash postings, recon documents, budget, payment-method definitions |
| Loyalty | Point balances and earn/reverse history |
| Messaging | WhatsApp product: inbox, templates, campaigns, channel accounts |
| AI Receptionist | Bot turns and receptionist tool policy |
| Reports | Read models, plus report config it owns (partner share overrides, accounting classification maps, report sends) |

**Operations** is a composition BFF under `apps/operations`. It owns the floor-board query and staff shell composition. It does not own bookings, tickets, or day rows. It is not a separate commercial entitlement. Salon dashboards call it.

Expenses, incomes, deductions, and budget are Treasury capabilities. They are not separate apps. CUT Club is a Salon Pack extension on top of Loyalty and Customers, not a second loyalty product.

### 2.4 Industry Packs

A pack is configuration, recipes, roles, dashboards, templates, and optional pack-owned extensions. Salon Pack enables the initial app set for a salon tenant and supplies salon role templates, floor dashboard layout, service execution-step templates, groom-package recipe content, concierge knowledge templates, and the CUT Club extension.

Salon Pack must not copy platform or app code. Retail and Hotel packs, when they exist, select and configure the same apps. A hotel tenant that sells appointments uses Booking. It does not get a forked booking module.

## 3. Runtime shape and level gates

### 3.1 Initial runtime

One Next.js deployment and one SQL Server database. Workers that already run as separate Node processes (message outbox, inbox, AI turns) stay separate processes. Their tables stay in the same database. No new microservice is introduced for Booking, POS, or Treasury.

Same-runtime rule: if today's correctness is one SQL transaction or one `sp_getapplock` in that transaction, the participants stay co-located until a replacement contract is implemented and tested.

### 3.2 LEVEL vocabulary

| Level | Name | Meaning |
|-------|------|---------|
| LEVEL 1 | Module boundary | Same deployment, same database, explicit package and public port |
| LEVEL 2 | Service/runtime boundary | Separate runtime. May still share the database |
| LEVEL 3 | Data ownership boundary | The module is the exclusive writer of its tables. Others use ports or events. Same database is allowed |
| LEVEL 4 | Physical database boundary | Separate database or storage |
| LEVEL 5 | Commercial packaging | Entitlement and install/enable. Independent of process and database split |

Extraction is not a separate database. LEVEL 4 is a later gate, not the definition of a module.

### 3.3 When a higher level is justified

**LEVEL 2** is justified only when all of these are true:

- The capability needs an independent failure domain or scale profile.
- Every shared-transaction invariant has a Unit of Work enlistment that still works, or an orchestrated saga that has been tested.
- Applocks and UPDLOCK claims that cross the boundary have a tenant-scoped replacement.

Existing Messaging and AI workers already meet this for delivery loops, because send/interpret work is already outside the request transaction and idempotent per row.

**LEVEL 3** is justified when the module is the only writer, callers have left direct SQL, and the public port is what tests and other modules use. LEVEL 3 does not require a new database.

**LEVEL 4** is justified only when all of these are true:

- LEVEL 3 has been in production for that module.
- No correctness path still needs a SQL transaction or SQL lock that spans the boundary.
- Database triggers that cross the boundary are removed.
- Idempotent retry has been proven for the saga or posting contract that replaced the transaction.
- A later DRVO decision explicitly accepts the operational cost.

LEVEL 4 is not required before DRVO-003 or DRVO-004.

**LEVEL 5** can exist on a LEVEL 1 module. Entitlement does not imply a process split.

### 3.4 Target levels

Medium-term means the ownership target after DRVO-004. It is not a scheduled multi-year program. Dates and later app extractions are out of this blueprint.

| Module | First extraction phase (DRVO-003–004) | Medium-term target |
|--------|----------------------------------------|--------------------|
| Platform Core: tenant, location, staff auth, RBAC, audit | LEVEL 1 | LEVEL 3, same database |
| Platform Core: outbox infrastructure | LEVEL 1 in-process publish | LEVEL 2 workers and LEVEL 3 table ownership, same database |
| Platform Core: app registry and entitlements | LEVEL 1 registry, enforcement off | LEVEL 5 enforcement on LEVEL 1–3 modules |
| Customers | LEVEL 1 anti-corruption facade | LEVEL 3, same database |
| Catalog | LEVEL 1 anti-corruption facade | LEVEL 3, same database |
| Workforce identity and availability | LEVEL 1 anti-corruption facade | LEVEL 3, same database |
| Workforce occupancy authority | LEVEL 1 port over current applocks | LEVEL 3, same database |
| Operational Calendar (Day/Shift) | LEVEL 1 facade | LEVEL 3, same database |
| Booking scheduling (bundle A) | LEVEL 1 | LEVEL 3, same database. LEVEL 2 runtime deferred. LEVEL 4 is not a target |
| Booking commercial conversion (bundle B) | LEVEL 1 POS adapter, shared SQL transaction | LEVEL 3 inside POS, same database. Saga only if a shared transaction becomes impossible |
| Booking composition (bundle C) | LEVEL 1 operations BFF | Stays LEVEL 1 composition. Not a data owner |
| Booking notifications (bundle D) | LEVEL 1 outbox emit, legacy sender behind port | LEVEL 2 delivery by Messaging workers |
| Queue | LEVEL 1 | LEVEL 3, same database |
| POS / sales | LEVEL 1 | LEVEL 3, same database. LEVEL 4 is not a medium-term target |
| Inventory | LEVEL 1 | LEVEL 3, same database |
| Purchasing | LEVEL 1 | LEVEL 3, same database |
| Attendance | LEVEL 1 | LEVEL 3, same database |
| Payroll | LEVEL 1 | LEVEL 3, same database |
| Treasury, including money movement | LEVEL 1 posting port; sale trigger still live | LEVEL 3 exclusive writer, same database; trigger removed |
| Loyalty | LEVEL 1 | LEVEL 3, same database |
| Messaging / WhatsApp product app | LEVEL 1 product module; existing workers remain LEVEL 2 | LEVEL 3 data ownership and LEVEL 2 runtime, same database |
| AI Receptionist | LEVEL 1 | LEVEL 2 runtime and LEVEL 3 data, same database |
| Reports read models | LEVEL 1 | LEVEL 1 read models over app contracts |
| Reports config and commands | LEVEL 1 | LEVEL 3 for the config it owns, same database |
| Operations composition BFF | LEVEL 1 | LEVEL 1. Not entitled separately |
| Salon Pack | LEVEL 5 manifest only | LEVEL 5 recipe. Never a fork |
| Expenses, incomes, deductions, budget | Inside Treasury, same levels as Treasury | Inside Treasury |
| CUT Club | Salon Pack extension on Loyalty, LEVEL 1 | Pack extension, not a fork |
| Local print and device gateways | Deployment satellite. Not extracted | Stays outside the monolith tenancy model |
| Approvals workflow, calendar sync | RETIRE | Removed from the product surface |

## 4. Tenancy

**Topology: shared database / shared schema.**

The current Casher SQL Server database is one tenant. Staging `last132_agent` and production `last132` are deployments of that same product shape, not two tenants. This blueprint does not authorize any connection to `last132`.

`Tenant` is a Platform Core entity. `Location` belongs to exactly one tenant and replaces the role of `TblBranch` as the multi-site key. Legacy `BranchID` and `BranchCode` are stored on the location mapping. `BranchCode` values such as `GLEEM` are location codes inside the bootstrap tenant. They are not tenant ids. Nullable `SalonID` on CUT Club tables is retired as a concept and is never read as TenantId.

Isolation is `TenantId` on every tenant-owned row plus repository predicates. It is not the session cookie and it is not `BranchID`.

Uniqueness, applock resource names, cache keys, idempotency keys, BookingCode, job claims, webhook correlation, and integration secrets are tenant-namespaced. Contracts are in [BOUNDARY-CONTRACTS](./DRVO-002-BOUNDARY-CONTRACTS.md).

A second tenant is forbidden until the namespace gate in the roadmap passes. Bootstrap of one tenant is not that gate.

## 5. Identity

| Identity | Authenticator | Scope |
|----------|---------------|--------|
| Platform admin | Platform credential | Cross-tenant administration. No implicit location operate right |
| Tenant staff user | Staff session (legacy HMAC cookie adapted) | One tenant membership, location grants, RBAC |
| Customer / end user | Customer session. Target is OTP or equivalent. Legacy phone possession is an adapter only | One customer profile inside one tenant |
| Service / integration | Service credential | One named job or channel, bound to a tenant or to the platform dispatcher |

Legacy `super_admin` maps to the bootstrap tenant's owner role. It does not become a platform admin.

Staff view-location and operational-location stay different facts. Financial writes resolve location through Operational Calendar. A cookie is never tenant isolation.

Public booking ownership is not staff RBAC. Knowing `ClientID` is not authorization. Details: boundary contracts.

## 6. Scheduling, booking, day/shift, money, events

These are decided here and specified as contracts in the companion docs.

**Occupancy.** Workforce is the write authority for employee busy intervals. The lock is tenant-global per employee, so a booking at one location conflicts with a booking or queue ticket for that employee at another location. Booking slot-claim rows are a Booking-local index. They are not the cross-app authority. While claim mode is off, correctness remains the applock plus the in-transaction busy-interval assert, now behind the Workforce port.

**Booking bundles.**

| Bundle | Owner | Consistency |
|--------|-------|-------------|
| A Scheduling | Booking | Workforce occupancy port inside the scheduling transaction |
| B Commercial conversion | POS owns the `خدمة` invoice. Booking owns `completed` and `ConvertedInv*` | One SQL transaction while co-located |
| C Composition | Operations BFF | Read model. Stale reads are acceptable. Writes are not done here |
| D Notifications | Booking emits. Messaging delivers | Outbox. Delivery failure does not roll back the booking |

A bare dual-call (HTTP create invoice, then HTTP complete booking, with no shared transaction and no saga) is forbidden.

**Day / Shift.** Operational Calendar owns `TblNewDay`, `TblShift`, and `TblShiftMove` successors. Treasury owns recon amounts and calls the calendar close command in the same transaction. POS, conversion, payroll, and attendance consume the gate or the business date. They do not own the day row.

**Money.** Treasury owns the cash ledger. Other apps call `post` and `reverse`. Sale create today is posted by trigger `InsCashMoveSales` inside the invoice transaction. That trigger stays until a later cutover release in which POS calls `post` inside the same transaction and the trigger is removed in that same release. Both paths must not run together. Conversion invoices (`خدمة`) do not post cash.

**Events.** Platform outbox is the bus. Messaging is a consumer and a product. Booking notification leaves `after()` plus an unreclaimed notify row and becomes an outbox event. At-least-once delivery, idempotent consumers, tenant-scoped claims.

## 7. Module layout for the next phase

Target tree inside the existing Next.js app. DRVO-003 creates the skeleton. It does not move every file.

```text
src/platform/                 tenant, location, auth, rbac, registry, audit, config, outbox, uow
src/shared/customers/
src/shared/catalog/
src/shared/workforce/
src/shared/operational-calendar/
src/apps/booking/
src/apps/queue/
src/apps/pos/
src/apps/inventory/
src/apps/purchasing/
src/apps/attendance/
src/apps/payroll/
src/apps/treasury/
src/apps/loyalty/
src/apps/messaging/
src/apps/ai-receptionist/
src/apps/reports/
src/apps/operations/          composition BFF only
src/packs/salon/
src/legacy/                   anti-corruption adapters over current tables and src/lib
src/app/                      HTTP and UI composition root
src/lib/                      legacy domain code, shrinks by strangler
src/modules/                  legacy modules, shrinks by strangler
```

Public surface of a module is its `public` entry. `internal` is not imported from outside. SQL against a table is issued only by the owning module's repository, or by a named legacy adapter scheduled to be deleted. Migration files are owned by the module that owns the table. An app migration does not alter another app's table.

No raw cross-app SQL in the target architecture. During the strangler, the Workforce occupancy adapter may still read `Bookings` and `QueueTickets`, and the Operations BFF adapter may still run the flow-board query. Those two exceptions are named, live only in the adapter, and end when claimants write occupancy rows and the BFF uses query ports.

## 8. Configuration and packs

| Layer | Holds | Store |
|-------|--------|--------|
| Platform | Registry defaults, kill-switch defaults | Platform tables |
| Tenant | Policies that apply to the whole business | Tenant settings rows |
| Location | Hours, closures, device binding ids | Location settings rows |
| App | App settings keyed by tenant and app | App settings rows |
| Industry Pack | Role templates, dashboards, recipes, knowledge templates | Pack manifest plus tenant pack-config rows |
| Environment | Database credential, session signing key, encryption key, deployment break-glass | Secret manager or env. Not business configuration |

Global env feature flags, filesystem JSON business config, hardcoded `GLEEM`, and process-memory caches without a tenant prefix are migration hazards. They are retired as new code is written. Correctness never depends on a process cache.

## 9. Strangler in one page

Casher keeps serving the salon on the monolith. New ports wrap current tables. The legacy table remains the source of truth until that module's exit criteria name the module repository as the only writer. Financial dual-write across two stores is forbidden. Read-model shadow reads are allowed. Rollback is a flag back to the legacy adapter while the shared tables still exist. Schema is not dropped in the cutover release.

DRVO-003 builds platform skeleton, one tenant, location map, session tenant claim, outbox write path, registry with enforcement off, and facades. DRVO-004 extracts Booking scheduling to LEVEL 1 behind those ports and leaves conversion on the shared-transaction POS adapter.

What is explicitly not required before that first extraction: a second database, a second tenant, customer OTP, POS or Treasury extraction, removal of `InsCashMoveSales`, extraction of the Messaging product, or a Booking LEVEL 2 process.

## 10. Document map

| Question | Document |
|----------|----------|
| Why this option won, and what was rejected | [DECISION-REGISTER](./DRVO-002-DECISION-REGISTER.md) |
| Ports, namespaces, idempotency, failure behavior | [BOUNDARY-CONTRACTS](./DRVO-002-BOUNDARY-CONTRACTS.md) |
| DRVO-003 and DRVO-004 scope, gates, rollback | [IMPLEMENTATION-ROADMAP](./DRVO-002-IMPLEMENTATION-ROADMAP.md) |
