# DRVO-002 — Boundary Contracts

| Field | Value |
|-------|-------|
| Document | `DRVO-002-BOUNDARY-CONTRACTS` |
| Issue | https://github.com/tarek-saad-dev/casher/issues/7 |
| **Decided against Git HEAD** | `9dcb83e` |
| Evidence baseline | DRVO-001 audited SHA `f5e43773545d25467af7b302b974191418a3f8dd` |
| Authority | Normative ports and invariants. Decisions: [DECISION-REGISTER](./DRVO-002-DECISION-REGISTER.md). Map: [PLATFORM-BLUEPRINT](./DRVO-002-PLATFORM-BLUEPRINT.md). Sequence: [IMPLEMENTATION-ROADMAP](./DRVO-002-IMPLEMENTATION-ROADMAP.md). |

These contracts are the target call shapes. DRVO-002 does not implement them. Names are normative for DRVO-003 and DRVO-004. Physical table renames may lag behind the port.

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

## 1. Platform primitives

### 1.1 Unit of Work

```text
UnitOfWork.execute(fn: (tx) => result) => result
```

- One SQL transaction on the shared database.
- Participating repositories receive `tx` and must not open a second transaction.
- Commit and rollback are the Unit of Work's. Callers do not commit inner transactions.
- Outbox inserts use the same `tx`.

This is how co-located modules keep today's atomicity.

### 1.2 Actor context

Every command receives an `ActorContext`:

| Field | Rule |
|-------|------|
| `actorType` | `platform_admin`, `staff`, `customer`, `service` |
| `actorId` | Id in that identity's namespace |
| `tenantId` | Required for staff, customer, and tenant-bound service. Null only for platform admin control-plane commands |
| `membershipId` | Required for staff |
| `viewLocationId` | Staff UI selection. Not an authorization proof |

Resource reads and writes compare `row.tenantId` to `actor.tenantId`. Mismatch is not found, not a cross-tenant error body that leaks existence, except for platform-admin audit logs.

### 1.3 Legacy id map

```text
LegacyIdMap
  tenantId
  entityName          # client, employee, catalog_item, branch, booking, invoice, cash_movement, ...
  legacyKey           # stable string, e.g. "123" or "123|خدمة"
  drvoId
```

Unique on `(tenantId, entityName, legacyKey)`. Writers allocate `drvoId` once and never reuse a legacy key for a different tenant.

## 2. Tenant and location

### 2.1 Tenant

Platform Core table `Tenant`: `id`, `code`, `name`, `status` (`active` or `suspended`), `defaultTimezone`, timestamps.

Bootstrap: exactly one row represents the current Casher business. `code` is a new stable tenant code chosen at seed time. It is not `GLEEM` and it is not `SalonID`.

Suspended tenant: staff and customer commands fail. Reads for export remain a platform-admin path.

### 2.2 Location

`Location`: `id`, `tenantId`, `legacyBranchId`, `branchCode`, `timezone`, `status`.

Unique `(tenantId, branchCode)` and unique `(tenantId, legacyBranchId)`.

`TblBranch` remains the storage behind the adapter until Operational Calendar and other writers have moved. New commands speak `locationId`.

### 2.3 Namespace recipes

Applock:

```text
t:{tenantId}:emp:{employeeId}:{startMs}:{endMs}
t:{tenantId}:loc:{locationId}:any-barber:{slotKey}
t:{tenantId}:booking:cancel:{bookingCode}
t:{tenantId}:schedule:{employeeId}:{businessDate}
```

Cache:

```text
t:{tenantId}:{module}:{rest}
```

Idempotency unique key:

```text
(tenantId, scope, idempotencyKey)
```

Examples of `scope`: `booking.create`, `booking.cancel`, `booking.reschedule`, `booking.convert`, `treasury.post`, `treasury.reverse`.

BookingCode unique key: `(tenantId, bookingCode)`.

Queue ticket unique key: `(tenantId, locationId, businessDate, ticketCode)`.

Webhook correlation:

```text
{tenantId}:{uuid}
```

Inbound webhooks resolve tenant from the channel account that owns the provider id. They do not accept a tenant id from the anonymous payload as proof.

Job claim:

```text
SELECT ... WHERE tenantId = @tenantId AND status = 'pending'
```

with the existing UPDLOCK / READPAST pattern, one tenant per statement. Nightly close and similar sweeps iterate locations inside one tenant, then the next tenant.

## 3. Identity contracts

