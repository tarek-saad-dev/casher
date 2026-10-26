# DRVO ERP — Modular Commercial Staging Read-Only Gate

**State:** implementation in **Draft PR #157** stacked on **PR #154**. This does not constitute Staging verification or a Merge approval.

## Existing blocking reason

The existing `.github/workflows/drvo-staging-gate.yml` is the earlier **DRVO-012** migration/reconciliation workflow, with a branch-specific conditional. It is **skipped** on modular-commercial PR branches; a green GitHub build **is not a staging integration test**.

## New isolated DB preflight

Files:
- `.github/workflows/drvo-modular-staging-readonly.yml` — first-party PR #157 branch only, only on PRs targeting `main`.
- `scripts/drvo/check-modular-commercial-staging.ts` — strictly read-only SQL client.
- `src/platform/commercial/modularStagingReadiness.ts` — reusable identity/migration/schema/data verifiers.
- `src/platform/__tests__/modularStagingReadiness.test.ts` — static and negative-target guard tests in normal CI.

Security requirements:
1. **Only** `DRVO_STAGING_SSH_HOST`, `DRVO_STAGING_SSH_KEY`, `DRVO_STAGING_SSH_KNOWN_HOSTS` and `DRVO_STAGING_DB_PASSWORD`; never falls back to the production VPS host.
2. The staging host's key must be pre-pinned in `DRVO_STAGING_SSH_KNOWN_HOSTS` (no `ssh-keyscan` in the workflow); missing secrets fail the job explicitly.
3. A strict local SSH tunnel `127.0.0.1:14330`, exact database `last132_agent`, original/effective login `drvo_agent`, plus an explicit `DRVO_MODULAR_STAGING_READ_ONLY=1` guard. Wrong target exits **before querying application tables**.
4. Schema and registry verification of DRVO migrations **15–22**, including registry checksums and trusted SQL foreign keys/check constraints on 19–22.
5. Read-only integrity scan of all candidate source digests and all stored internal quote snapshot digests and associations. Any violation fails.
6. Reports counts/check states only; no secrets, tenant names or research price amounts emitted.
7. There are **no DDL/DML/migration/fixture writes** in this job. Explicit output fields `mutationsPerformed:false`, `customerCheckoutTested:false`, `productionTouched:false`.

## IMPORTANT: what it still cannot prove

- New migrations 020–022 have **not been applied** by this workflow. If missing, the job fails; apply separately with a controlled staging migration process after confirming the staging identity and backup/audit requirements.
- If there are zero research candidates or snapshots, the job confirms **schemas**, but does not constitute successful operator write/replay E2E.
- Does not exercise real browser login/403, quote lab save/retry, concurrent review, booking/shift-close/invoice flows or any payment.
- It deliberately cannot approve real prices or publish catalogs and cannot activate a tenant subscription.

## Run and release sequencing

1. Trigger the PR #157 read-only staging gate after ensuring the **four staging-only secrets** are configured. PR #157 must temporarily target `main` (as used by its CI policy); restore base `agent/modular-quote-lab-v1` afterward.
2. Capture failed readiness checks and apply pending migrations **only** through separately authorized isolated staging deployment.
3. Re-run the preflight; then run actual operator/tenant API E2E using dedicated disposable stage fixtures and cross-tenant permissions.
4. Only after PR #154 and PR #157 pass staged verification and commercial decisions are formally approved may future sale-catalog functionality be considered. Neither PR currently authorizes Merge or production deployment.

**Coverage flags:** The JSON report explicitly emits `sampleCandidateCoverage` and `sampleSnapshotCoverage`. With zero records, the preflight may check database structure, but it **cannot** count as tested create/replay/customer journeys.
