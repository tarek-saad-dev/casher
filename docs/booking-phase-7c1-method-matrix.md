# Booking Phase 7C1 — Method Matrix

| Route family | Methods | Allow-Headers |
|---|---|---|
| branches, config, status, services, barbers, calendar, location, days/slots | GET, OPTIONS | Content-Type |
| check-slot, plan | POST, OPTIONS | Content-Type |
| create, cancel, cancel-by-code | POST, OPTIONS | Content-Type, Idempotency-Key |
| lookup `[code]` | GET, OPTIONS | Content-Type, Authorization |
| upcoming | POST, OPTIONS | Content-Type |

Source of truth: `PUBLIC_BOOKING_ROUTE_CORS` in `publicBookingCors.ts`.