### 3.1 Staff session

Adapted HMAC cookie gains `tenantId` and `membershipId`. `ActiveBranchID` remains a legacy view-location claim mapped through `Location`. Losing the cookie is an authentication failure. Presenting another tenant's id in a body is an authorization failure even if the int exists.

Location grant successor of `TblUserBranchAccess`: `(tenantId, membershipId, locationId, canView, canOperate)`.

Permission check is `(tenantId, role, permissionKey)`. Page ACL may be mapped onto keys during bootstrap. New code checks keys such as `booking.schedule.write`, `pos.invoice.create`, `treasury.post`, `calendar.day.close`.

Sensitive actions call `auditSensitive(actor, permissionKey, reason, tx)` in the same transaction as the mutation.

### 3.2 Platform admin

Separate credential store. A platform admin command that touches tenant data names `tenantId` in the argument and writes an audit row. The salon owner role cannot call these commands.

### 3.3 Customer

Target: `CustomerSession` bound to `(tenantId, customerId)`, issued after OTP or an equivalent proof platform will specify in a later issue.

Legacy adapter, allowed until that issue:

- Create may upsert by phone through Customers, inside the tenant resolved from the public location code.
- Full read, cancel, and reschedule require phone match **inside that tenant** or a token whose claims include `tenantId`, booking code, and phone digest.
- Token lifetime stays on the order of the current ~30 days until the customer-auth issue changes it.
- `ClientID` alone is never accepted as ownership.
- Upcoming-list queries are `tenantId + phone`, not a global phone scan.

### 3.4 Service identity

Named credentials: `messaging.outbox-worker`, `payroll.nightly`, `calendar.reconcile`, `whatsapp.inbound`.

A tenant-bound credential's `tenantId` is fixed. A platform dispatcher credential must pass an explicit tenant into each claim batch and must not cache tenant-specific templates on the process singleton.

`CRON_SECRET` may remain a deployment gate in front of the route. It is not the tenant authorization. The job still runs as a service actor with a tenant.

## 4. Shared domain ports

### 4.1 Customers

```text
Customers.upsertByPhone(tx, actor, { phone, displayName }) => CustomerId
Customers.get(actor, customerId) => CustomerSnapshot
Customers.findByPhone(actor, phone) => CustomerSnapshot | null
```

Phone uniqueness is `(tenantId, normalizedPhone)`. Booking and POS call `upsertByPhone`. They do not insert into `TblClient`.

Loyalty, follow-up notes, and marketing consent flags that are product features stay in their apps. The snapshot is identity and contact fields.

### 4.2 Catalog

```text
Catalog.getItem(actor, catalogItemId) => ItemSnapshot
Catalog.listSellable(actor, { locationId, kind }) => ItemSnapshot[]
```

`ItemSnapshot` includes id, name, kind (`service` or `product`), base price, duration, source version.

Booking and POS copy the snapshot onto lines inside their own transaction. Catalog is not updated from those transactions.

Inventory adjusts quantities through its own port and references `catalogItemId`.

### 4.3 Workforce occupancy

```text
Occupancy.lock(tx, actor, { employeeId, intervals[] })
Occupancy.assertFree(tx, actor, { employeeId, interval, excludeRefs[] })
Occupancy.hold(tx, actor, { employeeId, interval, ref, expiresAt, locationId, source })
Occupancy.commit(tx, actor, { employeeId, interval, ref, locationId, source })
Occupancy.release(tx, actor, { ref })
```

`source` is `booking` or `queue`. `ref` is the claimant's aggregate id.

Invariants:

- Scope is the tenant, not the location. Two locations in one tenant share one occupancy space per employee.
- `lock` uses the tenant applock recipe and is held until `tx` ends.
- `assertFree` is inside `tx` after `lock`.
- Reschedule locks every involved employee interval, asserts the new interval, commits the new ref, releases the old ref, in that order, same `tx`. It never releases first.
- Expired holds do not block `assertFree`.
- Slot-claim tables in Booking are ignored by this port.

Legacy adapter inside Workforce, until both claimants commit occupancy rows: `assertFree` may SQL-read `Bookings` and `QueueTickets` for that tenant and employee. That SQL is not legal in Booking or Queue packages.

Availability reads (schedules, day off, overrides) are a separate Workforce query. They are inputs to whether a slot is offered. They are not the conflict authority. The conflict authority is occupancy at commit time.

### 4.4 Operational Calendar

