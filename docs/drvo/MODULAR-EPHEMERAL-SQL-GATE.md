# DRVO ERP — Disposable SQL Server integration gate for migrations 019–022

**Purpose:** Prove real SQL Server DDL constraints before an isolated Staging environment becomes available. **This is not a staging test or a commercial release approval.**

- `.github/workflows/drvo-modular-ephemeral-sql.yml` starts a one-off Microsoft SQL Server 2022 container inside the GitHub Actions job. The SA password is **synthetic test-only**, committed in the workflow only for the ephemeral container, not a real account password. There are **no GitHub secrets** or production/staging DB config passed to this job.
- `scripts/drvo/integration/modular-sql-fixture.ts` requires `DRVO_MODULAR_SQL_FIXTURE=1`, `GITHUB_ACTIONS=true`, `CI=true`, fixed loopback `127.0.0.1:14331`, local fixture DB name `drvo_modular_ci_fixture` and refuses application DB host environment variables. Creates only a fresh fixture DB and two minimal synthetic tenancy references inside this container.
- Runs exact migration SQL files **019, 020, 021, 022** and their structural verifiers against real SQL Server.
- Inserts synthetic reviewed research and pending policy, validates rejection of foreign-key bypass, duplicate research candidate, illegal commercial approval state, reviewer self-approval, duplicate policy revision, cross-tenant quote snapshot, illegal paid state, deadline exceeding 48h and duplicate snapshot. Stores one internal-only snapshot, reloads it, validates its hash and 48-hour boundary.
- Validates only synthetic data; the SQL container is destroyed after the job.

**Still required:** isolated actual Staging with the five staging-only secrets including `DRVO_STAGING_SSH_HOST`, migration 015–022 ledger/structure checks, live authenticated operator API/retries/tenant security tests and Cut Salon booking/invoice/day-close regressions. No real customer quote/order/payment/activation. PR #154 and Draft #157 remain **DO NOT MERGE** pending real staging and production signoff.

## Real operator services SQL integration (same disposable fixture)

The SQL workflow runs `src/platform/__tests__/modularEphemeralServiceSql.test.ts` after fixture setup. It mocks only the DB connection injection and the Next-only `server-only` import, **not** the actual commercial services. It calls `createCommercialReleaseCandidate`, `getCommercialReleaseCandidate`, `submitCommercialPolicyEvidence`, `reviewCommercialPolicyEvidence`, `listCommercialPolicyEvidence`, `createInternalQuoteSnapshot` and `listInternalQuoteSnapshots` against the same synthetic SQL fixture. Required scenarios: duplicate preparation, review independence, revision 2, repeat review idempotence, actual snapshot create/retry and closed-inquiry rejection. A green result still does not replace real authenticated Staging E2E.

## Merge evidence ledger (26 Oct 2026)

| Gate | Evidence source | Meaning |
| --- | --- | --- |
| SQL schema and constraint tests | `DRVO Modular Disposable SQL Integration` | Synthetic SQL 019–022 real DDL and tamper/cross-tenant rejection |
| Server-side transaction integration | `modularEphemeralServiceSql.test.ts` in disposable SQL workflow | Actual server-side commercial services on isolated SQL, including idempotent requests and independent review |
| Normal app CI | `CI` on PR #157 head | Security regression, pricing/migration policy and production build |
| Actual staging | `DRVO Modular Commercial Staging Read-Only Gate` | **Blocked:** missing `DRVO_STAGING_SSH_HOST`; cannot infer real DB/readiness/UX E2E |

Do not report stages as PASS until the exact current head completes the corresponding workflow. None of these checks authorizes publication of tariffs or production deploy.
