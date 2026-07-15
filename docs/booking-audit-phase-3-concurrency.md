# Booking Audit — Phase 3: Concurrency & Duplicate Creation

**Date:** 2026-07-15  
**Based on:** `docs/booking-audit-phase-1-architecture.md`, `docs/booking-audit-phase-2-date-verification.md`  
**Constraint:** Verification only. No production route/lock/transaction changes. Fixture rows tagged and deleted after runs.

**DB:** local `last132` (`DESKTOP-EUN2CV2`). Schema notes: no `Bookings.BookingCode`; no queue `EstimatedStartTime` (queue busy reads fail open → empty). Write-guard / applock / UPDLOCK behavior under test is the same as production create/plan/reschedule cores.

---

## 1. Transaction and locking comparison

| Endpoint | Isolation level | Locking method | Conflict query connection | Insert/update connection | Shared lock namespace |
| -------- | --------------- | -------------- | ------------------------- | ------------------------ | --------------------- |
| `POST /api/public/booking/create` | `SERIALIZABLE` | `sp_getapplock` Exclusive via `acquireEmployeeScheduleLock` → resource `operations-schedule:{empId}:{operationalDate}` | Busy intervals via **pool** (`getEmployeeBusyIntervals` → `getPool()`), after applock on **transaction** | Same **transaction** | Yes — `operations-schedule:*` |
| `POST /api/public/booking/plan` | `SERIALIZABLE` **per service segment** | `UPDLOCK, HOLDLOCK` on `Bookings` overlap SELECT only | Same **transaction** | Same **transaction** | **No** — does not call applock |
| `PATCH …/reschedule` | `SERIALIZABLE` | `acquireScheduleLocksSorted` + `assertEmployeeIntervalAvailable` (same applock as create) | Busy intervals via **pool** after locks on **transaction** | Same **transaction** | Yes — `operations-schedule:*` |

Evidence:

| Concern | Finding | Lines |
| ------- | ------- | ----- |
| create TX + assert | `begin(SERIALIZABLE)` then `assertEmployeeIntervalAvailable(…, transaction)` then INSERT | `create/route.ts` L256–266, L309–347 |
| plan TX + SQL overlap | Per-segment TX; `SELECT … WITH (UPDLOCK, HOLDLOCK)` on same `BookingDate` only; no queue/blocks/applock | `plan/route.ts` L582–607, L665–704 |
| reschedule TX | `acquireScheduleLocksSorted` then `assertEmployeeIntervalAvailable` then UPDATE | `bookingRescheduleCore.ts` L555–594, L620–649 |
| applock resource | `operations-schedule:${empId}:${operationalDate}` | `scheduleIntegrity.ts` L211–236 |
| busy read vs TX | `getEmployeeBusyIntervals` always uses `getPool()`, not the TX connection | `scheduleIntegrity.ts` L115–128, L294–301 |
| create vs plan shared lock? | **No** — plan never acquires applock | contrast create L260–266 vs plan L591–607 |
| queue/blocks in write guard | create/reschedule: yes (via busy intervals + blocks). plan write: **Bookings only** | plan L597–607 |
| cross-date intervals | create/reschedule: next calendar day loaded when overnight shift. plan: **`BookingDate = @bDate` only** | `scheduleIntegrity.ts` L139–158; plan L600–601 |

Answers:

* Conflict check and write use the **same SQL transaction** for inserts/updates on all three paths; create/reschedule busy **reads** still go through the pool.
* Not all writers share one application lock — **`/plan` is outside** the applock namespace.
* `/plan` does **not** participate in create/reschedule locking.
* Queue / blocks / overrides are **not** in `/plan`’s write guard.
* Cross-date overlaps are **not** checked by `/plan`’s conflict SQL.

---

## 2. Concurrency test setup

* Temporary scripts exercised the **write cores** (same isolation, applock/UPDLOCK, insert/update SQL) with synchronized barriers before conflict checks and a ~40ms widen between check and write.
* Fixture: EmpID `5`, date `2030-06-17`, time `15:00`, duration `50m`, client fixture notes `AUDIT_P3_CONCURRENCY` / `AUDIT_P3_D` — deleted after runs.
* Each scenario A–F: **10** attempts (F2: 5). D full `rescheduleBookingMove` blocked on local by missing `BookingCode`; **D2** mirrored reschedule locks+assert+UPDATE without that column (same lock namespace as production).
* Temporary scripts removed after report (not retained as CI tests).

---

## 3. Test results

| Test | Attempts | Both succeeded | One rejected | Unexpected errors | Verdict |
| ---- | -------: | -------------: | -----------: | ----------------: | ------- |
| A `/create` vs `/create` | 10 | 0 | 10 | 0 | **PASS** |
| B `/plan` vs `/plan` | 10 | 0 | 10 | 0 | **PASS** |
| C `/create` vs `/plan` | 10 | **10** | 0 | 0 | **FAIL — double commit** |
| D create vs reschedule (full API core) | 10 | 0 | 0 | 10 | Inconclusive locally (`BookingCode` missing) |
| D2 create vs reschedule (lock mirror) | 10 | 0 | 10 | 0 | **PASS** — one owner of interval |
| E overlapping starts (15:00 vs 15:30) | 10 | 0 | 10 | 0 | **PASS** |
| F cross-midnight `/plan` (D 23:30–00:20 vs D+1 00:00–00:30) | 10 | **10** | 0 | 0 | **FAIL — both committed** |
| F2 create after plan overnight (day shift emp) | 5 | 0 | 5 | 0 | Create blocked by **shift hours**, not overlap proof |

