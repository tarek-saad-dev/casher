# Agent 1 — Core Architect: boundaries and tenant-isolation handoff

Baseline: `main` at `726715bb7a8c44ccac2d75dc6f6d01f139f5efff` (2026-10-25). This is a coordination document, not a declaration that DRVO ERP is generally available.

## Existing foundation audited

- **DRVO-011 (#48)**: `Tenant`, `Location`, `TenantMembership`, `LegacyIdMap`, bootstrap reconciliation, platform onboarding/readiness. Legacy Cut data belongs to `CASHER_BOOT`; a new tenant must never inherit CUT legacy users or locations.
- **DRVO-012 (#52, PR #63)**: `SaaSPlan`, `TenantSubscription`, Industry Pack definitions, installed app state and subscription/entitlement evaluation are separate. Plans do not determine installed apps.
- **DRVO-013 (#61)**: `src/platform/tenant/tenantContext.ts` resolves staff, public and job tenant contexts, with non-disclosing errors. `src/platform/session/staffTenantContext.ts` and `src/lib/api-auth.ts` bind sessions to membership and active location. Tenant-scoped memoization, lock keys, worker fanout and outbox consumers exist. The dedicated platform-operator boundary is distinct from a tenant admin.
- **DRVO-015 (migration 10)**: Customers/Catalog master-data storage is tenant-scoped, with `src/platform/masterData/tenantScope.ts` as the branch-to-tenant boundary.

These are implemented foundations, **not proof that every legacy SQL query is tenant-safe**. Staging and multi-tenant runtime acceptance remain independent gates.

## Security finding addressed here

**HIGH — unchecked stamped branch/tenant pair:** `tenantIdForBranchContext({branchId, tenantId})` previously returned a syntactically valid supplied `tenantId` without checking whether `branchId` maps to an active `Location` inside it. Downstream master-data writes accepted this ID. This could allow a wrongly assembled request/service context to select the wrong tenant's data. The helper now verifies `(TenantId, LegacyBranchId, Status='active')` with the existing canonical `assertLegacyBranchInTenant` resolver. An unmapped/mismatched/inactive branch fails with the same public 404. Explicit callers may pass an existing transaction; no global tenant fallback was added. The legacy unstamped branch path remains fail-closed when ambiguous.

Regression coverage: `scripts/drvo/__tests__/tenantBranchStampIsolation.test.ts` (valid, cross-tenant, inactive, overlapping branch IDs, ambiguous legacy, invalid inputs). No schema change.

## Remaining risks (not solved by this PR)

| Priority | Surface / evidence | Required owner action |
| --- | --- | --- |
| HIGH | Legacy employee/payroll/report reads of `TblEmp` can still be branch-driven without a `TenantId` filter (DRVO-015 implementation note, follow-ups) | Core defines scoped Workforce port; Salon migrates callers; QA two-tenant query proof |
| HIGH | Legacy settings for split-payment clearing reference global `TblSettingValues` and CASHER_BOOT categories (DRVO-015 note) | Salon + SaaS define tenant settings and compatibility plan before enabling for non-CUT |
| HIGH | Legacy direct joins and reports may rely on global surrogate IDs without explicit tenant predicates (DRVO-015 note) | Each owning app inventories queries; QA enforces tenant predicates and object reference checks |
| HIGH | Public loyalty by-client-id endpoints historically have no tenant identity (DRVO-015 note) | Salon must bind explicit public tenant/site identity or disable for non-CUT |
| MEDIUM | `PlatformOutbox` rows in `delivering` after process crash require manual recovery (DRVO-013 note) | SaaS Platform owns leasing/recovery; QA tests claiming/settlement per tenant |
| MEDIUM | Global `TblUser.loginName` and no tenant selector for multi-membership users (DRVO-013 note) | Core identity design with SaaS onboarding; keep membership fail-closed |
| MEDIUM | Legacy global data, single-tenant compatibility and public booking fallback are restricted seams, not a general multitenant contract (DRVO-013 note) | Salon explicitly identifies CUT-only routes; SaaS forbids treating them as generic |
| MEDIUM | Conditional tenant-scoped app gate relies on trusted proxy-stamped `x-pathname` (DRVO-013 note) | Each app requires explicit composition-root gates in non-HTTP/internal callers |

The list is a prioritized handoff, not a claim of a complete repository-wide SQL inventory.

## File ownership — parallel agents

Do not edit files owned by another agent without a documented interface request. Test fixtures adjacent to a changed file remain the implementing agent's responsibility.

| Agent | Primary ownership | Shared contract / coordination |
| --- | --- | --- |
| **1 Core Architect** | `src/platform/tenant/**`, `src/platform/session/**`, `src/platform/auth/**`, `src/platform/masterData/tenantScope.ts`, `src/shared/{customers,catalog,workforce}/public/**`; core tenant/RBAC contracts | Own definitions, membership/location authorization, shared port signatures, import boundaries. Review proposed changes to `src/lib/api-auth.ts` and session implementation. |
| **2 Salon Engineer** | `src/apps/{booking,queue,pos,treasury,inventory,purchasing}/**`, salon-related `src/lib/**` and app routes, `src/packs/salon/**` | Only consume authenticated `TenantContext` and shared ports; no global branch/user lookups as authorization. Preserve CUT compatibility through named seams. |
| **3 Clinics Engineer** | `src/apps/clinic/**`, `src/app/clinic/**`, clinic-owned API routes, clinical record domain, `src/packs/clinic/**` | Clinical access checks add practitioner-to-patient authorization *after* tenant + location checks. No direct writes into other app-owned tables. Coordinate any changes to shared patient identity. |
| **4 SaaS Platform Engineer** | `src/platform/{commercial,onboarding,branding,registry,packs}/**`, platform administration, subscription/installation/setup UI, pricing and plan flows | Tenant provisioning emits core identity/membership + active location; app entitlement may only be evaluated after authoritative tenant resolution. Platform operators do not inherit tenant staff privileges. |
| **5 QA & Integration Engineer** | Cross-app integration harness, staging tenant fixtures and read-only verification, CI workflow updates, security/performance/regression gates | Test real two-tenant scenarios including equal local identifiers, missing memberships, negative direct-object access, worker isolation and CUT regressions. No unreviewed merge/deploy. |

`src/shared/*/internal/**` adapters belong to **Core** for contract integrity, but owner-app changes must be coordinated. Database migrations belong to the domain implementing the schema, must use the DRVO migration manifest/control plane, and require an independent review. File paths above are coordination defaults, not permission to overwrite another active agent's branch.

## Contract rules for all agents

1. A staff caller obtains `StaffTenantContext` from a verified session and membership. A public caller resolves `PublicTenantContext` from a verifiable public/site identity. A job obtains `JobTenantContext` from the claimed row. Never accept client-supplied `TenantId` as proof.
2. `TenantId` is the first authorization boundary. Validate a branch/location, employee, customer, catalog item or foreign-key reference *inside that tenant* before any read/write. Use non-disclosing 404 for cross-tenant direct-object access.
3. Shared data goes through public ports (`src/shared/*/public`) or Core-owned validated resolvers, not raw cross-module table reads. `ActorContext.tenantId` must be present for tenant-owned operations; a platform operator is not an implicit tenant staff member.
4. Enforce DRVO-012 commercial access and app installation against the same verified tenant, after authorization. Keep plans, packs, installed apps and subscription lifecycle separate.
5. Include tenant in cache/memo, idempotency, lock and background-job namespaces. Validate tenant-to-branch bindings even when a tenant ID is already attached.
6. This PR intentionally makes **no** changes to `main`, production databases or deployments; build/runtime/staging and independent review gates must pass before any merge.
