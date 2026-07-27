# Booking Phase 4 — Available days

`GET /api/public/booking/available-days?branchCode=&serviceIds=&empId?&from?&to?`

- Branch via Phase 1 context (required)
- Duration via `resolveSelectedBookingServices` (Phase 2 catalog only)
- Specific vs any barber modes
- Statuses: available, fully_booked, barber_day_off, global_leave, not_available_publicly, barber_at_different_branch, outside_booking_horizon, no_eligible_barber, …
