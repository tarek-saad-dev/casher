# Availability Architecture — Phase 3C.1 Acceptance Unblock

**Date:** 2026-08-03  
**Scope:** Complete remaining Phase 3C acceptance checks without starting Phase 4, without redesigning availability, and without weakening the booking gate or exposing public booking unintentionally.

Companion artifacts:

- [`availability-phase-3C-verification.md`](./availability-phase-3C-verification.md)
- [`availability-phase-3C-smoke-results.md`](./availability-phase-3C-smoke-results.md)
- [`availability-phase-3C-browser-verification.md`](./availability-phase-3C-browser-verification.md)
- Harness: `scripts/verify-availability-phase3c-acceptance.ts`
- Command: `AVAILABILITY_ACCEPTANCE_SMOKE=1 npm run verify:availability-phase3c:acceptance`

---

## 1. Booking-gate diagnosis

| Item | Detail |
|------|--------|
| Error | `BRANCH_BOOKING_DISABLED` |
| Primary throw site (create) | `createPublicBooking` in `src/lib/booking/publicBookingCreate.ts` when `!branchNow.bookingEnabled` (and for `public_booking` also when `!publicBookingEnabled`) |
| Related throws | `publicBookingAvailability.ts`, `publicBookingBarbers.ts`, `publicBookingSelectionEvaluator.ts` |
| Loader | `loadQueueBookingEnabled(branchId)` in `src/lib/booking/publicBookingBranchContext.ts` |
| Tables / fields | `dbo.QueueBookingSettings.BookingEnabled`; `dbo.TblBranch.PublicBookingEnabled`, `IsActive`, `LifecycleStatus` |
| Gate type | Queue-booking settings (`QBS.BookingEnabled`) plus branch public flag for customer purpose — not a feature-flag file |

### Applies to

| Surface | Gate behavior |
|---------|----------------|
| Public booking / discovery | Requires `bookingEnabled` **and** `publicBookingEnabled` |
| Internal admin / operations create (`purpose=internal_preview`) | Requires `bookingEnabled`; does **not** require `publicBookingEnabled` |
| Preview / smoke (`internal_preview` + auth) | Same as internal — still blocked when QBS `BookingEnabled=0` |
| Ops UI toggle (`setPublicBookingOpsEnabled`) | Updates GLEEM QBS only; does not flip `PublicBookingEnabled`; CAMP_CAESAR excluded from that ops path |

### GLEEM values at diagnosis / after restore

| Field | Value |
|-------|-------|
| `IsActive` | `true` |
| `LifecycleStatus` | `PUBLIC_LIVE` |
| `PublicBookingEnabled` | `true` |
| `QueueBookingSettings.BookingEnabled` | **`false`** |

Enabling GLEEM QBS while `PublicBookingEnabled=true` would expose public discovery — **not** used for acceptance.

Safest temporary enable path: activate an internal non-public branch and set **only** `QBS.BookingEnabled=1`, keeping `PublicBookingEnabled=0`.

---

## 2. Test-branch / toggle strategy

**Chosen: Preferred strategy 2 — CAMP_CAESAR internal test**

| Field | Original | Temporary (acceptance) | Restored |
|-------|----------|------------------------|----------|
| Branch | `CAMP_CAESAR` (id=3) | same | same |
| `IsActive` | `false` | `true` | `false` |
| `LifecycleStatus` | `SETUP` | `INTERNAL_LIVE` | `SETUP` |
| `PublicBookingEnabled` | `false` | `false` (unchanged) | `false` |
| `QBS.BookingEnabled` | `false` | `true` | `false` |

- GLEEM production booking behavior **untouched**.
- Public discovery guard asserted: CAMP_CAESAR **not** in `listPublicDiscoverableBranches()`.
- Employee `12` (زياد) already assigned with booking receive capability; multi-branch assignment preserved.
- `ALLOW_TEMP_BRANCH_BOOKING_TOGGLE=1` **not** used (GLEEM fallback unused).

Harness safety:

- Requires `AVAILABILITY_ACCEPTANCE_SMOKE=1` or exits without mutation.
- Prints selected branch + whether gate change will occur.
- Captures original settings; `try/finally` restore; verifies restore; fails if restore fails.
- Tags adjustments/bookings with `[P3C-ACC <runId>]`.

---

## 3. Real canonical booking results

Latest acceptance run (`runId=6f40a568`):

