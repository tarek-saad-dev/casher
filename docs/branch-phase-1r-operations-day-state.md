# Phase 1R — Operations Day State

**API:** `GET /api/operations/employees/day-state?date=`  
**Consumer:** `GET /api/operations/schedule-control` → `ScheduleControlModal`

## Sections

| Section | Meaning |
|---|---|
| present | Resolved location = session branch (weekly schedule) |
| transferred_in | Temporary transfer destination = session branch |
| elsewhere | Working in another branch |
| off | Global leave / weekly OFF |

Location comes from `resolveEmployeeGlobalSchedule` / `resolveEmployeeBranchSchedule`, not attendance alone.
