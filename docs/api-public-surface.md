# API Public Surface (Phase 1A)

**Date:** 2026-07-22  
**Proxy source of truth:** `src/lib/proxyPublicRoutes.ts` + `src/proxy.ts`  
**Principle:** Default deny for internal APIs. Explicit allowlist for anonymous access. Route handlers remain authoritative.

---

## Classification legend

| Class | Meaning |
|-------|---------|
| Intentionally public | Anonymous OK |
| Public with rate limiting | Anonymous OK; abuse controls required in handler |
| Internal authenticated | Session cookie required |
| Admin-only | Session + admin/super_admin (or page ACL) |
| Development-only | 404 in production; admin in development |
| Scheduled-system endpoint | Bearer `CRON_SECRET` and/or admin session |
| Legacy/deprecated | Retained but locked down (e.g. 410 approvals) |
| Unsafe and must be protected | Was exposed; fixed in Phase 1A |

---

## Edge allowlist (anonymous without session)

| Path | Class | Reason |
|------|-------|--------|
| `/login` | Intentionally public | Login page |
| `/api/auth/login` | Intentionally public | Credential exchange |
| `/api/public/*` | Public with rate limiting | Public booking + client loyalty/store surfaces |

**Explicitly removed from allowlist in Phase 1A:**

* `/api/admin/` (blanket)
* `/api/operations/flow-board`
* Generic `/api/` bypass (never existed as full bypass; confirmed not added)

---

## Cron-bearer paths (no session cookie, Bearer required)

| Path | Class | Caller |
|------|-------|--------|
| `/api/cron/*` | Scheduled-system | Reserved prefix (no handlers today) |
| `/api/admin/hr/nightly-close` | Scheduled-system | `scripts/run-nightly-close.ts` / Task Scheduler |
| `/api/payroll/daily/auto-generate` | Scheduled-system | Nightly / auto payroll |

---

## `/api/public/*` (intentionally public families)

| Family | Class | Notes |
|--------|-------|-------|
| `/api/public/booking/*` | Public + rate limit on create | Discovery create plan cancel; branch selection required in later phases |
| `/api/public/client/*` | Public with client proof | Phone/profile/loyalty/store — not POS session |

Every public route must remain free of treasury/payroll/admin data.

---

## Internal authenticated (session required at edge + handler)

All other `/api/*` routes after Phase 1A, including:

* Sales, expenses, incomes, deductions, treasury
* Operations queue/bookings/flow-board
* Payroll/ledger/targets (handler ACL)
* Admin HR/reports/permissions (handler ACL)
* Budget, customers (non-public), services admin
* `/api/health/db` (now **Admin-only** at handler — exposes `@@VERSION`)
* `/api/db/toggle` (**Development-only** admin)
* `/api/branches/available` and `/api/branches/active` (Phase 1B read-only; session required; no switch endpoint)

---

## Admin routes — post Phase 1A posture

| Area | Class | Guard |
|------|-------|-------|
| Store CRUD / clear / stock | Admin-only (page `/admin/cut-club`) | `requirePageAccess` |
| Migrate / seed / fix / test / cleanup-queue / booking-debug | Development-only | `requireDevelopmentAdmin` |
| Permissions migrate/seed | Admin-only | `requireAdmin` |
| HR nightly-close | Scheduled-system | `requireSystemJobAuth` |
| HR ledger / reports already using page ACL | Admin-only / page ACL | unchanged pattern |
| Approvals approve/reject | Legacy/deprecated | 410 |
| WhatsApp test-send / status | Development-only | `requireDevelopmentAdmin` |

---

## Routes that were unsafe and are now protected

See `docs/branch-phase-1a-security-closure.md` for the exhaustive change list. Highlights:

* Blanket `/api/admin/` edge public → removed
* Store mutations without handler auth → `requirePageAccess`
* `db/toggle` unauthenticated → development admin only + 404 in production
* Flow-board anonymous → `requirePageAccess('/operations')`
* Payroll targets optional session → `requirePageAccess('/admin/hr')`
* Auto-generate open when `CRON_SECRET` unset → `requireSystemJobAuth`

---

## Non-goals of this document

* Does not invent branch query params.
* Does not declare UI pages public.
* Does not replace handler authorization.
