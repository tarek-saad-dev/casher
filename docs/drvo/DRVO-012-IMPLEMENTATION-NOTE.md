# DRVO-012 — Commercial Plans, Industry Packs, Tenant Apps & Subscription Lifecycle

Issue: #52 (authoritative). Follow-up enforcement: DRVO-013 (#61) — not in this branch.

## Model

| Concept | Where | Notes |
| --- | --- | --- |
| Commercial Plan | `dbo.SaaSPlan` (data) | Plan limits are **provisional, editable data**, not marketing claims. |
| Subscription | `dbo.TenantSubscription` (1 row / tenant) | `trial` / `active` / `past_due` / `suspended` / `cancelled`; `Revision` for optimistic concurrency. |
| Industry Pack | Source-controlled `IndustryPackDefinition` (`src/packs/*`) | No Pack CMS. Tenant pack state in `dbo.TenantIndustryPack`. |
| Tenant Installed Apps | `dbo.TenantAppEntitlement` (generalized) | `Status` installed/disabled + `Source` + timestamps. No `TenantApp` / `SaaSPlanApp` tables. |
| App catalog | `AppRegistry` + `src/platform/registry/constants.ts` | Installable set derived from the registry; `operations` is a composition surface, not an app. |

`SalonPackConfig` stays as a compatibility seam (written insert-only for salon tenants).
Plans never grant or remove apps: plan change emits `installedAppsChanged: false`.

## Migration 9 — `commercial-subscription-tenant-apps`

- Additive only, single transactional batch, insert-only seeds (starter / growth / pro / internal).
- **Grandfather rule:** every tenant existing at migration time gets `internal` / `active` /
  `migration_grandfathered` with no trial, period, or past-due dates (no expiry clock).
- Only tenants onboarded after DRVO-012 default to a `starter` trial (`TrialDays` from the plan).
- `TenantAppEntitlement.Status` backfilled from `Enabled`; a check keeps both consistent.
- `TenantIndustryPack` backfilled from `SalonPackConfig` (legacy manifest preserved in `ConfigJson`).
- Rollback: revert the application commit (schema is backward compatible), then forward-fix.
  Backup restore only if explicitly required. Drops need explicit approval and only before real use.
- Production order: apply migration 9 **before** merging (deploy runs `drvo:verify`).
- Checksum rule (all file-backed migrations): CRLF/CR are normalized to LF before SHA-256, so
  Windows (`core.autocrlf`) and Linux checkouts produce the same value as the committed git blob.
  LF content hashes exactly as before, so ledger rows recorded from Linux are unchanged.
  Migrations 1/6/7/8 (released before this rule) also accept `legacyChecksums`: the CRLF encoding
  of the identical committed content, in case a ledger row was recorded from a Windows checkout.
  Any other difference still fails. Migration 9 and later carry one canonical checksum only.
- Subscription repair: `drvo:verify` fails if any tenant lacks a subscription (e.g. a tenant
  onboarded by pre-DRVO-012 code during an app rollback). Repair with
  `npm run drvo-012:reconcile-subscriptions -- --expected-database=<db>` (production also needs
  `--allow-production`): insert-only, same grandfather rule, never modifies existing rows.

## Install dependencies (only what code proves)

| Edge | Decision | Evidence |
| --- | --- | --- |
| `purchasing -> inventory` | **Enforced** | Purchase posting calls `applyInventoryMutation` (`src/lib/inventory/purchaseInventory.service.ts`, `src/app/api/purchases/route.ts`). |
| `pos -> treasury` | Not an install dependency | Ledger/accounting posting is infrastructure; **sale ledger posting must continue when Treasury is disabled**. |
| `payroll -> attendance` | Deferred (DRVO-016) | Implementation relationship only (`dailyPayrollReadiness`). |
| `ai-receptionist` | None | Skeleton only. |

## Lifecycle evaluator

`evaluateSubscription(sub, plan, now)` returns `{ allowed, status, reason, warning?, accessEndsAt? }`.
There is no "restricted" mode.

- `trial`: allowed until `TrialEndsAt`, then blocked (`TRIAL_EXPIRED`).
- `active`: allowed.
- `past_due`: allowed with warning for `PastDueGraceDays` after `PastDueSince`, then blocked.
- `suspended`: blocked.
- `cancelled` (**paid-period rule**): allowed with warning until `CurrentPeriodEndsAt` if it is in
  the future; blocked otherwise (no period end = blocked immediately). The allowance only survives a
  cancel from `trial` / `active`; cancelling a `suspended` or `past_due` subscription caps
  `CurrentPeriodEndsAt` at the cancel time, so cancellation never re-grants access.

Transitions: activate (trial|past_due), mark_past_due (active), suspend (trial|active|past_due),
cancel (trial|active|past_due|suspended), reactivate (suspended|cancelled).
Route-level enforcement of the evaluator is DRVO-013.

## Limits

`canCreateBranch` / `canCreateUser` (read-only) and `assertCanAddBranch` / `assertCanAddUser`
(in-transaction, tenant applock + locked usage counts). Wired only into platform tenant onboarding,
where `TenantId` is authoritative.

**Deferred to DRVO-013:** legacy staff routes (`/api/admin/branches/provision`, `/api/users`,
permission seed) resolve tenant context best-effort (`resolveStaffTenantContext` swallows errors),
so they have no authoritative `TenantId` and are intentionally not wired. A static test asserts this.

No fail-open for missing SaaS tables: a missing subscription evaluates to `NO_SUBSCRIPTION` (blocked).

## Compatibility exception (explicit, narrow, tested)

`CASHER_BOOT` commercial and app state is immutable through the platform mutation APIs
(`BOOTSTRAP_TENANT_PROTECTED`, 409). It stays internal/active with every registered app installed,
and `scripts/drvo/platformBootstrap.ts` seeding is unchanged.

## Safe disable

Uninstall sets `Enabled = 0`, `Status = 'disabled'`, `DisabledAt`; rows and domain data are never
deleted. Reinstall re-enables the same row (`InstalledAt` preserved). Pack-required apps and apps
with installed dependents cannot be disabled.

## Platform operator APIs (`requirePlatformOperator`)

- `GET /api/admin/platform/plans`, `GET /api/admin/platform/packs`, `GET /api/admin/platform/apps`
- `POST /api/admin/platform/tenants` — `industryPackCode`, `appCustomizations { add, remove }`, `planCode`, `subscriptionStatus` (trial|active)
- `GET|PATCH /api/admin/platform/tenants/{tenantId}/subscription` — `planCode` **or** `action`, `expectedRevision`, `currentPeriodEndsAt`
- `GET /api/admin/platform/tenants/{tenantId}/commercial-access`
- `GET /api/admin/platform/tenants/{tenantId}/apps`, `POST .../apps/install`, `.../apps/uninstall`, `.../apps/apply-pack`

All mutations emit `PlatformOutbox` events on the same transaction.

## Staging smoke

`npm run drvo-012:smoke` (requires `DRVO_STAGING_DB_PASSWORD`; never reads `.env.local`; refuses
unless `DB_NAME() = last132_agent` and `SUSER_SNAME() = drvo_agent`). Run after
`npm run drvo:migrate` on staging.
