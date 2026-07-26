# Phase 1Q — Overnight Behavior

**Date:** 2026-07-26  
**Resolver:** `employeeBranchScheduleResolver.ts` (`isOvernight`, day offsets)

---

## Detection

If `endTime` ≤ `startTime` (both present) → overnight shift.

| Field | Value |
|---|---|
| `startDayOffset` | 0 |
| `endDayOffset` | 1 |
| `startDateTime` | `WorkDate` + start |
| `endDateTime` | `WorkDate+1` + end |

Same rule for branch-table rows, GLEEM legacy fallback, and temporary transfer windows.

---

## Booking / branch hours

- Availability engine continues `dayOffset` 0|1 slot emission (Phase 1F).  
- Camp Caesar configured hours **11:00–01:30** (cutoff 04:00) remain in config from 1O; **not public** while SETUP.  
- Overnight does not create a second WorkDate schedule row; WorkDate is the opening business date.

---

## Attendance

WorkDate resolution stays branch business-day rules (1K). Overnight checkout may fall on the next calendar date while WorkDate stays the open day.
