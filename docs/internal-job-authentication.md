# Internal Job Authentication (Phase 1A)

**Date:** 2026-07-22  
**Helper:** `requireSystemJobAuth` in `src/lib/api-auth.ts`  
**Edge:** `CRON_BEARER_PREFIX_ROUTES` in `src/lib/proxyPublicRoutes.ts`

---

## Mechanism

| Item | Value |
|------|-------|
| Method | `Authorization: Bearer <token>` |
| Secret source | Environment variable `CRON_SECRET` |
| Production | Secret **must** be set; bearer must match; missing secret ⇒ reject bearer path |
| Development | If `CRON_SECRET` unset, bearer literal `dev` accepted at edge/helper; prefer setting a real secret |
| Alternate | Authenticated **admin** session (`requireAdmin`) for manual runs |
| Browser exposure | **Never** embed `CRON_SECRET` in client bundles |

---

## Endpoints

| Endpoint | Caller | Auth method | Failure | Logging |
|----------|--------|-------------|---------|---------|
| `POST/GET /api/admin/hr/nightly-close` | `npm run nightly-close` → `scripts/run-nightly-close.ts`; Windows Task Scheduler | Bearer `CRON_SECRET` **or** admin session | `401` JSON | Route `console.error` on failures; service result payload |
| `POST /api/payroll/daily/auto-generate` | Nightly orchestration / scheduler | Bearer `CRON_SECRET` **or** admin session | `401` | Route errors to console |
| `/api/cron/*` | Reserved | Edge Bearer gate | `401` | No handlers today |

---

## Secret rotation strategy

1. Generate a new high-entropy `CRON_SECRET`.
2. Update server environment / Task Scheduler credential store.
3. Restart Node process / scheduler jobs.
4. Revoke old secret by removal from env.
5. Verify one dry-run nightly-close with new bearer.

No in-app UI rotation. Do not commit secrets to git.

---

## Failure behavior

* Missing/invalid bearer and no admin session → `401` at edge and/or handler.
* Production with unset `CRON_SECRET` → bearer auth fails (no anonymous open).
* Business validation failures (attendance incomplete, etc.) remain `422`/`409` **after** auth succeeds.

---

## Sync infrastructure

`sync-service` uses its own process credentials and DB connectivity. It is **not** authenticated via these HTTP job routes and is **not** a branch mechanism. No change in Phase 1A beyond documenting that it must not be used as branch transport.

---

## Local print service

`http://127.0.0.1:7788` is a workstation-local companion, not an HTTP route in this Next app. Out of scope for `CRON_SECRET`.