| Check | Result |
|-------|--------|
| Multi-window plan | PASS — 2 effective windows |
| Create in **second** window (`19:00`) | PASS — `id=2434` `code=BK-2S6L7K` `branch=3` `emp=12` |
| Occupancy | PASS — `busyIntervals=1` |
| Source / purpose | `purpose=internal_preview`, `bookingSource=admin` |
| Client trust | Server duration/price/branch/end used (canonical create path) |

---

## 4. Overlap / gap / cross-window

| Check | Result |
|-------|--------|
| Overlapping second create | PASS — rejected |
| Gap create (`16:00`) | PASS — rejected |
| Gap reschedule | PASS — `OUTSIDE_SHIFT` |
| Cross-window / outside-window eligibility | Covered by gap create + prior Phase 3C write-guard smoke; multi-window assert path |

---

## 5. Real reschedule results

| Check | Result |
|-------|--------|
| Second → first window | PASS |
| First → second window | PASS |
| Move into daily block | PASS — `SCHEDULE_CONFLICT` |
| `excludeBookingId` self | PASS — same-slot precheck valid |
| Overnight window move | PASS |
| Precheck / commit | Shared `validateBookingMove` / `rescheduleBookingMove` path |

---

## 6. Cleanup

| Check | Result |
|-------|--------|
| Booking cancel (supported admin cancel path) | PASS — e.g. `id=2435 status=cancelled` (overnight recreate cleaned) |
| Soft-cancel smoke adjustments | PASS — `activeCount=0` |
| Gate restore verified | PASS — CAMP_CAESAR `qbs=false pub=false`; GLEEM `BookingEnabled=false` |
| Retained history | Soft-cancelled `[P3C-ACC …]` adjustment rows only |

Post-run DB read confirmed **no active** P3C-ACC adjustments and gates restored.

---

## 7. Branch isolation

| Kind | Result |
|------|--------|
| Live smoke (CAMP_CAESAR vs GLEEM) | **PASS** — CC adjustment does not leak into GLEEM employee/date plan |
| Core harness scenario 8 | Still **SKIP** when only one *normally* active branch (GLEEM); acceptance temporarily activates CC then restores |

Automated branch-scoping regressions remain green.

---

## 8. Browser / permissions (summary)

See [`availability-phase-3C-browser-verification.md`](./availability-phase-3C-browser-verification.md).

- Authorized walkthrough + ADD_WINDOW + السجل cancel: **passed**
- Unauthorized partner role → `/403`: **passed**
- Role page grants seed: `super_admin`, `admin`, `manager`, `receptionist`
- Dedicated browser logins for manager/receptionist users: **not available** in this DB (documented)

---

## 9. Automated regressions / build (re-run)

| Command | Result |
|---------|--------|
| `npm install` | Exit 0 |
| `npm run seed:permissions` | Exit 0 — `grantsAdded=0` |
| `npm run verify:availability-permissions` | Exit 0 — `ok: true` |
| `npm run build` | Exit 0 |
| Vitest regression set (18 files) | Exit 0 — **263 passed** |
| `AVAILABILITY_BENCH=1` benchmarks | Exit 0 — **5 passed** |
| `AVAILABILITY_ACCEPTANCE_SMOKE=1 npm run verify:availability-phase3c:acceptance` | Exit 0 — **16 PASS / 0 FAIL** |
| `npm run verify:availability-phase3c` | Exit 0 — core scenarios PASS; scenario 8 SKIP (single normally-active branch) |
| `npx tsc --noEmit` | Exit ≠0 overall; **0 errors** outside `__tests__` / `*.test.ts`; production availability/booking/queue/workforce paths clean |

---

## 10. Items not verifiable / residual

1. Dedicated browser sessions for `manager` / `receptionist` user accounts (no such logins in current user table); page grants verified via seed/verify.
2. Live `/operations` poll invalidation after workforce mutation was **not separately** exercised; workforce board refreshed without full browser reload after ADD_WINDOW.
3. GLEEM remains intentionally non-bookable (`QBS.BookingEnabled=false`) — by design for production.

---

## 11. Final acceptance decision

```text
PHASE 3C VERIFIED AND ACCEPTED

CANONICAL SECOND-WINDOW BOOKING CREATE AND RESCHEDULE PASSED

BROWSER WORKFORCE UI WALKTHROUGH PASSED

TEMPORARY CONFIGURATION AND TEST DATA RESTORED

READY FOR PRODUCTION CUTOVER PLANNING
```

Do **not** start Phase 4 implementation in this workstream; cutover planning may begin separately.
