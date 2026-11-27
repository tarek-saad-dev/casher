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

## 2026-11-22 — First-stage two-Salon staging proof package

**Change impact:** The worker-scoped `BookingID` read now also independently filters DRVO-015 Tenant-owned `dbo.TblClient`, `dbo.TblEmp`, `dbo.TblPro` in the Booking SELECT, and the optional separate `TblClient.Phone` lookup with `TenantId=@tenantId`. A fabricated legacy Booking containing a foreign ClientID/EmpID/ProID cannot cause that foreign master PII to be projected under the claimed tenant. Legacy explicitly unscoped callers remain untouched and require a separate audit; this is **not** proof that every system query is isolated. Requires migration `010-master-data-tenancy` already present on the target; **do not auto-apply migrations**.

**New executable real-SQL test:** [`scripts/drvo/drvo013-two-salon-booking-isolation-staging.ts`](../../scripts/drvo/drvo013-two-salon-booking-isolation-staging.ts). It provisions **two distinct synthetic Salon tenants** with generated owner/branch/customer/booking IDs on `last132_agent` as `drvo_agent`, verifies A reads only A and B reads only B through the actual scoped Booking contact repository and active Location, denies A→B and B→A, proves the fixture creates no Booking outbox send events, and purges only its own synthetic tenants. No read of live customer names/phones, public onboarding, payments, provider calls, hosted booking endpoints, CUT writes or SQL schema migration.

**Dedicated GitHub staging check:** [`drvo013-two-salon-staging.yml`](../../.github/workflows/drvo013-two-salon-staging.yml), restricted to the exact same-repository fix branch and `drvo-staging` environment, pinned PR HEAD and staging-only SQL tunnel `127.0.0.1:14330`. A missing staging secret or staging DB identity fails closed; there is no fallback to `last132`. Existing `src/platform/__tests__/drvo013TwoSalonStageSafety.test.ts` enforces these safety properties in every general CI run. **Workflow PASS requires an actual resulting staging job; a skipped/queued/missing job is NOT evidence.**

**Required verification before this first stage can be accepted:** exact SHA normal CI **PASS**; dedicated staging job **PASS** and cleanup residue count 0; real two-salon Owner/Staff authenticated HTTP/browser negative-scope evidence (not covered by this SQL contact test); separate mocked legacy worker no-provider-call cases **PASS**; independently witnessed encrypted staging backup/restore; security/owner review. Cross-client foreign FK and all other Booking/POS/Treasury read routes remain in the wider #61 acceptance matrix. Do not merge #334 or enable public signup/paid trial as substitute for these gates.

**Operator:** If the staging check cannot obtain `DRVO_STAGING_SSH_HOST`, `DRVO_STAGING_SSH_KEY` and `DRVO_STAGING_DB_PASSWORD` from its protected environment, configure and approve only those dedicated stage secrets, then rerun from GitHub on the reviewed exact PR. Never paste SQL credentials into GitHub Issue comments or run the smoke against `last132`.
