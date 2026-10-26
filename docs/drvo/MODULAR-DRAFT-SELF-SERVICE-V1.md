# DRVO ERP — Self-service Modular Draft Selection (V1)

> **2026-10-26 · DRAFT-ONLY / NO PAYMENT / NO ENTITLEMENT CHANGES**  
> Business policy: [Business Model V2](./BUSINESS-MODEL-V2.md).  
> Previous foundation: [Migration 015](./MODULAR-COMMERCIAL-DRAFT-FOUNDATION.md).

## Customer experience

- Tenant owner/admin visits `/admin/billing` and sees current real subscription status, historical requests, and the **new app-selection draft editor**.
- Chooses apps within their actual Industry Pack, a hypothetical branch count (1–20) and monthly/annual preference. These are **planning choices only**, not created locations or actual billing terms.
- Required apps (Salon Booking, Supermarket POS) remain selected. Unverified Inventory/Purchasing and restricted messaging/AI/loyalty remain unavailable, not silently marketed.
- Clicks **Save Draft**, edits later. The latest saved revision is shown. Concurrent stale saves return 409 and reload the latest state.
- Existing signed-in expired-trial admins may still access billing and draft editor, but saving does not restore suspended access. `CASHER_BOOT` is strictly read-only.

## Migration 016

`db/drvo-migrations/016-modular-draft-selection-catalog/schema.sql` seeds two **empty and explicitly `draft`** catalog pointers `salon-selection-draft` and `supermarket-selection-draft`, both version 1 / EGP. **No prices, approvals, paid entitlements or tenant rows are seeded.** Migration depends on schema-only 015 and is registered with its own checksum and verification. It must be applied in approved staging first, then through normal controlled production migration; this development PR does not execute migrations.

The catalog is a FOREIGN KEY target for `TenantModularDraft.CatalogId`. It is *not* used to compute a payable quote. If the migration has not been applied, the draft panel reports an unavailable state and other billing information remains independently accessible.

## Secure API

`GET /api/tenant/modular-draft`: tenant-admin authenticated read, resolves tenant from signed session. Returns available/held app choices and saved draft scoped to `TenantId`. No public catalog pricing.

`PUT /api/tenant/modular-draft`: **accepts only** `apps`, `branches`, `billingCycle`, `expectedRevision`; rejects caller-supplied `tenantId`, `CatalogId`, `amount`, `status`, `paid`, etc. Authoritative tenantId and actorUserId always come from RBAC session.

- All writes are inside an SQL transaction with the **tenant commercial applock**, `CASHER_BOOT` database protection and `UPDLOCK/HOLDLOCK` on the tenant draft.
- Rejects missing required pack apps, duplicates, unavailable apps and missing app dependencies; refuses unsupported industries and invalid branch counts.
- Rejects cross-catalog draft mismatches, enforces optimistic revision and guarded update, does a tenant-bound draft-app delete/replace in a single transaction, and records an auditable outbox event. No-op save creates no duplicate event.
- `TenantModularDraft.Status` remains **`draft`**. The response cannot assert paid/active access or a charge.
- On failure, transaction rolls back. Historical subscription, app-installed flags, invoices and business data remain untouched.

## Still NOT implemented

No customer-facing approved prices, orders, payment gateway, subscription switch, app activation, operational location creation, inventory or AI monetization. Research calculator prices remain **internal experiments only**.

**Do not treat saving this draft as acceptance of a payable invoice**, or automatically enable apps. Approved price catalog release, checkout and verified settlement require separate review and testing.

## Rollout acceptance gates

- [x] Application and migration code + mandatory source-level/functional policy tests in CI.
- [ ] Run migration 016 on a staging database with applied 015; verify both empty catalogs with status draft.
- [ ] Two-tenant staging E2E (Salon/Supermarket; each admin reads only own draft); concurrent save conflict; expired trial admin; non-admin forbidden; CASHER_BOOT mutation forbidden.
- [ ] Verify no changes to `SaaSPlan`, `TenantSubscription`, `TenantAppEntitlement`, actual locations, receivables or financial ledger.
- [ ] Regression Cut Salon booking/invoices/closing/HR and public booking before deploying.
- [ ] Approve prices and commercial unit economics before any new payable journey.

## Change history

| Date | Version | Notes |
| --- | --- | --- |
| 2026-10-26 | 1.0 | Migration 016, tenant draft read/save service, UX component, tenancy guards; not a payment feature. |
