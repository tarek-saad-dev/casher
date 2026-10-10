# DRVO-020 — GA hardening, phase 1

Stacked on DRVO-013. No DB migration, no production action. Phase 2 (production backup, production migration, GA cutover) is out of scope.

## Password hashing

- `src/lib/auth/passwordHash.ts` implements scrypt (N=16384, r=8, p=1) in a compact `s1$<salt>$<key>` format of 47 chars. It fits the existing `TblUser.Password nvarchar(50)` column, so no migration is needed.
- Login (`/api/auth/login`) no longer compares passwords in SQL. It loads the rows for the `loginName`, verifies in constant time, and on a legacy plaintext match rewrites the row to a hash (`UPDATE ... WHERE UserID = @userId AND Password = @previous`). The rewrite is best effort, so a failed upgrade never blocks a valid login.
- Legacy plaintext comparison keeps the old SQL collation semantics (case-insensitive, trailing spaces ignored) so no CUT user is locked out before their first upgraded login. After the upgrade the password is case-sensitive.
- New and changed passwords are always stored hashed: tenant staff user create (`tenantStaffUsers`), the `PUT /api/users/[id]` password change, and the tenant owner created by `provisionTenant`.
- Passwords are never logged. The login route logs through the structured logger, which redacts sensitive keys.

## Tenant-tagged structured logs

`src/lib/observability/logger.ts` writes one JSON line per event: `ts, level, scope, event, tenantId, requestId?, userId?, branchId?`. Keys matching password/secret/token/authorization/cookie/api key/session/otp/pin are redacted at any depth, and fields cannot override the tenant tag. Login is the first adopter; other routes can migrate incrementally.

## Error-tracking seam

`src/lib/observability/errorTracking.ts` exposes `captureException(err, context, extra)` and `setErrorReporter(fn)`. The default reporter writes a tenant-tagged log line, and a vendor SDK can be plugged in without touching call sites. `src/instrumentation.ts` routes Next `onRequestError` through the seam, forwarding path, method and route only (never headers or cookies).

## Health / uptime readiness

- `GET /api/health/live` is public and has no DB dependency. Use it for uptime monitors.
- `GET /api/health/ready` is public. It returns 200 when the DB answers `SELECT 1` and `SESSION_SECRET` is configured, otherwise 503. Probes time out after 3 seconds and failure details are never returned.
- `GET /api/health/db` stays admin-only.

## Backup / restore

The runbook is `docs/drvo/DRVO-020-BACKUP-RESTORE-RUNBOOK.md`. The hook is `npm run drvo:backup`, which is dry-run by default:

- Backups are `COPY_ONLY` with checksum, followed by `RESTORE VERIFYONLY`.
- Production needs `--allow-production`.
- Restore drills can only target `*_restore_check` scratch databases.

## Deploy path

`deploy/deploy-casher` no longer runs the messaging schema migrations (`messaging:migrate-ai`, `-salon-concierge`, `-handoff`, `-booking-management`) on every deploy. They run only when the operator sets `CASHER_APPLY_MESSAGING_SCHEMA=I_HAVE_A_VERIFIED_BACKUP` for that deploy. DRVO migrations were already gated by the Production Migration Control workflow. `.github/workflows/deploy-vps.yml` is unchanged.

## Staging (pending)

The following need staging credentials:

- Log in as a legacy plaintext user and confirm the row becomes `s1$…`.
- Log in again with the hashed row.
- Check that `/api/health/ready` returns 200, and 503 with the DB stopped.
- Run `drvo:backup --execute` and a restore drill on `last132_agent`.
