# DRVO ERP — RBAC + module entitlement staging readiness

**State:** review only. No migrations applied by this document. Target is the isolated staging SQL Server database `last132_agent` only. Production `last132` is excluded.

## Read-only evidence to collect

1. Confirm the SQL connection reports `DB_NAME() = last132_agent` and the staging application remains isolated from production.
2. Run `docs/drvo/staging-rbac-module-readiness.sql` with a read-only SQL account. Capture its output. It inspects columns, keys, foreign keys, and backup history without changing tables.
3. Compare real `Tenant`, `TenantMembership`, and `Location` keys/types against `tenant-rbac-schema-proposal.sql` and `tenant-module-entitlements-schema-proposal.sql`. Check membership duplicates and existing indexes separately before creating the proposed unique index.
4. Verify an isolated backup file exists and is readable; run `RESTORE VERIFYONLY` and a restore drill into a **separate staging restore database** with explicit approval. Backup history alone is **not** proof of restorable backup.
5. Review migration order, rollback procedure, permissions, and tenant isolation tests. No default role or module grants.
6. Only after explicit approval, produce reviewed versioned migrations for staging and rerun the isolated smoke tests. Never use production migration flags.

## Current blockers

- No verified restorable staging backup has been provided.
- Actual staging schema inspection results have not been provided.
- RBAC and module entitlement SQL files are **proposals**, not applied migrations.
- The CI workflow tests/builds and may deploy app code, but it does **not** run database migrations.

## Acceptance criteria

- Confirmed database name and current schema evidence
- Verified backup **and** restore drill evidence
- Reviewed migrations and rollback
- No cross-tenant membership grants or entitlement leakage
- Missing/suspended/expired modules denied
- Permissions remain fail-closed with missing schema
- Successful staging CI and smoke, with production untouched
