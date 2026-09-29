# DRVO Migration System — Implementation Note

| Field | Value |
|-------|-------|
| Baseline | `60560df` |
| Branch | `fix/drvo-004-production-booking-bootstrap` |

## 1. Current migration topology (before)

| Module | Schema SQL | Bootstrap data | Deploy step | Flag |
|--------|------------|----------------|-------------|------|
| DRVO-003 Platform Core | `db/migrations/add-drvo-003-platform-core.sql` | `scripts/seed-drvo-003-bootstrap-tenant.ts` | **None on production** (staging-only scripts refuse `last132`) | N/A |
| DRVO-004 Booking | Uses Platform Core | None | None | Was default **ON** (`!== 'false'`) → production regression |
| DRVO-005 Queue | None | None | None | Default **ON** (`!== 'false'`) |
| DRVO-006 Operational Calendar | None (adapter only) | None | None | Always-on via composition |
| DRVO-007 Treasury | `db/migrations/add-drvo-007-treasury-movement-registry.sql` | None | `treasury:migrate-drvo-007 --allow-production` | Always-on on income/expense routes |

Deploy also runs unrelated messaging migrations individually. No central registry, no ordering contract, no checksum immutability.

## 2. Historical gaps discovered

1. **DRVO-003 never reached production automatically** while DRVO-004 merged with default-on extracted path.
2. **Treasury migration ran on deploy** but depends on `dbo.Tenant` FK — ordering hazard if Platform Core absent.
3. **Booking + Queue flags default-on** — deploy could activate extracted paths without prerequisite guarantee.
4. **No baseline reconciliation** — production state could not be registered safely if schema existed but was untracked.
5. **Ad-hoc one-off npm scripts** — no unified verify, no dependency graph enforcement.

## 3. Dependency graph (code-derived)

```
001-platform-core (schema)
  └─ 002-platform-bootstrap (CASHER_BOOT, Location, Membership, LegacyIdMap, AppRegistry)
       ├─ 003-booking-prerequisites (verify marker)
       ├─ 004-queue-prerequisites (verify marker)
       ├─ 005-operational-calendar-prerequisites (verify marker)
       └─ 006-treasury-movement-registry (schema; FK → Tenant)
```

Runtime module dependencies:

- **Booking extracted path**: Platform Core + bootstrap tenant + PlatformOutbox + Workforce adapter (legacy, no extra schema)
- **Queue extracted path**: Platform Core + bootstrap + Customers port
- **Operational Calendar**: Platform Core + bootstrap tenant
- **Treasury**: Platform Core + bootstrap + Operational Calendar adapter + `TreasuryMovementRegistry`

## 4. Registry design

Table: `dbo.DrvoSchemaMigration`

| Column | Purpose |
|--------|---------|
| MigrationId | Stable integer order key |
| MigrationKey | Stable string slug (`platform-core`) |
| Name | Human label |
| Checksum | SHA-256 of migration artifact(s) |
| AppliedAtUtc | When recorded |
| AppCommitSha | Deploy commit (optional) |
| ExecutionMs | Duration |

Rules:

- Migrations run in ascending `MigrationId` order.
- Applied migration with **different checksum** → hard fail (immutable released migrations).
- Failed apply → transaction rollback, **no registry row**.
- Baseline reconciliation registers existing valid state without destructive SQL.

## 5. Baseline / reconciliation strategy

| Migration | Baseline when |
|-----------|---------------|
| 001-platform-core | All eight Platform Core tables exist |
| 002-platform-bootstrap | Exactly one `CASHER_BOOT` tenant + Location count = TblBranch count + memberships complete |
| 003–005 | Underlying verify checks pass (read-only) |
| 006-treasury | Registry table + reversal columns exist |

If state is **partial or ambiguous** (e.g. two tenants, branch ID mismatch) → abort with explicit error. Never guess.

## 6. Deployment order (after)

```
sync → npm ci → build → drvo:migrate-production → drvo:verify → restart → health
```

Feature flags / env overrides remain **separate** from schema migration and are **not** required for normal deploy. Business path is source-controlled via `moduleManifest.rollout` (booking/queue stay `legacy` on this branch). See [DRVO-ROLLOUT.md](./DRVO-ROLLOUT.md). Leftover `BOOKING_SCHEDULING_PORT=false` on production is ignored so a later activation PR needs no SSH env cleanup.

SalonPackConfig bootstrap is **insert-only** — existing ManifestJson is never overwritten by platform-bootstrap.

`TblBookingHold.HoldKey` is widened to NVARCHAR(200) via migration `booking-hold-key` (central DRVO lifecycle).

Staging scripts (`drvo-003:migrate`, `drvo-003:seed`) **unchanged** — still refuse production `last132`.
