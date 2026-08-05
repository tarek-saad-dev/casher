# Attendance policy (Booking / Workforce)

## Rules

- Attendance records reality; approved commands may update availability via canonical day plan / daily adjustments.
- Late check-in: record + warn; do **not** auto-cancel bookings; optional `LATE_START` / daily adjustment with preview.
- Auto-absence: after scheduled start + branch `AutoAbsenceMinutes` (default **30**), mark Absent, stop new booking/queue, mark future bookings `ACTION_REQUIRED` / `AT_RISK`. Never silent cancel.
- Decision uses `resolveEmployeeDayPlan` first planned start (multi-window / overnight / transfer-aware). Freelancers are never auto-absent merely for missing weekly schedule.
- Arrival after auto-absence: authorized restore attendance (`restore-present` / `work-on-day-off`); reopen via explicit window; history retained; affected-booking rows are **not** auto-cleared.
- Work on off-day: command `حضر يوم إجازته` (`workOnDayOff.service`) — attendance + bookable window.
- Early checkout / close remaining day: preview affected bookings before CLOSE/BLOCK.
- Freelancer: unavailable until attendance; requires configured default hours (`FREELANCER_HOURS_NOT_CONFIGURED` if missing).

## API / scheduler

- `POST /api/admin/attendance/auto-absence/run` — admin session **or** `Authorization: Bearer $CRON_SECRET` (`requireSystemJobAuth`).
- Vercel cron once daily (`0 7 * * *` UTC ≈ 10:00 Cairo): `vercel.json` → `/api/admin/attendance/auto-absence/run`.
  - Note: Hobby plan only allows **once-per-day** crons; sub-daily (`*/15`) blocks the whole deploy. Use Pro or an external scheduler for 15-minute scans.
- Concurrent full scans: transaction-scoped `sp_getapplock` (`auto_absence_scan`).

## Live verification

See `docs/availability-auto-absence-live-verification.md`.
