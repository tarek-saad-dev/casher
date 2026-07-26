# Phase 1R — Employee Weekly Planner

**Route:** `/admin/hr/employees/{empId}/branch-schedule`  
**Entry:** HR employees → «الفروع ومواعيد العمل» / dropdown «إدارة العمل»

## Contract

- Reads via `resolveEmployeeGlobalSchedule` (same resolver as booking).
- Saves via `saveEmployeeGlobalWeeklySchedule` → `TblEmpBranchWorkSchedule` only.
- Never writes `TblEmpWorkSchedule`.
- One operational branch or OFF per weekday.
- Preview blocks `SCHEDULE_AFFECTS_EXISTING_BOOKINGS` without silent booking moves.

## Hours

- «استخدام ساعات الفرع» resolves `DefaultOpenTime` / `DefaultCloseTime` from `TblBranch`.
- Overnight shown when close ≤ open (e.g. Camp Caesar 11:00 → 01:30 +1).
