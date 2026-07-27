# Booking Phase 7B — Cancellation Contract

**Canonical service:** `src/lib/booking/publicBookingCancellation.ts` → `cancelPublicBooking`

**Routes:**
- `POST /api/public/booking/[code]/cancel` (preferred)
- `POST /api/public/booking/cancel` (body `code`)

**Ownership:** code + normalized phone **OR** code + `bookingAccessToken`  
**Idempotency:** `clientRequestId` / `Idempotency-Key` required  
**Status written:** lowercase `cancelled`  
**Hard delete:** never

## Success shape

See phase prompt §16. Includes `cancellation`, `booking` (canCancel=false), `slotRelease`.

## Errors

See `publicBookingErrorCatalog.ts` Phase 7B codes.

## Migration matrix

| Surface | Status |
|---|---|
| lookup by code | migrated (7A) |
| upcoming | migrated (7A) |
| cancel | **migrated (7B)** |
| CORS finalization | pending Phase 7C |
| cutsaloon.com integration | pending |