Representative C evidence: both returned HTTP-equivalent **201**, two confirmed fixture rows for the same emp/date/start.

---

## 4. `/plan` multi-service atomicity

| Question | Result |
| -------- | ------ |
| Rows per service | **1** `Bookings` + **1** `BookingServices` per segment (when ProID available; local run had `proId=null` so services optional) |
| Segment commits | **Independent** — one TRAN commit per segment (`plan/route.ts` L582–704) |
| Seg1 commit + seg2 conflict | Reproduced: seg1 **201**, seg2 **409**; cleanup `UPDATE Status='cancelled'` on prior IDs |
| Cleanup reliability | Prior segment left as **`cancelled`** (visible row), not deleted |
| Concurrent entry between segments | Same first-segment race: **one 201 / one 409** (same as B) — second request can run after seg1 commit |
| Cancelled vs conflict readers | Cancelled **not** selected by plan conflict (`Status IN ('confirmed',…)`); reuse of same slot after cancel → **201** |

Partial failure leaves cancelled bookings; they do not block later conflict checks.

---

## 5. Idempotency results

| Check | Result |
| ----- | ------ |
| `Idempotency-Key` | **Not supported** (no route handling) |
| `clientRequestId` / attempt token | **Not supported** |
| Duplicate payload detection | **None** |
| Sequential same slot after success | First **201**, second **409** (overlap) — **no second booking ID** |
| Concurrent same payload (`/create`) | **201 + 409** |
| Retry after “ambiguous timeout” (same slot) | Second **409** — overlap masks lack of idempotency for **duplicate rows** |

**Classification:** lack of idempotency keys is a **Confirmed idempotency vulnerability** (client can receive failure/409 after a successful commit and has no safe replay). Creating **extra** rows on identical same-slot retry was **Not reproduced** when the overlap guard runs.

---

## 6. Confirmed root causes and vulnerabilities

| # | Classification | Finding |
| - | -------------- | ------- |
| 1 | **Confirmed concurrency vulnerability** | `/create` and `/plan` can both commit overlapping bookings for the same barber/interval (10/10). Separate lock namespaces (applock vs UPDLOCK-only). |
| 2 | **Confirmed concurrency vulnerability** | `/plan` cross-midnight / cross-`BookingDate` overlaps both commit (10/10). Conflict SQL filters `BookingDate = @bDate` only. |
| 3 | **Confirmed idempotency vulnerability** | Neither `/create` nor `/plan` accepts Idempotency-Key / clientRequestId / attempt token. |
| 4 | **Rejected hypothesis** | Two `/create` requests can both commit same slot — **Not reproduced** (0/10; applock serializes). |
| 5 | **Rejected hypothesis** | Two `/plan` requests can both commit same same-date overlap — **Not reproduced** (0/10; SERIALIZABLE + UPDLOCK). |
| 6 | **Rejected hypothesis** (same-date) | Overlapping different starts both commit on `/plan` — **Not reproduced** (0/10). |
| 7 | **Not reproduced** (duplicate rows) | Same-slot retry creates a second booking — blocked by overlap **409**. |
| 8 | create vs reschedule double-own | **Not reproduced** on D2 lock mirror (0/10 both-succeed). Full `rescheduleBookingMove` needs `BookingCode` column. Shared applock is the protective mechanism. |
| 9 | `/plan` misses queue/blocks at write | **Confirmed** by direct transactional proof (conflict SELECT is `Bookings` only). Queue columns missing locally → busy queue path not exercised end-to-end. |
| 10 | Cross-midnight protection on `/create` | **Not reproduced** on day-shift fixture (outside hours). Architecture loads next-day busy only for overnight shifts (`scheduleIntegrity.ts` L139–158). |

### Required decisions

1. Can `/create` and `/plan` both commit overlapping bookings? → **Yes.** Confirmed (C 10/10).
2. Can two `/plan` requests both commit (same date/overlap)? → **No** under tested conditions (B 0/10). Cross-date: **Yes** (F 10/10).
3. Can two `/create` requests both commit? → **No** (A 0/10).
4. Can create and reschedule both own the same interval? → **No** on shared-applock mirror (D2 0/10).
5. Does `/plan` miss queue or schedule-block conflicts at write time? → **Yes** (code/TX proof).
6. Can retrying the same request create duplicate bookings? → **Duplicate rows: Not reproduced** for same slot. **Idempotency keys: absent (confirmed vulnerability).**
7. Can cross-midnight overlaps bypass conflict detection? → **Yes on `/plan`.** `/create` not proven on overnight emp in this run.

---

## 7. Minimal recommendations for later fix phase

Do **not** implement here.

1. Route **`/plan` write path through `assertEmployeeIntervalAvailable`** (or shared applock + epoch busy intervals) so create/plan/reschedule share one lock namespace and queue/blocks/cross-midnight.
2. Prefer **one transaction for multi-service `/plan`** (or compensate with delete, not leave `cancelled` orphans that confuse ops).
3. Add **Idempotency-Key** (or booking attempt token) on `/create` and `/plan`; return prior success on replay.
4. Fix `/plan` conflict predicate to use **absolute intervals** (Cairo epoch), not string time on a single `BookingDate`.
5. Ensure create/reschedule busy reads optionally run on the **transaction connection** if isolation requires seeing concurrent writers that share locks.

---

## Artifacts

* Temporary runners executed then removed: `scripts/booking-audit-phase3-concurrency.ts`, `scripts/booking-audit-phase3-d2.ts`, `docs/_phase3-concurrency-raw.json`.
* **Production routes, locking, transactions, indexes, and non-fixture booking data were not changed.** Fixture bookings with audit markers were deleted at end of runs.
