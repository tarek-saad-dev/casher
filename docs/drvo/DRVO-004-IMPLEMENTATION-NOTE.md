# DRVO-004 — Booking Scheduling Extraction (implementation note)

| Field | Value |
|-------|-------|
| Issue | https://github.com/tarek-saad-dev/casher/issues/11 |
| Staging database | `last132_agent` only |
| Rollback flag | `BOOKING_SCHEDULING_PORT=false` routes to legacy `src/lib/booking` paths |

## Delivered

- Scheduling use cases under `src/apps/booking`: hold, create, cancel, reschedule, convert.
- Shared-domain ports wired through `src/lib/bookingSchedulingComposition.ts`.
- POS conversion adapter at `src/apps/pos/internal/legacyBookingConversionAdapter.ts` (composition root only).
- Extracted events publish to `PlatformOutbox`; legacy WhatsApp notify skipped when port path is active.
- Import-boundary tests ban cross-app POS imports and forbidden table references inside booking package.
- Workforce occupancy `assertFree` calls `assertEmployeeIntervalAvailable` with `startAt`/`endAt`, the requested business date, branch, hold exclusion, and `booking:{id}` exclusion. Conflict reads stay employee-global, so another location on the same employee fails closed.
- Scheduling applocks are taken only inside the Workforce adapter. Each employee interval takes both `booking:emp:{empId}:{start}:{end}` and the tenant lock `t:{tenantId}:emp:…`, so the flag-off path and the port path serialize the same interval. `BOOKING_SCHEDULING_PORT=false` still uses the legacy lock helper directly.
- Port-path reschedule takes that interval lock before `operations-schedule:{emp}:{date}`, the same order as public create. Flag-off reschedule still takes only the schedule lock.
- `POST /api/public/booking/[code]/cancel` and operations affected-bookings reschedule use the extracted port when the flag is on (PlatformOutbox, no legacy customer WhatsApp).
- Conversion loads service lines from the real `BookingServices` columns (`ProID`, `EmpID`, `Price`, `Qty`). Reservation date comes from `Bookings.BookingDate`, formatted `YYYY-MM-DD`.

## Staging smoke (`last132_agent`, login `drvo_agent`)

Ran through the extracted application path on 2026-09-28:

- Created booking 4492 and cancelled it. Create replay returned the same booking. One `booking.created` and one `booking.cancelled` outbox row. No `TblBookingNotifyRequest` row.
- Created booking 4493 and converted it to خدمة invoice 3. Replay returned invoice 3 and did not insert a second head. Booking status is `completed` and `ConvertedInvID` is 3 / `خدمة`.
- A unit-of-work invoice insert that threw before commit left no خدمة invoice.
- Detail `ReservDate` is `2026-10-20`, the booking date.
- Conversion used an open GLEEM shift (12475) on business day 5573. Production `last132` was not contacted.

## Not in scope (unchanged)

- Queue, POS sale path, Treasury trigger, messaging worker, entitlement enforcement, second tenant.
