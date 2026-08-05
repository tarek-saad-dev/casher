# Legacy UI Transition — Schedule Control vs Workforce Availability

**Phase:** 3B.1  
**Related:** Phase 3A daily adjustments, Phase 3B workforce UI

---

## Policy

| Principle | Detail |
|-----------|--------|
| Dual-read | Legacy overrides + canonical daily adjustments both affect the resolver (adjustments last) |
| New writes | Workforce page writes **only** to `TblEmpDailyAdjustment` |
| Legacy writes | Schedule-control / booking-control may still write overrides for kept actions |
| No silent redirect | Mutation APIs are not rewritten; UI steers operators |

---

## Action inventory

| Legacy action | UI surface | Decision | Notes |
|---------------|------------|----------|-------|
| `day_off` | ScheduleControlModal, BookingControlDrawer | **Disable** create in ScheduleControlModal; **Deprecate** in BookingControlDrawer | Use workforce `CLOSE_DAY` |
| `custom_hours` | ScheduleControlModal, BookingControlDrawer | **Disable** create in ScheduleControlModal; **Deprecate** elsewhere | Use `REPLACE_WINDOWS` |
| `block_range` | ScheduleControlModal, BookingControlDrawer | **Disable** create in ScheduleControlModal; **Deprecate** elsewhere | Use `BLOCK_WINDOW` |
| `late_start` | ScheduleControlModal | **Keep** | Attendance-adjacent shift trim; no exact daily-adjustment twin yet |
| `early_leave` | ScheduleControlModal | **Keep** | Same as late_start |
| Restore Present / check-in | ScheduleControlModal | **Keep** | Attendance reality |
| Temporary transfer | ScheduleControlModal / transfer modal | **Keep** | Branch transfer, not daily adjustment |
| Remove legacy override | ScheduleControlModal | **Keep** | Soft-deactivate existing override rows |
| Attendance Present/Absent/Check-in/out | HR / POS | **Keep** | Never blocked by workforce UI |

---

## Migrate later (not 3B.1)

- Backfill `day_off` → `CLOSE_DAY`, `custom_hours` → `REPLACE_WINDOWS`, `block_range` → `BLOCK_WINDOW`
- Retire legacy override write APIs after parity period
- Map late_start / early_leave into REPLACE policy explicitly

---

## Operator messaging

Both legacy UIs show:

> لإدارة تعديلات التوافر اليومية، استخدم صفحة توافر الموظفين.

Link: `/admin/workforce/availability`

ScheduleControlModal disables duplicate action chips with tooltip directing to the workforce page.
