# Availability Architecture — Phase 3C Verification & Acceptance

**Date:** 2026-08-03  
**Scope:** Verify completed Phase 3C true multi-window runtime in the real repository and configured database. No Phase 4 work. No product redesign.

Companion artifacts:

- [`availability-phase-3C-smoke-results.md`](./availability-phase-3C-smoke-results.md)
- [`availability-phase-3C-acceptance-unblock.md`](./availability-phase-3C-acceptance-unblock.md)
- [`availability-phase-3C-browser-verification.md`](./availability-phase-3C-browser-verification.md)
- [`availability-phase-3C-implementation.md`](./availability-phase-3C-implementation.md)
- [`availability-phase-3C-runtime-audit.md`](./availability-phase-3C-runtime-audit.md)
- [`availability-performance-report.md`](./availability-performance-report.md)

Verification kinds:

```text
Automated test verified
API smoke verified
Database verified
Browser/UI verified
Not verified
```

---

## 1. Executive summary

Phase 3C multi-window runtime is proven by automated regression, core service-layer smoke, **acceptance booking create/reschedule** on temporarily activated `CAMP_CAESAR` (public exposure kept off), live branch isolation, database readiness, permissions seed/verify, production build, and a real browser walkthrough of `/admin/workforce/availability`.

Temporary CAMP_CAESAR gate changes and all tagged smoke adjustments/bookings were restored/cleaned; GLEEM `QBS.BookingEnabled` remained `false`.

**Final decision:** Phase 3C is **verified and accepted** for production cutover planning (not Phase 4 implementation).

---

## 2. Environment tested

| Item | Value (no secrets) |
|------|---------------------|
| Host OS | Windows 10 |
| App | `pos-system` (Next.js 16) |
| DB target | Cloud SQL Server (`[db:cloud]`), database name `last132` |
| Config sources | `.env` + `.env.local` (keys present; values redacted) |
| Normally active branch | `GLEEM` (BranchID=1, `PUBLIC_LIVE`, QBS booking **off**) |
| Acceptance test branch | `CAMP_CAESAR` (BranchID=3) — temporary `INTERNAL_LIVE` + QBS on; restored to `SETUP` / inactive |
| Cairo business date at run | `2026-08-03` |
| Smoke employee / date | EmpID `12` (زياد), business date `2026-08-17` |
| Smoke service | ProID `9`, 30 minutes |

---

## 3. Database readiness

**Kind:** Database verified

| Check | Result |
|-------|--------|
| Connectivity | Connected |
| `TblEmpDailyAdjustment` / `TblEmpDailyAdjustmentWindow` | Present; ensure idempotent |
| Ensure command | `ensureDailyAdjustmentTables()` |
| Post-acceptance active smoke rows | **0** |

---

## 4. Commands executed (Phase 3C.1 re-run)

| Command | Result |
|---------|--------|
| `npm install` | Exit 0 |
| `npm run seed:permissions` | Exit 0 — `grantsAdded=0` |
| `npm run verify:availability-permissions` | Exit 0 — `ok: true` |
| `npm run build` | Exit 0 |
| `npx vitest run` (18 availability/booking/queue suites) | Exit 0 — **18 files, 263 tests** |
| `AVAILABILITY_BENCH=1 npx vitest run …/availabilityBenchmarks.test.ts` | Exit 0 — **5 tests** |
| `AVAILABILITY_ACCEPTANCE_SMOKE=1 npm run verify:availability-phase3c:acceptance` | Exit 0 — **16 PASS / 0 FAIL** |
| `npm run verify:availability-phase3c` | Exit 0 — core PASS; scenario 8 SKIP (normally one active branch) |
| `npx tsc --noEmit` | Exit ≠0 overall; **0** production (non-test) errors; Phase 3C production paths clean |

---

## 5. Permissions result

**Kind:** Database verified (+ browser deny)

Page key `hr.workforce_availability` granted to:

- `super_admin`
- `admin`
- `manager`
- `receptionist`

Unauthorized partner user denied in browser (`/403`). Second seed did not add duplicate grants.

---

## 6. Automated test results

**Kind:** Automated test verified

| Suite set | Files | Tests |
|-----------|-------|-------|
| Availability 01→3C + booking/queue related | **18** | **263 passed** |
| Benchmarks (non-gating) | **1** | **5 passed** |

No Phase 3C production assertions were removed or weakened to pass.

---

## 7. Build and TypeScript results

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| Production availability / booking / queue / workforce sources under `tsc` | **Clean** |
| Unrelated test TS errors | Pre-existing fixtures (attendance mocks, etc.) — not Phase 3C production |

