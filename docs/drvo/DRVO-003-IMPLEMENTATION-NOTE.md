# DRVO-003 — Platform Core Bootstrap (implementation note)

| Field | Value |
|-------|-------|
| Issue | https://github.com/tarek-saad-dev/casher/issues/9 |
| Authority | [DRVO-002 decision baseline](./DRVO-002-PLATFORM-BLUEPRINT.md) |

## Scope delivered

- Module skeleton under `src/platform`, `src/shared/*`, `src/apps/*`, `src/packs/salon`, `src/legacy`
- Import-boundary checker with a forbidden fixture under `src/platform/__tests__/fixtures/`
- Staging-only migration: `db/migrations/add-drvo-003-platform-core.sql` (runner refuses `last132`)
- Bootstrap seed: `scripts/seed-drvo-003-bootstrap-tenant.ts` (refuses a second `Tenant` row)
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

```bash
npx tsx scripts/run-drvo-003-platform-core-migration.ts --expected-database=last132_agent
npx tsx scripts/seed-drvo-003-bootstrap-tenant.ts --expected-database=last132_agent
```

## Identity note

Bootstrap tenant code is `CASHER_BOOT` (not location code `GLEEM`). One bootstrap tenant maps the current Casher deployment. Second-tenant admission remains gated by DRVO-002 roadmap §5.