```text
Calendar.resolveFinancialWriteContext(tx, actor, { locationId })
  => { tenantId, locationId, businessDayId, businessDate, shiftInstanceId | null, scope: 'SHIFT' | 'DAY' }

Calendar.getBusinessDate(actor, { locationId, instant }) => businessDate
Calendar.hasOpenDay(actor, { locationId, businessDate }) => boolean

Calendar.openDay(tx, actor, { locationId, businessDate })
Calendar.closeDay(tx, actor, { locationId, businessDayId })
Calendar.openShift(tx, actor, { locationId, businessDayId, definitionId })
Calendar.closeShift(tx, actor, { shiftInstanceId })
```

Gate rules:

- If the actor has an open shift, `locationId` in the result is the shift location, `scope` is `SHIFT`, and the view location is ignored.
- Otherwise `scope` is `DAY` and `locationId` must be operable by the actor.
- `closeDay` and `closeShift` fail if already closed.
- Locking uses the existing UPDLOCK day/shift pattern inside `tx`.

Treasury close orchestration:

```text
UnitOfWork:
  Treasury.writeRecon(tx, ...)
  Calendar.closeDay(tx, ...) or Calendar.closeShift(tx, ...)
```

Payroll and attendance do not call `closeDay`. They read `businessDate`.

## 5. Booking contracts

### 5.1 Scheduling (bundle A)

Booking commands: hold, create, cancel, reschedule. Each takes `tx` when called inside a larger unit, or opens one Unit of Work when called from HTTP.

Create sequence inside one `tx`:

1. Resolve customer through Customers.
2. Read catalog snapshot and copy it onto services.
3. `Occupancy.lock` and `Occupancy.assertFree` for the employee (or the any-barber location lock, then the chosen employee).
4. Insert booking rows.
5. `Occupancy.commit`.
6. Insert outbox event `booking.created`.
7. Record idempotency result.

Cancel and reschedule follow the same occupancy rules. Public reschedule ownership uses the customer contract in §3.3.

Idempotency: same `(tenantId, scope, key)` and same request fingerprint returns the stored result. A different fingerprint for the same key conflicts.

BookingCode is generated inside the tenant namespace.

Staff scheduling checks `booking.schedule.write` and location operate. It does not require an open cashier shift. That gate is for conversion and other financial writes.

### 5.2 Conversion (bundle B)

Port owned as an interface that Booking's application service calls. POS supplies the adapter. Booking does not import POS.

```text
BookingConversion.createServiceInvoice(tx, actor, {
  tenantId, locationId, bookingId, lines[], idempotencyKey
}) => { legacyInvId, legacyInvType, invoiceId }
```

Orchestration, composition root, one Unit of Work:

1. If the booking already has conversion linkage, return that linkage and do not insert.
2. `Calendar.resolveFinancialWriteContext` for the booking location. Fail if the gate fails.
3. `createServiceInvoice` inserts head and detail with `invType = خدمة`, no `TblinvServPayment`, no loyalty call, no `MoneyMovement.post`.
4. Booking sets `completed` and writes `ConvertedInvID`, `ConvertedInvType`, and `invoiceId` when present.
5. Commit.

Failure before commit rolls back invoice and booking status together.

Idempotency scope `booking.convert`. Key is caller-supplied or `booking:{bookingId}`. A retry after commit returns the stored linkage.

Invoice id allocation runs inside `tx`.

#### Saga, only when `tx` cannot span POS and Booking

Not used in DRVO-004.

1. Booking sets `conversion_pending` and emits `booking.conversion_requested` with the idempotency key. It does not set `completed`.
2. POS consumes once, creates one `خدمة` invoice, emits `pos.service_invoice_issued` with the booking id and invoice ref.
3. Booking consumes and sets `completed` plus linkage. Retry of this step only rewrites the same linkage.
4. Terminal POS refusal emits `pos.service_invoice_refused`. Booking returns to the pre-conversion status.
5. A second invoice for the same key is forbidden.

There is no third mode. Bare dual-call is not a mode.

### 5.3 Composition (bundle C)

```text
OperationsFlow.getBoard(actor, { locationId, businessDate })
  => { people[], bookings[], queueTickets[], calendar }
```

Target implementation calls Booking, Queue, Workforce, and Calendar query ports. Strangler implementation may keep `loadFlowBoardForBranch` SQL inside `apps/operations` legacy adapter only.

The board is read-only. Mutations go to the owning app.

