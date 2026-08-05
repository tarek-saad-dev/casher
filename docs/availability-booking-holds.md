# Booking holds

## Policy

- TTL: **5 minutes** (`BOOKING_HOLD_TTL_MS`).
- Created at final customer confirmation step (`POST /api/public/booking/hold`).
- Holds exact branch, employee, start/end.
- Blocks other customers and Operations via busy intervals (`getEmployeeBusyIntervals`).
- Expiry by `ExpiresAt` (no cron required for correctness).
- Successful create consumes hold (`holdKey` on `createPublicBooking`).
- Failed/cancel flows: `DELETE /api/public/booking/hold?holdKey=`.
- Conflict reason: `HOLD_CONFLICT`.

## Table

`dbo.TblBookingHold`
