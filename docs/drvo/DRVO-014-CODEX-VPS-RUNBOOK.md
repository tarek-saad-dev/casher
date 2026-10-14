# DRVO Clinics — Codex + GitHub + VPS workflow

No Cursor Cloud required. The existing `main` push workflow deploys the **application** to the VPS automatically. It **does not apply DRVO production database migrations**.

## 1. Development
- Work in `feature/drvo-clinics-mvp` (draft PR #90), not `main`.
- Run `npm ci`, `npm test`, typecheck and `npm run build`.
- Keep medical data tenant-scoped and require human clinician authorization for clinical writes/signing.

## 2. Staging execution from Codex on the VPS
- Use a **separate, disposable checkout** outside `/home/casher/app` and **never** run staging commands from the production app directory.
- Checkout the exact PR HEAD SHA. Ensure the checkout contains **no** `.env`, `.env.local`, `.env.production`, or `.env.production.local`.
- Supply `DRVO_STAGING_DB_PASSWORD` for the **staging-only** SQL login `drvo_agent` through an approved secure environment/secret source; never copy the production password or commit the value.
- Run `npm ci`, then `npm run drvo-014:preflight` and `npm run drvo-014:staging-plan` from the VPS. These read-only checks verify `last132_agent / drvo_agent`, require `HAS_DBACCESS('last132') = 0`, and print the applied/pending migration inventory.
- If preflight fails, STOP. Do not bypass with the production deploy identity.

## 3. Migration review and staging smoke
- Inspect the migration registry and pending manifest first. **Important:** `npm run drvo:migrate` applies **all pending DRVO migrations**, not only 014. Do not run it without reviewing the full pending list and migration impact.
- Back up staging and validate a rollback/forward-fix plan before schema changes. Use only the isolated staging credentials and explicitly expected database `last132_agent`.
- After approved staging migration(s), run `npm run drvo:verify` and `npm run drvo-014:smoke`. The clinic smoke now fails closed if a local production env file is present or the staging SQL login can access `last132`; it expects `DRVO_STAGING_DB_PASSWORD`. On VPS use `DRVO_STAGING_DB_SERVER=127.0.0.1` and `DRVO_STAGING_DB_PORT=1433`.
- Verify cleanup of synthetic `DRVO014_` tenants, then run DRVO-011/012 regressions and final verify.
- Treat the clinic smoke as **unverified** until its first real staging run passes.

## 4. Production gate
- PR #90 remains draft until CI, security review, staging identity proof, migration verification, clinical smoke and regressions pass.
- Production DRVO migrations are separately controlled. Plan, review, back up, explicitly approve and apply required migrations **before** merging code that depends on them.
- Only then merge into `main` and observe the existing automatic VPS deploy, health checks and logs. Do not add auto-migrations to `deploy/deploy-casher`.
