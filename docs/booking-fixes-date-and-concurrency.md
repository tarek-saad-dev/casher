# Booking Fixes — Date & Concurrency

**Date:** 2026-07-15  
**Based on:** Phases 1–3 audits  
**Scope:** Production code fixes only. No historical data cleanup.

---

## 1. Root causes fixed

| # | Root cause | Fix |
| - | ---------- | --- |
| 1 | `/plan` used booking-only `UPDLOCK` on same `BookingDate` and did not share `operations-schedule:{emp}:{date}` applock with `/create` / reschedule → overlapping create+plan and cross-midnight misses | `/plan` now calls `assertEmployeeIntervalAvailable` inside each segment `SERIALIZABLE` transaction |
| 2 | Website FE advanced `date` for `dayOffset=1` **and** sent `dayOffset=1`; `/plan` advanced again → overnight stored **+2 days** | `BookingModal` sends board `selectedDate` + `dayOffset` (Operations contract) |
| 3 | `flow-board` treated mssql `Date` `BookingDate` as “not a string” and substituted board `dateStr` → same booking under two days | Use `sqlDateToYyyyMmDd` for bookings and queue dates |
| 4 | Shared busy-interval loader rarely pulled next calendar day (broken overnight predicate) → residual cross-midnight TOCTOU | `getEmployeeBusyIntervals` loads next-day busy when shift ends past midnight **or** candidate `rangeEndMs` spills past midnight |

---

## 2. Files changed

| File | Change |
| ---- | ------ |
| `src/app/api/public/booking/plan/route.ts` | Shared write guard + 409 shape |
| `src/lib/scheduleIntegrity.ts` | Next-day busy loading for overnight / cross-midnight candidates |
| `src/app/api/operations/flow-board/route.ts` | `sqlDateToYyyyMmDd` for BookingDate / QueueDate |
| `../cut-salon-rtl-booking/src/components/BookingModal.tsx` | Payload date contract |
| `src/lib/__tests__/bookingDateContract.test.ts` | Date + flow-board unit regressions |
| `src/lib/__tests__/bookingPlanConcurrency.integration.test.ts` | Cloud concurrency (×10) |
| `docs/booking-fixes-date-and-concurrency.md` | This note |

---

## 3. Final date contract

```text
payload.date      = availability board / user-selected calendar day (YYYY-MM-DD)
payload.time      = slot clock time (HH:MM)
payload.dayOffset = 0 | 1 from the slot

Backend (/plan and /create) applies dayOffset exactly once:
  stored BookingDate = dayOffset===1 ? nextCalendarDay(date) : date
```

Examples:

```text
Board 2026-07-16, 17:00, dayOffset 0 → BookingDate 2026-07-16
Board 2026-07-15, 01:00, dayOffset 1 → BookingDate 2026-07-16 (never 2026-07-17)
```

Do **not** send a pre-advanced calendar date together with `dayOffset: 1`.

---

## 4. Final locking strategy

All mutators that own a barber interval:

```text
BEGIN TRAN SERIALIZABLE
  sp_getapplock Exclusive  resource = operations-schedule:{empId}:{operationalDate}
  re-read busy (bookings + queue + blocks/overrides; next calendar day when needed)
  assert no absolute-interval overlap
  INSERT / UPDATE
COMMIT  (releases applock)
```

| Path | Uses shared guard? |
| ---- | ------------------ |
| `POST /api/public/booking/create` | Yes (unchanged call site) |
| `POST /api/public/booking/plan` | **Yes (now)** per service segment |
| `PATCH …/reschedule` | Yes (unchanged) |

`/plan` still creates **one Booking row per service**; multi-segment commits remain sequential with cancelled cleanup on later-segment conflict.

---

## 5. Test results

### Date / flow-board units (`bookingDateContract.test.ts`)

| Case | Result |
| ---- | ------ |
| dayOffset 0 → stored same day | PASS |
| dayOffset 1 → stored +1, never +2 | PASS |
| Double-offset pairing documented as wrong | PASS |
| mssql `Date` BookingDate keeps stored day (not board) | PASS |

### Cloud concurrency (`bookingPlanConcurrency.integration.test.ts`, last132)

Fixtures tagged `AUDIT_FIX_CONC` on future date `2031-03-17`; deleted after run.

| Scenario | Attempts | Both succeed | One 201 + one 409 | Verdict |
| -------- | -------: | -----------: | ----------------: | ------- |
| create-path vs plan-path (same interval) | 10 | 0 | 10 | PASS |
| plan vs plan (same interval) | 10 | 0 | 10 | PASS |
| cross-midnight (23:30–00:20 vs next 00:00–00:30) | 10 | 0 | 10 | PASS |

### Verification commands

- `npx vitest run` on the two new test files — **9/9 passed**
- Focused typecheck: no new errors in changed booking/schedule files (repo `tsc` still reports pre-existing failures in unrelated attendance tests / leftover tmp scripts)
- ESLint on `scheduleIntegrity.ts` + new tests: clean; `plan` / `flow-board` still have pre-existing `any` lint issues unrelated to this change

`/create` and reschedule call sites unchanged aside from shared busy-interval enhancement (additive next-day load).

---

## 6. Remaining risks

* `/plan` multi-service still commits **per segment**; a concurrent request can still interleave between segments (second service may 409 and cancel prior). Full multi-service atomicity is out of scope.
* No Idempotency-Key yet — same-slot retry is blocked by overlap `409`, but ambiguous timeout UX remains.
* Historical overlaps / Pascal `Cancelled` / suspected wrong dates from Phase 4 are **not** cleaned here.
* Customer site fix is in `cut-salon-rtl-booking`; deploy that app with the POS API together.
* Busy reads still use the pool connection (not the TX); protection relies on shared applock — writers that bypass `assertEmployeeIntervalAvailable` remain unsafe.
