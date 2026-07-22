# Phase 1A Security Closure

**Date:** 2026-07-22  
**Scope:** Authentication/authorization hardening + architecture decision freeze  
**Out of scope:** Branch tables, BranchID columns, migrations, UI switcher, financial logic changes

---

## 1. Original security finding

From Phase 0 audit (`docs/branch-architecture-audit.md`):

* `src/proxy.ts` treated **`/api/admin/`** as edge-public.
* `/api/operations/flow-board` was edge-public with no handler auth.
* `/api/db/toggle` had no authentication.
* Many admin store/migrate/seed/debug handlers had **no route-level auth**.
* Payroll targets GET/generate treated session as optional.
* `POST /api/payroll/daily/auto-generate` allowed anonymous access when `CRON_SECRET` was unset.
* Proxy defense was incorrectly relied upon as primary authorization for admin APIs.

---

## 2. Exact routes changed

### Critical hotspots

| Route | Change |
|-------|--------|
| `src/proxy.ts` | Explicit allowlist; removed `/api/admin/` and flow-board public bypass |
| `src/app/api/db/toggle/route.ts` | `requireDevelopmentAdmin` (404 production) |
| `src/app/api/operations/flow-board/route.ts` | `requirePageAccess('/operations')` |
| `src/app/api/payroll/daily/targets/route.ts` | `requirePageAccess('/admin/hr')` |
| `src/app/api/payroll/daily/targets/generate/route.ts` | `requirePageAccess('/admin/hr')` |
| `src/app/api/payroll/daily/route.ts` | `requirePageAccess('/admin/hr')` |
| `src/app/api/payroll/daily/generate/route.ts` | `requirePageAccess('/admin/hr')` |
| `src/app/api/payroll/daily/auto-generate/route.ts` | `requireSystemJobAuth` |
| `src/app/api/admin/hr/nightly-close/route.ts` | `requireSystemJobAuth` (admin or bearer; not any session) |
| `src/app/api/health/db/route.ts` | `requireAdmin` |

### Admin store (page ACL `/admin/cut-club`)

`store/clear`, `store/items`, `store/items/[id]`, `store/items/[id]/stock`, `store/categories`, `store/categories/[id]`, `store/mystery-boxes`, `store/mystery-boxes/[id]`, `store/inventory`, `store/stats`

### Development-only utilities (`requireDevelopmentAdmin`)

Migration/seed/fix/test/debug/cleanup routes including: `employees/migration`, `migrate-arabic-services`, `migrate-barber-schedule`, `migrate-queue-estimate-cols`, `seed-all-services`, `seed-barber-services`, `fix-arabic-*`, `test-seed`, `cleanup-queue`, `booking-debug/*`, `check-categories`, `check-services`, `test-display`, `test-unicode`, `bookings-migrate`, `booking-indexes-migrate`, `booking-settings-migrate`, `booking-debug/day`, `debug/overnight-availability`, `whatsapp/test-send`, `whatsapp/status`, `debug/booking-schedule-check`

### Other admin

| Route | Guard |
|-------|-------|
| `permissions/migrate`, `permissions/seed` | `requireAdmin` |
| `employees/[id]/work-hours` | `requireAdmin` |
| `customers/follow-up` | `requireAdmin` |

---

## 3. Proxy changes

* Extracted pure matcher: `src/lib/proxyPublicRoutes.ts`
* Anonymous public: `/login`, `/api/auth/login`, `/api/public/`
* Cron bearer (no cookie): nightly-close, auto-generate, `/api/cron/`
* **No** `/api/admin/` prefix bypass
* Production cron bearer rejects when `CRON_SECRET` unset

---

## 4. Route-level guard changes

Extended `src/lib/api-auth.ts`:

* `requireSession` (alias of `authenticate`)
* `requireAdmin`
* `requireDevelopmentAdmin`
* `requireSystemJobAuth`
* `logSecurityEvent`

Existing `requireRole` / `requirePageAccess` reused — no second permission system.

---

## 5. Public routes intentionally retained

* `/login`
* `/api/auth/login`
* `/api/public/**` (booking + public client surfaces)

---

## 6. Development-only routes

All migrate/seed/debug/test WhatsApp diagnostics and `db/toggle` return **404** when `NODE_ENV === 'production'`.

---

## 7. Scheduled-job authentication

Documented in `docs/internal-job-authentication.md`.

* Bearer `CRON_SECRET` or admin session
* Auto-generate no longer open when secret missing

---

## 8. Tests added

* `src/lib/__tests__/phase1aSecurityBaseline.test.ts`
* Updated: `employeeDailyTargetRoutes.test.ts`, `employeeLedgerDualWrite.test.ts` (auto-generate auth mock)

---

## 9. Regression checks run

| Check | Command | Result |
|-------|---------|--------|
| Phase 1A security + targets + dual-write + sensitive audit | `npx vitest run src/lib/__tests__/phase1aSecurityBaseline.test.ts …` | **Passed** (46 tests) |
| Booking / queue / nightly / treasury / invoice / targets subset | `npx vitest run` (listed suites) | **Passed** (exit 0) |
| ESLint on core auth/proxy files | `npx eslint src/proxy.ts src/lib/proxyPublicRoutes.ts …` | **Passed** (no issues on those files) |
| `tsc --noEmit` | full project | **Not clean** — pre-existing errors in unrelated attendance test files; no Phase 1A-specific errors identified in changed auth modules |
| Production build | `npm run build` | **Not run** |
| Manual login/POS/public booking browser | — | **Not run** (no live server verification in this session) |

Pre-existing failures observed (not introduced by Phase 1A auth guards): `salesInvoiceDelete` / `expenseIncomeActions.integration` `server-only` package resolution in vitest.

---

## 10. Remaining risks

1. **High:** Many non-admin internal APIs still rely primarily on proxy session presence + partial `getSession` without role checks (pre-existing).
2. **High:** `getSession` null-check patterns vary; some reads may still be under-authorized relative to page ACL.
3. **Medium:** Weak `ADMIN_SECRET_KEY` defaults removed from active gates; dead `isAuthorized` helpers may remain in migrate files.
4. **Medium:** `health/db` now admin-only; ops monitors must use authenticated calls.
5. **Medium:** Sensitive-action registry does not include `db_toggle` DB audit row (console `SECURITY_EVENT` only).
6. **Low:** No branch context yet — expected until Phase 1B.

---

## 11. Routes that could not safely be changed

* Financial delete/reversal **business logic** — left intact; only auth posture confirmed for existing audited paths.
* Public booking response shapes — unchanged.
* Sync-service protocol — deferred.
* Approvals approve/reject — remain 410 stubs.

---

## 12. Recommendation for Phase 1B

**Ready to begin Phase 1B foundation** (design/implement):

* `TblBranch` + founding seed `GLEEM`
* `TblUserBranchAccess`
* `TblEmpBranchAssignment`
* Session active-branch claim validated server-side

**Only after** confirming regression tests in this closure pass and `CRON_SECRET` is set in every scheduled environment.

Do **not** add operational `BranchID` columns until Phase 1B/1C ownership migration plans are approved.
