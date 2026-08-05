# Availability Phase 3C — Smoke Results

**Date:** 2026-08-03  
**Harnesses:**

- `npm run verify:availability-phase3c` → `scripts/verify-availability-phase3c.ts`
- `AVAILABILITY_ACCEPTANCE_SMOKE=1 npm run verify:availability-phase3c:acceptance` → `scripts/verify-availability-phase3c-acceptance.ts`

---

## A) Core multi-window smoke (`verify:availability-phase3c`)

**Exit code:** `0`

### Fixture

| Field | Value |
|-------|-------|
| Branch | `1` / `GLEEM` / جليم – سابا باشا |
| Employee | `12` / زياد |
| Business date | `2026-08-17` (today + 14 Cairo business days) |
| Service | `9` / duration **30** minutes |
| Normally active branches | **1** (GLEEM) |
| Timezone | `Africa/Cairo` |

Verification kinds:

```text
Automated test verified
API smoke verified
Database verified
Browser/UI verified
Not verified
```

### Scenario results

| # | Scenario | Result | Kind | Notes |
|---|----------|--------|------|-------|
| 1 | Base + ADD_WINDOW | **PASS** | API smoke verified | Both windows; gap rejected; evening write guard; timeline gap. Booking create moved to acceptance harness (CAMP_CAESAR). |
| 2 | Overnight REPLACE | **PASS** | API smoke verified | `endDayOffset=1`; overnight slots/timeline. |
| 3 | BLOCK in second window | **PASS** | API smoke verified | `BLOCKED_BY_DAILY_ADJUSTMENT`; write guard rejected blocked interval. |
| 4 | Continuous 120m | **PASS** | API smoke verified | `NO_CONTIGUOUS_WINDOW`. |
| 5 | Queue rollover 12:50 → 18:00 | **PASS** | API smoke verified | Earliest fit 18:00. |
| 6 | Absence precedence | **PASS** | API smoke verified | `EMPLOYEE_ABSENT`; attendance restored. |
| 7 | CLOSE then ADD / ADD then CLOSE | **PASS** | API smoke verified | Chronological precedence. |
| 8 | Branch isolation (core harness) | **SKIP** | Not verified here | Only one normally active branch — live isolation covered in acceptance (below). |
| — | Cairo cutoff | **PASS** | Automated + harness | `03:59 → 08-02`, `04:00 → 08-03`. |
| — | Cleanup | **PASS** | Database verified | No active smoke adjustments. |

---

## B) Acceptance smoke (`verify:availability-phase3c:acceptance`)

**Exit code:** `0`  
**Run ID:** `6f40a568`  
**Strategy:** `CAMP_CAESAR` (temporary internal activation; `PublicBookingEnabled` stayed `false`)  
**GLEEM toggle:** not used (`allowGleemToggle=false`)

### Summary

```json
{
  "pass": 16,
  "fail": 0,
  "skip": 0
}
```

| Check | Result | Detail |
|-------|--------|--------|
| public_exposure_guard | PASS | CAMP_CAESAR not in public branches list |
| multi_window_plan | PASS | windows=2 |
| create_second_window | PASS | id=2434 code=BK-2S6L7K branch=3 emp=12 |
| occupancy_after_create | PASS | busyIntervals=1 |
| overlap_rejected | PASS | — |
| gap_create_rejected | PASS | — |
| gap_reschedule_rejected | PASS | code=OUTSIDE_SHIFT |
| reschedule_to_first_window | PASS | — |
| reschedule_to_second_window | PASS | — |
| block_reschedule_rejected | PASS | code=SCHEDULE_CONFLICT |
| exclude_booking_id_self | PASS | same-slot precheck valid |
| overnight_reschedule | PASS | — |
| branch_isolation_live | PASS | CC adjustment does not leak to GLEEM |
| booking_cleanup | PASS | cancelled |
| adjustment_cleanup | PASS | no active smoke adjustments |
| gate_restored | PASS | CAMP_CAESAR qbs=false pub=false |

### Gate restore (DB read after run)

| Branch | IsActive | Lifecycle | PublicBooking | QBS Booking |
|--------|----------|-----------|---------------|-------------|
| GLEEM | true | PUBLIC_LIVE | true | **false** |
| CAMP_CAESAR | false | SETUP | false | **false** |
| PH1GTEST | false | SETUP | false | false |

---

## C) Browser

See [`availability-phase-3C-browser-verification.md`](./availability-phase-3C-browser-verification.md) — **Browser/UI verified**.

---

## Retained audit history

Cancelled daily adjustments with `[P3C-ACC …]` / `[P3C-ACC browser]` reason text remain as soft-cancelled history (by design). No tables dropped. No active smoke rows remain.
