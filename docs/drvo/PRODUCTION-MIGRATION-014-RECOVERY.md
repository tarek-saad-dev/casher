# Production recovery — pending DRVO migration 014

## Incident
- GitHub Actions production deploy run [40257415481](https://github.com/tarek-saad-dev/casher/actions/runs/40257415481), job 121362138089, failed at `Deploy to VPS` on 2026-10-26.
- `npm run build` passed, but the DRVO verification step reported `Pending migrations: tenant-plan-requests` and stopped before `systemctl restart casher`.
- This can leave previously running application processes using a changed `.next` build directory. Do not claim the runtime is healthy from the `/login` healthcheck alone.
- Migration 014, `tenant-plan-requests`, was introduced by merged PR #118. The deployment intentionally does **not** apply DRVO schema migrations automatically.

## Recovery plan and approvals
1. Keep the migration SQL and manifest unchanged. The existing migration is **additive** (`dbo.TenantPlanChangeRequest` with indexes/constraints), classified `LOW` risk, `requiresBackup: false`, short lock profile; its own production preflight remains authoritative.
2. This **open recovery PR** provides an audited source SHA for the existing production migration control plane, because PR #118 has already been merged and that workflow refuses a closed PR. This is a documented recovery anchor, not a request to merge code before DB migration.
3. Use `.github/workflows/drvo-production-migration.yml` via the trusted `migration-control` branch with `action: PLAN`; inspect the reported production DB identity, migration registry, exact pending keys, digest, checksum drift, risk and lock profile. A PLAN does not mutate production.
4. If PLAN reports precisely `tenant-plan-requests`, no drift, and no other blockers, request **explicit human approval** before issuing the digest-bound `APPLY` through the same workflow. Never manually run `npm run drvo:migrate-production` or use staging credentials to access production.
5. Verify after APPLY: the control-plane report is PASS, `tenant-plan-requests` is recorded with correct checksum and verify hook PASS, and `npm run drvo:verify -- --allow-production` reports no pending migrations.
6. Only then human-approve/merge this PR or otherwise initiate a specifically approved deployment of the current reviewed SHA. A merge into `main` auto-deploys; agents must not merge or dispatch production deploy workflows.
7. Inspect `casher.service`, verify critical app routes including `/admin/hr` and `/income/pos` from an authenticated browser, and record success. The login-only HTTP check is not sufficient.

## Guardrails
- This recovery PR **does not alter** schema SQL, migration IDs/checksums, any production credential, or production database state.
- No schema apply, production restart, deployment or `main` merge may be performed by a QA agent.
- If PLAN reports unexpected migrations, checksum drift, or an unapproved risk, stop and investigate; do not widen the approved pending list.
- If the app is already degraded, coordinate operational recovery and avoid concurrent deploys while confirming the migration plan.
