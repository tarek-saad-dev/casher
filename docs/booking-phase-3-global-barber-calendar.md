# Booking Phase 3 — Global barber calendar

`GET /api/public/booking/barbers/{empId}/calendar?from=&to=`

Statuses: `presence_only`, `day_off`, `global_leave`, `branch_closed`, `not_assigned`, `not_available_publicly`, `service_not_available`, `outside_booking_horizon`.

**Not emitted:** `available`, `fully_booked` (Phase 4).

Overnight: `endDayOffset: 1` on opening WorkDate.

Non-public only workday → `not_available_publicly` (no Camp Caesar leak).

Engine: existing `resolveEmployeeGlobalSchedule` (no second calendar engine).
