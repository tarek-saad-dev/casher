# DRVO-013 — P0 Booking Outbox Tenant Guard (2026-11-22)

**State:** code + synthetic regression proposed for review; real 2-tenant staging SQL/API/browser proof still OPEN.
**Source:** `casher@f8fa67d2b1c8254e638cf89d95dcee75edc88598` (before patch).
**Tracking:** [DRVO-013 #61](https://github.com/tarek-saad-dev/casher/issues/61) · [Fast Track #333](https://github.com/tarek-saad-dev/casher/issues/333).

## Evidence and impact

- `src/platform/outbox/processor.ts` reads claimed `PlatformOutbox.TenantId`, then previously loaded `BookingID` contact using `src/lib/booking/bookingCustomerContact.ts` without matching the aggregate Booking's `BranchID` to that tenant. It used the scoped messaging channel **after** the unscoped booking read. If the outbox aggregate ID is stale, corrupted or references another tenant, recipient data may be read and an outbound notification attempted under the wrong tenant channel. This is a **source-level risk**, not evidence of a customer incident.
- Canonical `src/platform/outbox/consumer.ts` already validates claimed row TenantId, but `processor.ts` is a separate legacy dispatcher and needs its own binding.
- Existing `src/platform/tenant/tenantContext.ts` provides authoritative `assertLegacyBranchInTenant(tenantId, legacyBranchId)` by querying an **active** `dbo.Location` with both `TenantId` and `LegacyBranchId`. No new global Tenant fallback or duplicate identity model needed.

## Minimal change

1. `src/lib/booking/bookingCustomerContact.ts` adds a **tenant-required reader** for outbox/worker use: join the Bookings row to an active `dbo.Location` belonging to the outbox `TenantId`, and an active `dbo.Tenant` **inside the SQL query before projecting contact PII**. Existing explicitly legacy unscope-read callers preserve their API, pending separate audit. Missing/foreign/inactive locations select no contact. This is defense before any notification side effects.
2. `src/platform/outbox/processor.ts` exclusively calls this scoped reader from its row `TenantId`, then **independently rechecks** the contact's BranchID against the same active Tenant before composing/sending any message. No new CASHER_BOOT fallback. Wrong, unmapped or invalid source means retry/dead-letter according to existing worker policy.
3. `src/platform/__tests__/drvo013BookingOutboxIsolation.test.ts`: fake SQL, two synthetic tenants; negative foreign booking/outbox aggregate; positive A and B deliveries; missing and unmapped Branch negative. No real PII/DB connection.
4. `src/lib/booking/__tests__/bookingCustomerContactTenantIsolation.test.ts`: six fake-SQL tests assert SQL tenant predicate, no foreign phone fallback/PII query, invalid tenant rejection, two-tenant separation, inactive Location rejection and explicit legacy adapter compatibility.
5. `.github/workflows/ci.yml`: make this regression mandatory on every `main` pull request (alongside existing DRVO-013 tenant and Outbox tests).

## Verify and release gates

- Required PR CI: tenant isolation tests including new file, `platformOutboxRollback.test.ts`, general DRVO/CUT regressions and Next production build; record exact PR HEAD and workflow URL.
- **Still required before merging/activating for outside customers:** controlled `last132_agent` 2-tenant SQL/HTTP/worker test (valid A booking, valid B booking, altered A outbox ID pointing to B booking, nonexistent/missing Branch), proof no foreign WhatsApp/provider call, checkout/Booking/Cut regressions; independent security review and owner/operator release approval.
- Do not write `last132` production, run DB migration, activate trial/payment, deploy from this PR, or declare Tenant Isolation finished solely due to unit tests.
- A legitimately owned **inactive/unmapped** legacy Branch will now suppress notifications, intentionally fail closed. Audit and repair the staging Location mapping before rollout; never bypass by assuming CASHER_BOOT.

**2026-11-22 CI checkpoint (earlier patch head):** GitHub Actions [#45049363631](https://github.com/tarek-saad-dev/casher/actions/runs/45049363631) SUCCESS on commit `58ae3bf9` (print / Windows / DRVO validation, including build). **The stronger SQL-scoped read + six new tests were added after that run and must pass on their own latest exact HEAD.** Real SQL staging/VPS/production remain **unverified**.

**Remaining risks:** The compatibility `loadBookingCustomerContact(bookingId)` remains intentionally unscoped for existing callers; all tenant-owned callers must migrate explicitly. Linked legacy `TblClient`/`TblEmp` ownership and downstream side-effect verification require independent two-Tenant SQL/HTTP audit. This PR does not claim universal booking/CRM isolation, business-model completeness, or new-customer GO.
