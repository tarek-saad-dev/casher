# Availability Phase 3B.1 — Deployment Checklist

Do not include secrets in this document.

## Pre-deploy

1. **Phase 3A tables** — Confirm `TblEmpDailyAdjustment` + `TblEmpDailyAdjustmentWindow` exist (run migration / ensure once outside SERIALIZABLE booking TX).
2. **Permissions seed** — `npm run seed:permissions` (idempotent; does not revoke custom grants).
3. **Permission verify** — `npm run verify:availability-permissions` (must exit 0).
4. **Build** — `npm run build` (or CI equivalent).

## Deploy

5. Deploy application build.
6. Smoke: open `/admin/workforce/availability` as `super_admin`, `admin`, `manager`, `receptionist`.

## Functional verify

7. Create a test `CLOSE_DAY` or `ADD_WINDOW` for one employee on today’s operational date.
8. Confirm operations flow board refreshes (same date open, or next poll after `availability:changed`).
9. Soft-cancel the adjustment.
10. Open drawer → **السجل** → confirm cancelled badge + auditor fields.
11. Switch branch (if multi-branch) — confirm adjustments do not leak across branches.
12. Create overnight window (`endDayOffset: 1`) and confirm chips/timeline.
13. Operational date: before 04:00 Cairo, “اليوم” is previous calendar day; at/after 04:00, current calendar day. Payroll 5 AM untouched.

## Rollback

14. **Feature disable** — Remove nav entry / revoke `hr.workforce_availability` page grants (do **not** drop tables). Legacy schedule-control remains for late_start/early_leave; re-enable disabled chips only if urgently needed.
15. **Code rollback** — Redeploy previous release; tables and historical rows remain safe.
16. **Do not** hard-delete adjustment rows during rollback.

## Sign-off

| Check | OK |
|-------|----|
| seed + verify | |
| role page access | |
| create + cancel | |
| history | |
| ops refresh | |
| overnight + Cairo cutoff | |
