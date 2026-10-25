# DRVO Core Integration V1 — Workspace application status (issue #105)

## Product intent

A tenant owner should see whether an installed app has enough known setup evidence to start using it. This is an **informational Workspace read model**, not a new data store, not a feature gate and not proof that every workflow or booking slot works.

## Source of truth (reuse, no duplication)

- Tenant identity and active location: `requireAdmin()` through the authoritative staff session / membership resolver. No caller-supplied tenant IDs.
- Installed apps: `getTenantInstalledAppsForGate(tenantId)` (DRVO-012 entitlement model). Packs, plan and installed apps remain distinct.
- Go-live checks: `evaluateTenantGoLive(tenantId)` (existing tenant-scoped database queries).
- Projected app status: `buildTenantWorkspace` in `src/platform/tenant/workspaceReadiness.ts`, pure/client-safe; UI reads `GET /api/tenant/workspace` and does not claim authority to grant app access.

## Status semantics

- `not_installed`: app is not in the tenant installed-app set; no app action.
- `needs_setup`: Booking/Queue/POS have a missing/unknown tenant-level prerequisite. The projection fails conservatively if a required milestone is omitted.
- `basics_present`: relevant tenant-wide milestones have been met; **not proof** a specific branch/employee/slot or payment path is operational.
- `in_use`: Booking/POS have a recorded first booking/sale milestone; **not** proof of global correctness.
- `installed_unverified`: other apps are installed; this projection does not pretend to evaluate their runtime readiness.

UI shows installed apps only, in a compact section of existing `/admin/tenant`. It explicitly explains evidence limitations, handles empty/loading/error and only links to known existing routes. There is no app installation control here.

## Module ownership contract

- **Core:** Tenant membership, location identity, read-only Workspace contract, shared public ports, UnitOfWork and provenance of tenant context.
- **Salon:** Salon Pack owns initial booking preset content, e.g. `src/packs/salon/onboardingPreset.ts`; Booking/Queue/POS own business validation and operational settings. Current `QueueBookingSettings` remains an operational source of truth behind a named adapter for the first phase, not a parallel copy into `TenantIndustryPack.ConfigJson`. Any future typed settings move needs an explicit migration/ownership decision and a single-writer plan.
- **Clinics:** Can expose future readiness signals when the clinic app is registered and its domain is reviewed; never infer clinical readiness from generic staff or customer counts. Keep protected health data outside Workspace.
- **SaaS Platform:** Owns signup, pack/app selection and subscription lifecycle, and may consume the Workspace read model. No anonymous client may set `TenantId`.
- **QA:** Tests a real new tenant + CUT legacy tenant, cross-tenant access, disabled app and commercial block, UI/auth/route smoke and no regression.

The generic reusable domain ports remain `src/shared/{customers,catalog,workforce,operational-calendar}/public`. Apps consume the appropriate shared ports; the application composition root wires cross-app requests. Core must not import app internals.

## Follow-on delivery (not implemented in this slice)

1. Agent 4 connects a lightweight Workspace entry point to onboarding/owner navigation without duplicating this API.
2. Agent 2 connects genuinely app-specific checks and setup deep links (booking availability/public enablement, cashier payment setup) rather than treating tenant-level counts as readiness.
3. Agent 5 executes a staged fresh Salon tenant flow: signup -> app choices -> team/catalog -> booking -> owner Workspace display, then CUT regression.
4. Clinics registration/patient handoff only after Agent 3's draft PR and migration conflict are reviewed.
5. Full RBAC and security sweep are deferred to the designated hardening phase, while baseline tenant data boundaries and billing/transaction correctness remain mandatory.

## Delivery controls

Issue #105. New branch from `main`, reviewed PR only, no merge/deploy. No schema changes or new settings writers. Production database `last132` is never accessed; any staging DB run must use `last132_agent` with documented safeguards. CI build/unit is not a substitute for runtime staging proof.
