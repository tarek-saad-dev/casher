# Phase 1U — Booking backend audit (pre–Phase 1P)

**Environment:** cloud / last132  
**SmokeRunID:** **28** (`1U-full-week-pre-booking-audit`)  
**Disposable EmpID:** **1057** `[TEST] موظف كامب شيزار الأسبوعي` (deactivated after smoke)  
**Artifact:** `scripts/branch-smoke/_phase1u-full-week-audit-result.json`

Camp Caesar remains **INTERNAL_LIVE**, `PublicBookingEnabled=0`, QBS `BookingEnabled=0`.  
**PUBLIC_LIVE = NO-GO.** Do not start Phase 1P frontend until BLOCKER/HIGH items below are closed.

---

## Fixes applied in this phase

| Severity | Kind | Issue | Fix |
|----------|------|-------|-----|
| BLOCKER | public | `[TEST]`/`[SMOKE]` could appear in public barber lists | Exclude via escaped LIKE in `listGlobalPublicBarbers` + `listBookableEmployeeIdsForBranch({ publicOnly: true })` |
| BLOCKER | readiness | `[TEST]` counted as real weekly coverage (broken LIKE `[SMOKE`) | Escape `[[]SMOKE` / `[[]TEST` in `branchReadinessService` |
| HIGH | API | Non-public branch returned only `INVALID_BRANCH` | Also emit `code: BRANCH_NOT_PUBLIC` + CORS on `publicInvalidBranchResponse` |
| INFO | catalog | Shared error catalog for Phase 1P | `src/lib/booking/publicBookingErrorCatalog.ts` |

---

## Endpoint matrix (live + static)

| Endpoint | Method | branchCode | Camp Caesar public | GLEEM | Notes |
|----------|--------|------------|--------------------|-------|-------|
| `/api/public/branches` | GET | no | **hidden** | listed | OK |
| `resolvePublicBranchCode(CAMP_CAESAR)` | lib | yes | **404 BRANCH_NOT_PUBLIC / BRANCH_INACTIVE** | OK | OK |
| `/api/public/booking/barbers?mode=global` | GET | no | test emp **hidden** | OK | OK after fix |
| `/api/public/booking/*` with `branchCode=CAMP_CAESAR` | * | yes | reject | OK | expected while non-public |
| `listAvailableBookingSlots` admin CC | lib | BranchID=3 | n/a (internal) | n/a | **56** slots Sat; Fri **0** |

Full public route surface (OPTIONS+handlers): config, status, services, barbers, calendar, location, available-slots (emp + branch), available-days, check-slot, plan, create, upcoming, cancel, `[code]`, `[code]/cancel`.

CORS today: `Access-Control-Allow-Origin: *` via `PUBLIC_CORS_HEADERS` (wildcard — revisit before credentials).

Cache: **no** availability cache; settings cache keyed by branchId (45s TTL). **MEDIUM:** add EmpID/date/service versioned cache before public load.

---

## Findings still open

| Severity | Kind | Finding | Owner |
|----------|------|---------|-------|
| MEDIUM | transfer | CC→GLEEM blocked: overnight dest window + no GLEEM assignment/payroll for disposable emp | Backend/product — expected for CC-home-only test emp |
| MEDIUM | API | Error codes not yet uniformly mapped to catalog on every route (`SLOT_UNAVAILABLE`, etc.) | Backend before 1P |
| MEDIUM | cache | No slot cache keys / invalidation matrix | Backend |
| MEDIUM | CORS | Wildcard `*` — not origin-allowlist for cutsaloon.com | Backend |
| HIGH | concurrency | Dual create / applock not re-proven in Smoke 28 | Must run dedicated concurrency smoke before 1P GO |
| HIGH | plan/create | PLAN_CREATE_MISMATCH harness not executed live in Smoke 28 | Must run before 1P GO |
| INFO | business | Real weekly coverage still Fri-only (Ziad) | Business |
| INFO | lifecycle | Public booking / PUBLIC_LIVE intentionally off | Business |

---

## Coverage split

| Metric | Result |
|--------|--------|
| technicalWeeklyCoverage (test emp Sat–Thu) | **PASS** |
| realWeeklyEmployeeCoverage | **NO-GO** (Fri only after cleanup) |

---

## Verdicts (backend readiness for Phase 1P)

| Gate | Verdict |
|------|---------|
| Full-week disposable employee smoke | **GO** (SmokeRun 28) |
| Camp Caesar internal operations | **GO** |
| Booking API backend correctness | **NO-GO** (concurrency + plan/create + uniform errors pending) |
| Booking API concurrency | **NO-GO** (not proven this run) |
| Booking API CORS | **NO-GO** (wildcard only) |
| Booking cache isolation | **NO-GO** (no availability cache yet) |
| Booking performance | **NO-GO** (slots warm path slow; needs measurement harness) |
| Test cleanup | **GO** |
| Real weekly employee coverage | **NO-GO** |
| Camp Caesar PUBLIC_LIVE | **NO-GO** |
| Phase 1P frontend implementation | **NO-GO** |

---

## Next before Phase 1P

1. Dedicated concurrency + plan/create consistency smoke  
2. Wire public routes to `PUBLIC_BOOKING_ERROR_CATALOG`  
3. Origin-allowlist CORS for production hosts  
4. Availability cache keys + invalidation  
5. Business decision on uncovered weekdays (staff or closed days)
