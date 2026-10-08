# DRVO GA runbook (DRVO-020 phase 2)

This is the order of operations for the final GA gate. It is a plan only: nothing here has been run yet. Production is touched in exactly two places: step 6 (PLAN, read-only) and step 8 (APPLY, after explicit operator approval, outside this gate). Results go into `DRVO-GA-EVIDENCE.md`.

## 0. Preconditions

- The stack is linear and green. Bottom to top:

  | PR | Ticket |
  |---|---|
  | #63 | DRVO-012 |
  | #66 | DRVO-013 |
  | #68 | DRVO-015 |
  | #65 | DRVO-017 |
  | #67 | DRVO-018 |
  | | DRVO-016 |
  | | DRVO-019 |
  | #72 | DRVO-020 phase 1 |

  Every PR is draft and conflict-free.
- The top of the stack (`drvo-020-ga-hardening`) passes `npm run build` and the full vitest suite once (`--maxWorkers=2`). Failures are compared against the recorded pre-existing list; no new failures are allowed.
- Migration checksums match the table in `DRVO-GA-EVIDENCE.md`. If any checksum differs, **stop**.
- Staging credentials are available: `DRVO_STAGING_DB_PASSWORD` (smokes never load `.env.local`) and staging VPS access. Production credentials are never used for steps 1–5.

## 1. Deploy the stack to staging

1. Deploy `drvo-020-ga-hardening` to the staging host (not `deploy-vps.yml`, which targets production).
2. Run `npm run drvo:backup -- --backup-dir=<staging backup dir> --execute` (evidence row 17, part 1).
3. Run `npm run drvo:migrate -- --expected-database=last132_agent`, then `npm run drvo:verify` (row 19). Alternatively, run the `drvo-staging-gate.yml` workflow.
4. Messaging schema scripts are applied only with `CASHER_APPLY_MESSAGING_SCHEMA=I_HAVE_A_VERIFIED_BACKUP`, after step 2.

## 2. Automated smokes (staging, sequential, one at a time)

```bash
npm run drvo-011:smoke   # row 1
npm run drvo-012:smoke   # rows 5, 6, 7
npm run drvo-013:smoke   # row 8
npm run drvo-015:smoke && npm run drvo-015:verify   # row 9
npx tsx scripts/drvo/drvo-017-onboarding-smoke.ts   # rows 1, 2, 4, 6, 7
npm run drvo-016:smoke   # row 10
npm run drvo-019:smoke   # row 12
```

Each smoke refuses `last132` and cleans up its synthetic tenants. Save the full output of each run.

## 3. Manual proofs (staging)

- **Password hashing** (row 3): run the SQL check for the owner, then the legacy-user upgrade and re-login.
- **Messaging isolation** (row 11): bind two channels (`npm run drvo-018:bind-channel`), then run the cross-token webhook test, an outbox send per tenant, and an AI turn per tenant. Use the SQL tenant checks listed in the evidence row.
- **Salon full flow** (row 13) and **non-salon flow** (row 14): screenshots for each step.
- **No CUT fallback** (row 15): call generic public booking without `branchCode`, then call a staff route with tenant B's session against CUT ids. Expect 4xx for both.
- **Health** (row 16): curl `live` and `ready`. Stop SQL briefly and confirm `ready` returns 503.
- **Restore drill** (row 17, part 2): restore into `last132_agent_restore_check`, run `drvo:verify`, then drop the scratch DB.

## 4. CUT regression (row 18)

On staging with a fresh copy of CUT data:
- login (legacy password upgrades)
- POS sale and shift close
- cutsaloon booking flow (unchanged origin behaviour)
- nightly close for both CUT branches
- HR WhatsApp report (CASHER_BOOT-only seam)
- WhatsApp send through the CUT tenant channel

Compare day totals against the pre-migration snapshot.

## 5. Full test suite at the top of the stack

Run this once, after all staging rows pass, if code changed in the meantime: `npx vitest run --maxWorkers=2`. Attach the summary.

## 6. Production migration PLAN (read-only)

Push a `migration-control` command with action `PLAN` for the merged migration PR (DRVO Production Migration Control workflow). Attach the PLAN output, manifest digest and migration list (row 20). **Do not APPLY in this gate.**

## 7. GA decision

Every evidence row is `PASS` (row 20 only needs PLAN), and engineering and operator sign-offs are recorded. Then merge the stack bottom-up (#63 → … → #72). Merging is an operator decision and is not part of this gate.

## 8. Production cutover (after GA approval, operator only)

1. Production backup: run `npm run drvo:backup -- --backup-dir=… --execute --allow-production` and copy the file off-host. Record the reference.
2. Migration Control `APPLY` with the approved manifest digest, migration list and backup reference.
3. Deploy via `deploy-vps.yml`. Messaging schema scripts run only with the explicit backup acknowledgement.
4. Post-deploy checks:
   - `/api/health/ready` returns 200.
   - `npm run drvo:verify -- --allow-production` passes.
   - CUT login and a POS sale work.

Rollback: restore the step-1 backup per `DRVO-020-BACKUP-RESTORE-RUNBOOK.md` ("Real restore"), then redeploy the previous `main` SHA.
