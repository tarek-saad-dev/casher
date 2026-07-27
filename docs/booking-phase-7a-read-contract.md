# Booking Phase 7A — Read Contract

Canonical module: `src/lib/booking/publicBookingReader.ts`

| Endpoint | Service |
|---|---|
| `GET /api/public/booking/[code]` | `getPublicBookingByCode` |
| `POST /api/public/booking/upcoming` | `listPublicUpcomingBookings` |

Ownership for full details: **code + phone** or **code + bookingAccessToken**.  
Code-only: temporary **minimal** summary (no notes, no customer PII).

Dates prefer `PublicWorkDate` / `PublicDayOffset` / `AbsoluteStartUtc` / `AbsoluteEndUtc`.  
Status via `publicBookingStatus.ts`. No BookingID / CustomerID / BranchID / Notes metadata in public JSON.
