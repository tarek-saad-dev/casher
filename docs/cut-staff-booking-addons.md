# CUT STAFF — Booking add-on schedule guard (PR #239)

## Business rule
Existing appointments always take priority over new services. A staff member may add a service to their own assigned booking only if the **authoritative scheduling engine** can extend the booking without colliding with the next reservation, queue, hold, break, or shift boundary.

### Staff experience
1. Open **CUT STAFF → حجوزاتك** and the relevant booking.
2. Tap **إضافة خدمة**, search the catalog and select the extra service.
3. App requests a read-only availability preview (employee-specific duration, with duration overrides).
4. If **available**, confirm. The server takes a scheduling lock, re-reads current booking and service, and checks the new interval again inside a serializable transaction.
5. On success, the real booking end and booking service rows change together. The POS handoff subsequently includes this booked service.
6. If **not available**, the service remains **unadded**. Show nearest employee suggestions as *unreserved previews* and ask the customer to visit the cashier to confirm any reassignment.
7. POS handoff refuses extra quantities/services not present in the booked service rows.

### Non-goals / intentional limits
- Employee **cannot** silently allocate an alternate barber. A suggested employee is **not booked** and cashier must perform any reassignment with existing operations controls.
- This release does not create a second booking or per-service cross-employee reservation.
- Employee is not allowed to change prices or service durations; both are loaded server-side.
- If slot or system state changes after preview, confirmation rejects with HTTP 409. It must be rechecked.

## Core files
- `src/lib/employee-portal/bookingAddonAvailability.ts`
- `src/app/api/employee-portal/bookings/[id]/addon/route.ts`
- `src/app/employee-portal/bookings/booking-handoff-sheet.tsx`
- `src/lib/booking/cashierHandoff.ts`

## Acceptance / staging checks (required before merge)
- [ ] Existing booking with 30 free minutes allows +20m service and reserves exactly 20 minutes.
- [ ] A 20m service is **rejected** when next booked client starts after 15 minutes.
- [ ] Queue, hold, break, absent/day-off, and branch assignment each block an unsafe addition.
- [ ] A barber-specific duration override is used, not only `TblPro.DurationMinutes`.
- [ ] Two simultaneous requests with the same expected end: only one succeeds; other must refresh.
- [ ] Any failed confirm leaves `Bookings.EndTime`, `AbsoluteEndUtc`, and `BookingServices` unchanged.
- [ ] Current-employee and alternate barbers' day schedules respect branch and overnight shift boundaries.
- [ ] A suggestion is never presented as confirmed, with no side effects on another barber's bookings.
- [ ] Handoff payload cannot contain a service not in `BookingServices`.
- [ ] POS still loads and charges reserved service rows with correct barber and price.
- [ ] Existing manual POS checkout is unaffected.
- [ ] On success, public/ops availability recalculates the employee's changed occupancy.
- [ ] Validate UI behavior on Android CUT STAFF PWA.
- [ ] Verify source user permissions and tenant isolation.

## Release gate
Feature is branch-only until CI + an actual staging/isolated SQL Server workflow has verified booking/concurrency/overnight behaviour. Do not mark this as production-proven based on a green Next.js build alone.

## Future phase
Add a dedicated cashier assistance queue with a server-side confirmation action that books **only the extra service** against the alternate employee, preserving the original booking and correctly distributing POS commissions.