---

## 8. Runtime shortcut audit

**Kind:** Automated test verified + source audit

Critical modules still forbid primary-window eligibility shortcuts (`effectiveWindows[0]` / `selectPrimaryEffectiveWindow`). Contract test in `availabilityPhase3C.test.ts` remains in force. **No runtime-eligibility primary-window regression found.**

---

## 9. API smoke scenarios

**Kind:** API smoke verified

- Core harness: scenarios 1–7 + Cairo + cleanup **PASS**; scenario 8 **SKIP** (environment).
- Acceptance harness: second-window create, overlap/gap rejects, reschedule, overnight, isolation, cleanup, gate restore — **16 PASS**.

Details: [`availability-phase-3C-smoke-results.md`](./availability-phase-3C-smoke-results.md).

---

## 10. Booking and queue results

| Item | Kind | Status |
|------|------|--------|
| Second-window slot eligibility | API smoke verified | PASS |
| Gap / cross-window / write guard | API smoke verified | PASS |
| Queue rollover to later window | API smoke verified | PASS |
| Canonical `createPublicBooking` (second window) | API smoke verified | **PASS** (CAMP_CAESAR `internal_preview`) |
| Overlap / gap create rejection | API smoke verified | PASS |
| Reschedule across windows + block | API smoke verified | PASS |
| Booking cleanup | Database verified | PASS |
| Gate restore | Database verified | PASS |
| Legacy `POST /api/bookings` production callers | Automated test verified | Still zero |

---

## 11. Workforce UI verification

| Item | Kind | Status |
|------|------|--------|
| Page/component contracts | Automated test verified | PASS |
| Browser `/admin/workforce/availability` | Browser/UI verified | **PASS** |
| Mutation + السجل | Browser/UI verified | **PASS** |
| Unauthorized deny | Browser/UI verified | **PASS** |

Full checklist: [`availability-phase-3C-browser-verification.md`](./availability-phase-3C-browser-verification.md).

---

## 12. Cairo and overnight verification

| Item | Kind | Status |
|------|------|--------|
| 03:59 / 04:00 Cairo cutoff | Automated + harness | PASS |
| Overnight windows / reschedule | API smoke verified | PASS |
| Payroll 5 AM | Untouched | — |

---

## 13. Performance observations

Non-gating benches (`AVAILABILITY_BENCH=1`): build day plan, explain ×200, window helpers, Phase 3C multi-window helpers — all passed. No CI timing thresholds added.

---

## 14. Cleanup confirmation

- Acceptance + browser adjustments soft-cancelled
- Smoke bookings cancelled via supported cancel path
- CAMP_CAESAR restored to inactive `SETUP`, QBS off, public off
- GLEEM QBS booking remained off
- Cancelled adjustment history intentionally retained

---

## 15. Failures and fixes made (3C.1)

Harness / environment only:

1. Acceptance opt-in script + npm `verify:availability-phase3c:acceptance`
2. CAMP_CAESAR temporary internal activation with restore/`finally`
3. Browser modal confirm via DOM click (overlay intercepted pointer click)

No production eligibility logic weakened. Booking gate not bypassed.

---

## 16. Items not verifiable / residual

1. Dedicated browser logins for `manager` / `receptionist` (no such users in current table) — page grants verified.
2. `/operations` poll invalidation not separately exercised (workforce refresh without reload verified).
3. GLEEM remains non-bookable by design (`QBS.BookingEnabled=false`).

---

## 17. Final acceptance decision

| Criterion | Status |
|-----------|--------|
| DB tables exist | Met |
| Permissions seed + verify | Met |
| Production build | Met |
| Phase 3C + broader regressions | Met |
| No primary-window eligibility shortcuts | Met |
| Second-window booking create | **Met** |
| Overlap / gap rejection | **Met** |
| Real reschedule into another window | **Met** |
| Booking + adjustment cleanup | **Met** |
| Original booking-gate state restored | **Met** |
| Browser authorized + mutation + history | **Met** |
| Branch isolation | **Met** (live acceptance); core harness still SKIP when only GLEEM normally active |

```text
PHASE 3C VERIFIED AND ACCEPTED

CANONICAL SECOND-WINDOW BOOKING CREATE AND RESCHEDULE PASSED

BROWSER WORKFORCE UI WALKTHROUGH PASSED

TEMPORARY CONFIGURATION AND TEST DATA RESTORED

READY FOR PRODUCTION CUTOVER PLANNING
```
