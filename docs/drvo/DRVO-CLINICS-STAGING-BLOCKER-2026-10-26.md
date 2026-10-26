# DRVO Clinics Staging Blocker — Dependency Ownership

## Evidence (2026-10-26)
- Branch `feature/drvo-clinics-mvp`, workflow `DRVO Staging Branch Gate`.
- Run 40267114256: `check` passed, read-only `audit` passed, `deploy` failed while running `npm ci --ignore-scripts`.
- Log: `EACCES: permission denied, rmdir .../drvo-clinics-work/node_modules/@adobe/css-tools`.
- Earlier run 40264716471: `EACCES: permission denied, unlink .../node_modules/.bin/acorn`.
- That is a filesystem **ownership/permission blocker on the staging checkout**. It is not evidence that SQL migrations, patient billing, printed prescriptions, or treatment sessions have passed their real-world smoke tests.
- Successful Clinics CI run 40266397654 covered Vitest suites and production compilation, but did not operate on staging SQL Server.

## Safe staging-only operator procedure (requires authorized VPS operator)
1. Confirm machine, current Unix user, checkout realpath and service; **do not perform any migration or production restart**.
2. Inspect rather than mutate:
   ```bash
   id
   readlink -f /home/casher/drvo-clinics-work
   stat -c '%U:%G %a %n' /home/casher/drvo-clinics-work/node_modules
   find /home/casher/drvo-clinics-work/node_modules -xdev ! -user casher -print -quit
   ```
3. Resolve only those mismatched staging checkout dependency files, under explicit operator change control, with a verified `/home/casher/drvo-clinics-work` path. **Never use recursive chown against `/home/casher`, `/home/casher/casher`, or any production checkout.** Avoid symlink following and inspect path ownership first.
4. Re-run isolated staging branch gate; require clean dependency install and staging service health before any authenticated clinical smoke.
5. Verify isolated staging DB, backup, and migrations 014 then 015 then 016 through an authorized staged migration process. Do not run `drvo:migrate` until that condition is met.
6. With synthetic clinic patients only, test Booking → Encounter/Rx → POS invoice/payment → sessions, including duplicate concurrent billing rejection and tenant/branch isolation. No real patient or production payment data.

## New guard
`drvo-staging-branch-gate.yml` now reports `STAGING_DEPLOY_BLOCKED: STAGING_DEPENDENCY_OWNERSHIP` before `npm ci` when staging `node_modules` contains files not owned by the connected staging deploy account. It **does not** repair permissions, bypass egress/preview safety gates, deploy by itself, run migrations or alter the production checkout.

Status: **blocked**, awaiting authorized staging-only filesystem repair and rerun. Merge through normal review; target PR #90/main remains unmerged.
