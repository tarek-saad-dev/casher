# DRVO-003 — Platform Core Bootstrap (implementation note)

| Field | Value |
|-------|-------|
| Issue | https://github.com/tarek-saad-dev/casher/issues/9 |
| Authority | [DRVO-002 decision baseline](./DRVO-002-PLATFORM-BLUEPRINT.md) |

## Scope delivered

- Module skeleton under `src/platform`, `src/shared/*`, `src/apps/*`, `src/packs/salon`, `src/legacy`
- Import-boundary checker with a forbidden fixture under `src/platform/__tests__/fixtures/`
- Staging-only migration: `db/migrations/add-drvo-003-platform-core.sql` (runner refuses `last132`)
- Bootstrap seed: `scripts/seed-drvo-003-bootstrap-tenant.ts` (one Location per `TblBranch` row, including inactive branches; refuses a second `Tenant` row). The salon manifest imports platform constants directly so `tsx` does not load `server-only`.
- Staff session resolves `tenantId` + `membershipId` via `resolveStaffTenantContext`
- `tenantLockResource` / `tenantCacheKey` helpers in Platform Core
- `PlatformOutbox` + transaction-aware publisher
- App registry metadata + Salon Pack manifest (`operations` not separately entitled)
- Shared-domain facades with legacy adapters (Customers, Catalog, Workforce occupancy, Operational Calendar, Treasury Money Movement port)
- Unit of Work wrapper around the existing SQL transaction pattern

## Operational constraints (unchanged salon behavior)

| Topic | DRVO-003 state |
|-------|----------------|
| Staging database | `last132_agent` only for migration/seed |
| Production database | `last132` — no access, no migration |
| Entitlement enforcement | **OFF** — no routes blocked |
| `InsCashMoveSales` trigger | **Still live** — sale create must not double-post cash |
| Booking extraction | **Not started** — scheduling remains in `src/lib/booking` |
| Runtime split | **None** — modular monolith, shared DB/schema |
| Legacy `super_admin` | Tenant owner role — **not** platform admin |

## How to apply on staging

Both runners connect, then refuse unless `DB_NAME()` is `last132_agent`. They also refuse the production name `last132` before connecting.

```bash
npx tsx scripts/run-drvo-003-platform-core-migration.ts --expected-database=last132_agent
npx tsx scripts/seed-drvo-003-bootstrap-tenant.ts --expected-database=last132_agent
```

## Staging evidence

Applied on `last132_agent` (login `drvo_agent`) on 2026-09-28:

- `DB_NAME()` = `last132_agent` before migration and seed
- exactly one `Tenant` row, code `CASHER_BOOT` (not `GLEEM`)
- `Location` count 3 = `TblBranch` count 3
- 11 `TenantMembership` rows for 11 active `TblUser` rows
- `resolveStaffTenantContext` returned `tenantId` and `membershipId` for a staff user
- live PlatformOutbox rollback passed and left tenant count at 1 and outbox count at 0
- a second seed run refused because a `Tenant` row already existed
- production database `last132` was not contacted

## Identity note

Bootstrap tenant code is `CASHER_BOOT` (not location code `GLEEM`). One bootstrap tenant maps the current Casher deployment. Second-tenant admission remains gated by DRVO-002 roadmap §5.
