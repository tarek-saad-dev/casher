# Clinics Integration Quality Gate — rollout checklist

## Why
The existing `.github/workflows/ci.yml` runs only for PRs targeting `main`. Clinics PRs are stacked against `feature/drvo-clinics-mvp`, so they currently do not receive that main PR gate automatically.

## New isolated gate
`.github/workflows/clinics-pr-quality-gate.yml`:
- Runs on PRs targeting `feature/drvo-clinics-mvp` when Clinics/Booking/POS/migration paths change, and supports manual `workflow_dispatch`.
- Runs `npm ci --ignore-scripts`, all medical-records tests, selected Booking contracts, all POS tests, and `npm run build`.
- Disables workers and external side effects with staging flags. Checkout has read-only permissions.
- Does **not** deploy, SSH, start the server, connect to staging/production database or apply migrations.
- **Note**: workflows for `pull_request` events must be present/recognized on the target branch for reliable triggering. Review/approve this workflow-only PR before expecting future feature PR checks; then manually dispatch if needed.

## Manual staging QA still required
CI does NOT validate real SQL Server schema, transaction rollback, shifts, payments or print rendering.

Staging sequence (independent of production):
1. Confirm staging DB only; migration readiness 014, 015 and 016; safe backup and explicit approval before applying migration.
2. Shared Booking: patient A with doctor A, patient B doctor B, multiple branches; verify reception and doctor isolation, cancelled/no-show guards and exact check-in → encounter.
3. Encounter: vitals, diagnosis, Rx drafts/sign/print and follow-up; only signed Rx printed.
4. Shared POS: completed *booked* encounter → payment; invoice, treasury and shift values reconcile. Try two simultaneous saves → only one commit; test both modern and legacy POS.
5. Treatment plans: complete visit → 6-session plan; link a Booking for the same patient, doctor and branch → booked. Complete encounter for that Booking → plan progress automatically 1/6. Wrong patient/doctor/branch/tenant, duplicate Booking, incomplete initial visit and simultaneous creates/links fail without writes.
6. Check mobile, desktop, SQL constraint errors, failures, access and inactive subscriptions. Verify Salon and non-clinic tenants unchanged.

## Release policy
- Current Clinics root PR #90 is Draft and must be reviewed before a main merge (which can trigger production deployment).
- This QA gate PR is separated from clinical functionality and migrations.
- Do not mark a feature as verified until GitHub Actions actually report success and staging acceptance is documented. No production migrations or deploys by agents.
