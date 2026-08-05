# Availability Layers — Control Matrix (Phase 3B.2)

| Layer | Can view | Can edit / control | Permission / destination | Notes |
|-------|----------|--------------------|--------------------------|-------|
| Employee identity | Yes | Link to HR profile / assignment | `hr.employees` / HR page | No identity edit in drawer |
| Branch assignment | Yes (summary) | Link to branch assignment | Weekly schedule page | Assignment dates shown when loaded |
| Weekly schedule | Yes | `إدارة الجدول الأسبوعي` → branch-schedule page | Existing HR schedule permission | Recurring warning shown |
| Transfer | Yes | Existing transfer UI (deep link) | Existing transfer permission | Not via daily-adjustment APIs |
| Freelance unlock | Yes | Attendance / freelance planning link | Attendance permission | No second unlock writer |
| Legacy overrides | Yes | Cancel existing only (deep link); create disabled for day_off / custom_hours / block_range | Legacy schedule-control | Deprecation badge «نظام قديم» |
| Attendance | Yes | Present / Absent / check-in links | Attendance permission | Policy: attendance does not open booking alone |
| Daily adjustments | Yes | Close / Replace / Add / Block + soft-cancel | `hr.workforce_availability` | Existing modal + history APIs |
| Final result | Yes | Refresh, copy tech summary | Page view | **No mutations** |

## Disabled-control messaging

When a control is unavailable, the action remains visible with `enabled: false` and `disabledReasonAr` (Arabic).

## Ownership rule

Footer shortcuts only open actions owned by Layer 6 (daily adjustments). They do not bypass layer ownership.
