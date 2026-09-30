# DRVO Migration Guide

## Workflow (required for all future DRVO extractions modules)

```
feature implementation
  → separate DB tests on staging
  → PR (code + db/drvo-migrations entry + moduleManifest contract)
  → while PR is OPEN: production migration PLAN against exact head
  → explicit human approval
  → production migration APPLY through the migration-control workflow
  → verify migration succeeded
  → merge main
  → automated app deploy (read-only drvo:verify + restart + health)
  → schema ready, business path still follows moduleManifest.rollout
  → later: tiny source-controlled rollout PR (legacy → extracted)
  → merge → deploy verifies readiness → refuses activation if not ready → restart
```

**Never** run ad-hoc SQL on production.  
**Never** SSH to edit `.env` or restart for normal module activation.  
**Never** treat “migrations applied” as “extracted path enabled”.

## Source-controlled rollout

Authority: `src/platform/drvo/moduleManifest.ts`

| Field | Purpose |
|-------|---------|
| `rollout` | `legacy` \| `extracted` — business path after deploy |
| `requiredMigrationKeys` | Schema prerequisites |
| `dependencies` | Other module keys |
| `readinessCheckIds` | Expected verify checks |
| `rollbackRollout` | Target for source-controlled rollback PR |
| `classification` | Audit label (legacy / extracted / always_on_infrastructure / mixed) |

Normal activate: PR changes `rollout: 'legacy'` → `'extracted'`.  
Normal rollback: PR changes `rollout: 'extracted'` → `'legacy'`.

CI rejects `rollout: 'extracted'` when the declared contract is incomplete (`assertExtractedRolloutContract`).

## Env flag role (break-glass only)

Precedence (highest → lowest):

1. `DRVO_FORCE_BOOKING_PATH` / `DRVO_FORCE_QUEUE_PATH` = `legacy` \| `extracted`
2. Compat `BOOKING_SCHEDULING_PORT` / `QUEUE_SCHEDULING_PORT` === `true` → force extracted (testing)
3. Compat `=false` / unset / malformed → **ignored** (defers to manifest)
4. `moduleManifest.rollout`

**Transition note:** production may still contain `BOOKING_SCHEDULING_PORT=false` from the incident pin. That value is **ignored** so a future extracted activation PR does not require SSH to delete the env line. Emergency forced-legacy uses `DRVO_FORCE_BOOKING_PATH=legacy`.

## How to add a migration

1. Create folder `db/drvo-migrations/NNN-your-key/` with `schema.sql` if needed.
2. Add `scripts/drvo/migrations/NNN-your-key.ts` implementing:
   - `apply` (idempotent)
   - `verify` (read-only)
   - optional `reconcileBaseline` (safe production baseline)
3. Register in `scripts/drvo/migrations/index.ts` in order.
4. Update `DRVO_MODULE_REQUIRED_MIGRATIONS` and `DRVO_MODULE_ROLLOUT` (keep keys aligned).
5. Add tests in `scripts/drvo/__tests__/`.
6. Run `npm run drvo:migrate -- --expected-database=last132_agent` on staging.

Released migrations are **immutable** — checksum changes fail deploy.

## How to add a module (DRVO-008+)

1. Declare the module in `DRVO_MODULE_ROLLOUT` with:
   - `requiredMigrationKeys`, `dependencies`, `readinessCheckIds`
   - `rollout` (start as `legacy` for strangler cutovers)
   - `rollbackRollout`, classification + rationale
2. Add readiness checks in `scripts/drvo/readiness.ts` when needed.
3. Gate runtime path with `isDrvoModuleExtractedPathEnabled('<module>')`.
4. Keep first merge `rollout: 'legacy'` until staging-proven; activate via a separate tiny PR.

## Local / staging verification

```bash
npm run drvo:migrate -- --expected-database=last132_agent
npm run drvo:verify
npm run drvo-004:smoke-read
```

Staging-only legacy scripts (`drvo-003:migrate`, `drvo-003:seed`) still refuse `last132`.

## Production migration + deploy

Production DDL is **not** applied by `deploy/deploy-casher`.

While the migration PR is still open, use `.github/workflows/drvo-production-migration.yml`:

1. PLAN against the exact PR head.
2. Review the migration list and manifest digest.
3. Explicitly approve APPLY.
4. APPLY through the migration-control workflow.
5. Verify the migration result.
6. Merge the PR.

After merge, `deploy/deploy-casher` runs only:

```bash
npm run drvo:verify -- --allow-production
```

Then restart + health check. Pending or mismatched DRVO migrations fail closed before restart. No ad-hoc production SQL or env step.

If a module has `rollout: 'extracted'` and readiness fails, verify reports  
`REFUSING extracted activation for <module>: …` and exits non-zero.

## Rollback

- **Schema**: forward-only; migrations are idempotent and non-destructive.
- **Behavior (normal)**: PR sets `rollout` back to `legacy` (or prior value) and deploy.
- **Behavior (emergency)**: set `DRVO_FORCE_BOOKING_PATH=legacy` (or queue equivalent) — not the normal workflow.

## Registry table

`dbo.DrvoSchemaMigration` records applied migrations with checksum and commit SHA.
