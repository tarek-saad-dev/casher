# DRVO ERP — Modular Commercial Draft Foundation (Migration 015)

> Date: 2026-10-26 · Status: **SHADOW ONLY / NOT A PAID BILLING SYSTEM**.  
> Builds on [Business Model V2](./BUSINESS-MODEL-V2.md) and [Research Quote Engine](./MODULAR-PRICING-RESEARCH-V1.md).  
> Depends on PR #128; this code does NOT authorize public tariffs, payments or paid feature gates.

## Delivered

1. **Additive SQL migration 015:** creates four new tables only, with no seeds or legacy mutations:
   - `dbo.ModularPriceCatalog`: unique code/version, industry, EGP and draft/approved/retired state.
   - `dbo.ModularPriceCatalogItem`: prices in integer **piasters** for app, base or extra-branch components; attached to a catalog version.
   - `dbo.TenantModularDraft`: tenant-owned selection *draft* with cycle, branches, revision and draft/void status. **No active/paid status.**
   - `dbo.TenantModularDraftApp`: individual app selections under the draft with unique keys.
2. **Canonical migration registration** and structural verification for missing tables, columns and indexes; checksum remains source-controlled.
3. **Pure shadow evaluator** in `src/platform/commercial/modularDraftShadow.ts` that checks app identity, required apps, dependencies, disallowed/self-service-held apps, selected-vs-installed gap, industry and catalog readiness.
4. Evaluator always emits `canCharge: false`, `canActivate: false`, `grantsEntitlements: false`, `changesLegacySubscription: false`, even for an approved catalog and active existing subscription.
5. Automated regression tests added to the **required** CI suite. Tests do not connect to production/staging.

## Not implemented (deliberate release guards)

- No REST create/update draft endpoint yet: future writes must use authenticated tenantId, admin RBAC, audit, optimistic versioning and app-lock/transaction checks.
- No catalog seeds or approved tariffs. The operator pricing calculator is experimental.
- No customer invoice, tax, receipt, gateway call, payment state, proration, renewal or refund.
- No app grant state stored in these draft tables, no access-gate changes or migration of existing TenantSubscription.
- No automatic applied migration on production from the coding action in this PR. Requires normal migration approval and staging/verification.
- Existing `CASHER_BOOT` subscription and tenant installed apps remain unchanged; protected compatibility must be regression-tested before future enforcement.

## Next step (separate PR after research approval)

1. Approve catalog prices, free/trial scope, location fee and annual billing rule based on customer tests and unit cost.
2. Add a **versioned, audited catalog management workflow** and tenant draft read/write API; validation from authoritative tenant context, no client prices.
3. Add order/payment/settlement ledger with signature + amount/currency + idempotency and tenant isolation.
4. Only after verified settlement, issue an explicit, auditable paid app entitlement; move access checks behind controlled rollout flags and two-tenant E2E proof.
5. Preserve old subscriptions and financial data, never silently reinterpret installed apps as paid grants.

## Deployment & rollback

- Staging must apply **migration 015** through the normal DRVO migration control plane after verifying prior applied IDs/checksums (01–14).
- Verify all four tables, constraints, indexes, empty rows and no changes to `SaaSPlan`, `TenantSubscription`, `TenantAppEntitlement`.
- Deployment with no usage of draft tables has no behavioral change. For rollback, revert application references; **do not drop data tables** without a separate approved plan.
- Cut Salon smoke: booking, POS invoice, shift close, payroll, public booking and messaging remain untouched.

## Change log

| Date | Version | Change |
| --- | --- | --- |
| 2026-10-26 | 1.0 | Draft-only schema + shadow policy, migration verification and CI tests, no payment/entitlements. |
