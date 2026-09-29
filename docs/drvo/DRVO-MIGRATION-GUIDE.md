# DRVO Migration Guide

## Workflow (required for all future DRVO extractions)

```
feature branch
  → development/staging database
  → code + db/drvo-migrations entry
  → tests (unit + drvo:verify on staging)
  → PR
  → merge main
  → automated deploy (drvo:migrate-production + drvo:verify)
  → application restart
  → optional feature flag rollout (explicit opt-in)
```

**Never** run ad-hoc SQL on production. **Never** enable extracted module flags in deploy scripts.

## How to add a migration

1. Create folder `db/drvo-migrations/NNN-your-key/` with `schema.sql` if needed.
2. Add `scripts/drvo/migrations/NNN-your-key.ts` implementing:
   - `apply` (idempotent)
   - `verify` (read-only)
   - optional `reconcileBaseline` (safe production baseline)
3. Register in `scripts/drvo/migrations/index.ts` in order.
4. Add module readiness keys to `DRVO_MODULE_REQUIRED_MIGRATIONS` if a module depends on it.
5. Add tests in `scripts/drvo/__tests__/`.
6. Run `npm run drvo:migrate -- --expected-database=last132_agent` on staging.

Released migrations are **immutable** — checksum changes fail deploy.

## How to add a module dependency

1. Update `DRVO_MODULE_REQUIRED_MIGRATIONS` in `scripts/drvo/migrations/index.ts`.
2. Update `DRVO_MODULE_ROLLOUT` in `src/platform/drvo/moduleManifest.ts`.
3. Add readiness checks in `scripts/drvo/readiness.ts` if needed beyond migration keys.
4. Use strict opt-in flag (`=== 'true'`) for strangler cutovers.

## Local / staging verification

```bash
npm run drvo:migrate -- --expected-database=last132_agent
npm run drvo:verify
npm run drvo-004:smoke-read
```

Staging-only legacy scripts (`drvo-003:migrate`, `drvo-003:seed`) still refuse `last132`.

## Production deploy (automatic)

`deploy/deploy-casher` runs:

```bash
npm run drvo:migrate-production -- --allow-production
npm run drvo:verify -- --allow-production
```

Failure aborts deploy before restart. No operator SQL step.

## Rollback

- **Schema**: forward-only; migrations are idempotent and non-destructive.
- **Behavior**: disable module rollout flags (`BOOKING_SCHEDULING_PORT=false` or unset).
- Legacy booking/queue paths remain when flags are not exactly `true`.

## Registry table

`dbo.DrvoSchemaMigration` records applied migrations with checksum and commit SHA.