### 5.4 Notifications (bundle D)

Booking writes `booking.created`, `booking.cancelled`, `booking.rescheduled`, `booking.completed` to `PlatformOutbox` in the scheduling or conversion transaction.

Messaging consumes and sends. Send failure retries and then dead-letters. Booking status stays.

The legacy `TblBookingNotifyRequest` path is removed for any event that has an outbox consumer, in the same change that adds that consumer. One path per event.

## 6. Money movement

```text
MoneyMovement.post(tx, actor, PostCommand) => movementId
MoneyMovement.reverse(tx, actor, ReverseCommand) => movementId
```

`PostCommand` fields: `tenantId`, `locationId`, `businessDayId`, `shiftInstanceId` nullable, `amount`, `direction` (`in` or `out`), `reason`, `sourceRef`, `paymentMethodId`, `idempotencyKey`, optional `parts[]` for splits.

`reason` includes `sale`, `sale_split`, `tip`, `expense`, `income`, `deduction`, `transfer`, `payroll`.

`ReverseCommand` names the original idempotency key or movement id, plus its own idempotency key. Split reverse reverses every part. A sale delete uses this path.

Idempotency: a replay of the same key returns the original movement and does not insert another.

Enlistment: implementations use `tx`. They do not commit early.

### 6.1 Trigger coexistence

While `InsCashMoveSales` is enabled:

- POS sale create for trigger-matching types does **not** also call `post`.
- Non-sale writers (expense, income, deduction, tip, transfer, payroll cash) call `post` once the adapter is their only insert path.
- Conversion does not call `post` and does not match the trigger.

Cutover release, later than DRVO-004:

- POS sale create calls `post` inside the sale `tx`.
- The trigger is disabled in that same release.
- Sale update and delete call `reverse` / `post` rather than a private CashMove rewrite.
- After cutover Treasury repositories are the only SQL writers of the ledger table.

Atomic set for a sale, while co-located, remains: head, detail, payment, stock, cash post, split parts, target-recalc enqueue. Loyalty stays after commit.

## 7. Outbox

```text
PlatformOutbox
  id
  tenantId
  aggregateType
  aggregateId
  eventType
  payload
  idempotencyKey
  occurredAt
  status               # pending, delivering, delivered, dead
  attempts
  correlationId
```

Unique `(tenantId, idempotencyKey)` where the producer wants dedupe. Consumer dedupe key is `(tenantId, consumerName, eventId)` in a consumer inbox the platform provides.

Producer insert uses the aggregate's `tx`. If the aggregate rolls back, the event rolls back.

Dispatcher claims with the tenant predicate in §2.3. Dead-letter is a status, not a deleted row. Replay is an explicit platform command.

Domain events are facts. They are not commands to mutate another aggregate except for the conversion saga, which is the one orchestrated command flow and uses the event names in §5.2.

## 8. Registry and salon manifest

`AppRegistry` codes for the initial set:

`booking`, `queue`, `pos`, `inventory`, `purchasing`, `attendance`, `payroll`, `treasury`, `loyalty`, `messaging`, `ai-receptionist`, `reports`.

`operations` is registered as a composition surface with `entitledSeparately = false`.

Peer dependencies recorded now:

| App | Requires |
|-----|----------|
| Booking | Customers, Catalog, Workforce, Operational Calendar |
| Queue | Customers, Catalog, Workforce |
| POS | Customers, Catalog, Workforce, Operational Calendar, Treasury port |
| Payroll | Workforce, Attendance, Operational Calendar, Treasury port |
| AI Receptionist | Messaging, and Booking public query/command ports |
| Reports | read ports of the apps it displays |

Salon manifest enables every initial app code for the bootstrap tenant. CUT Club is `packs/salon/cut-club`, depending on Customers and Loyalty public ports, not on `SalonID`.

Disable semantics are in decision D12. Enforcement flag default in DRVO-003 is off.

## 9. What callers must not do

- Import another app's `internal` module.
- SQL-write another owner's table.
- Post cash by inserting the ledger table from POS, Payroll, or a trigger after cutover.
- Complete a booking conversion with two independent requests and no saga.
- Treat slot claims as the occupancy authority while claim mode is off, shadow, or unverified.
- Treat `BranchID`, `SalonID`, or the staff cookie as TenantId.
- Drain background work with a query that omits `tenantId`.
- Cache occupancy, auth grants, or settings in process memory without a tenant prefix, or treat that cache as the write barrier.
