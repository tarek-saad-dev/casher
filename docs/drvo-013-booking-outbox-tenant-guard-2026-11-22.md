# DRVO-013 — P0 Booking Outbox Tenant Guard (2026-11-22)

**State:** code + synthetic regression proposed for review; real 2-tenant staging SQL/API/browser proof still OPEN.
**Source:** `casher@f8fa67d2b1c8254e638cf89d95dcee75edc88598` (before patch).
**Tracking:** [DRVO-013 #61](https://github.com/tarek-saad-dev/casher/issues/61) · [Fast Track #333](https://github.com/tarek-saad-dev/casher/issues/333).

## Evidence and impact

- `src/platform/outbox/processor.ts` reads claimed `PlatformOutbox.TenantId`, then previously loaded `BookingID` contact using `src/lib/booking/bookingCustomerContact.ts` without matching the aggregate Booking's `BranchID` to that tenant. It used the scoped messaging channel **after** the unscoped booking read. If the outbox aggregate ID is stale, corrupted or references another tenant, recipient data may be read and an outbound notification attempted under the wrong tenant channel. This is a **source-level risk**, not evidence of a customer incident.
- Canonical `src/platform/outbox/consumer.ts` already validates claimed row TenantId, but `processor.ts` is a separate legacy dispatcher and needs its own binding.
- Existing `src/platform/tenant/tenantContext.ts` provides authoritative `assertLegacyBranchInTenant(tenantId, legacyBranchId)` by querying an **active** `dbo.Location` with both `TenantId` and `LegacyBranchId`. No new global Tenant fallback or duplicate identity model needed.

## Minimal change

1. `src/platform/outbox/processor.ts`: before composing a message or calling `sendViaTenantChannel`, fail closed for a booking missing `BranchID`; check the booking contact's BranchID maps to an **active Location of the outbox row's TenantId**. Wrong or unmapped Location means retry/dead-letter according to the existing worker policy. No direct use of the legacy CASHER_BOOT bootstrap.
2. `src/platform/__tests__/drvo013BookingOutboxIsolation.test.ts`: fake SQL, two synthetic tenants; negative foreign booking/outbox aggregate; positive A and B deliveries; missing and unmapped Branch negative. No real PII/DB connection.
3. `.github/workflows/ci.yml`: make this regression mandatory on every `main` pull request (alongside existing DRVO-013 tenant and Outbox tests).

## Verify and release gates

- Required PR CI: tenant isolation tests including new file, `platformOutboxRollback.test.ts`, general DRVO/CUT regressions and Next production build; record exact PR HEAD and workflow URL.
- **Still required before merging/activating for outside customers:** controlled `last132_agent` 2-tenant SQL/HTTP/worker test (valid A booking, valid B booking, altered A outbox ID pointing to B booking, nonexistent/missing Branch), proof no foreign WhatsApp/provider call, checkout/Booking/Cut regressions; independent security review and owner/operator release approval.
- Do not write `last132` production, run DB migration, activate trial/payment, deploy from this PR, or declare Tenant Isolation finished solely due to unit tests.
- A legitimately owned **inactive/unmapped** legacy Branch will now suppress notifications, intentionally fail closed. Audit and repair the staging Location mapping before rollout; never bypass by assuming CASHER_BOOT.

**Status at drafting:** source+unit tests added to a review branch. **CI/staging/VPS/Production unverified** until their exact evidence is linked.
