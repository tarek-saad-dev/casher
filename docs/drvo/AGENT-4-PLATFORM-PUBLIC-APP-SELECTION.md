# Agent 4 — Public signup app selection (initial independent task)

## Existing contracts inspected

- DRVO-011: platform onboarding, tenant, membership, location and readiness already exist.
- DRVO-012: Industry Pack definitions and the installed-app materialization policy already exist in `src/packs/*` and `src/platform/apps/*`.
- DRVO-013: authoritative tenant/auth gates already exist; no changes to those boundaries.
- V1 public signup previously captured needs but installed the pack defaults with only a few hard-coded extras. That did not implement the customer-visible toggle semantics.

## Change

- Read the real source-controlled Industry Packs to show required/recommended/optional apps.
- Validate the exact public selected app set **before** creating the signup registration/tenant.
- Materialize customer choices using the existing `resolveTenantComposition` policy and `onboardBusiness` coordinator. Required apps and dependencies fail closed.
- Legacy clients that omit `selectedApps` keep their existing `needs` mapping.
- Public registration excludes messaging/AI (not self-service ready) and legacy-only apps.
- The trial remains `starter`, unchanged. Customer selection of a paid Growth/Pro plan requires a separate payment/activation gate; no free upgrade is introduced here.
- No schema changes, no database migrations, no production mutations; legacy CASHER_BOOT state is untouched.

## Integration contract for Agent 1 (Core)

- Canonical input: `OnboardingRequest.apps = { add, remove }`.
- Canonical policy: `resolveTenantComposition(pack, customizations)` and `TenantAppEntitlement`.
- The public selection is NOT a tenant authorization context, commercial entitlement, or substitute for Agent 1's tenant-scoped checks.
- No new tenant context resolver or core provisioning implementation.
- Onboarding and app mutations must remain tenant-scoped and transaction/outbox protected by core.
- Public signup only creates a starter **trial**; commercial lifecycle remains separate.

## Follow-ups

- Add trusted billing/checkout and plan selection without letting anonymous users select a paid plan at no cost.
- Surface per-tenant app manager for owners behind RBAC, with installed-app/readiness indicators and disable confirmations.
- Verify complete app operations for a real second tenant in staging and rerun CUT regression.
