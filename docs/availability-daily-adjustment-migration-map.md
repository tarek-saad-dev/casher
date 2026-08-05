# Daily Adjustment — Legacy Migration Map

**Phase:** 3A  
**Status:** Read-compatibility only (no automatic backfill)

This document maps legacy daily schedule sources to the canonical daily adjustment model (`TblEmpDailyAdjustment` / `TblEmpDailyAdjustmentWindow`).

---

## Compatibility policy

| Layer | Behavior in Phase 3A |
|-------|----------------------|
| Weekly base | Unchanged (`TEMPORARY_TRANSFER` → `BRANCH_WEEKLY` → `LEGACY_WEEKLY` → `FREELANCE_UNLOCK`) |
| Legacy overrides / day-off / attendance | Still loaded and applied **first** |
| Canonical daily adjustments | Applied **last** (authoritative for deliberate changes) |
| New admin API writes | **Only** to new tables |
| Automatic data backfill | **Not** performed |

---

## Source map

| Legacy source | New equivalent | Migration in this phase |
|---------------|----------------|-------------------------|
| `day_off` override | `CLOSE_DAY` | Read compatibility only |
| `custom_hours` override | `REPLACE_WINDOWS` | Read compatibility only |
| `block_range` override | `BLOCK_WINDOW` | Read compatibility only |
| `late_start` override | `REPLACE_WINDOWS` or specific policy | Compatibility retained via `applyOverrides` |
| `early_leave` override | `REPLACE_WINDOWS` or specific policy | Compatibility retained via `applyOverrides` |
| `TblEmpDayOff` | `CLOSE_DAY` | Not migrated yet (still read as day-off base) |
| Attendance `Present` / `Late` / `EarlyLeave` | No direct equivalent | Reality only — does not open bookable hours alone |
| Attendance `Absent` | Availability deny (`EMPLOYEE_ABSENT`) | Retained; **cannot** be reopened by ordinary adjustments |
| `getDefaultSchedule` / `getBarberWorkingWindow` | N/A (weekly helpers) | Deprecated; still present |

---

## Interaction examples

| Scenario | Result |
|----------|--------|
| Legacy `day_off` + new `ADD_WINDOW` / `REPLACE_WINDOWS` | Explicit new adjustment can reopen the day |
| Legacy `custom_hours` + new `REPLACE_WINDOWS` | New windows win |
| Legacy `block_range` + new `ADD_WINDOW` | Both remain (legacy block in base blocked set; add merges windows) unless later replaced |
| Legacy `block_range` + new `BLOCK_WINDOW` | Both blocks accumulate |
| Absent + any adjustment | Still denied (`EMPLOYEE_ABSENT`) |

---

## Tables preserved (do not delete)

- `TblEmpScheduleOverrides`
- `TblEmpDayOff`
- Attendance tables / records
- Weekly schedule tables used by `loadWorkingWindowsBatch`

---

## Future migration (not Phase 3A)

A safe, idempotent backfill may later insert:

- `day_off` → `CLOSE_DAY`
- `custom_hours` → `REPLACE_WINDOWS` (+ window rows)
- `block_range` → `BLOCK_WINDOW` (+ window rows)

Only after parity tests prove round-trip equivalence and dual-read can be retired.
