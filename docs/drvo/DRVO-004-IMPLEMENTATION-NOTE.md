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

## Not in scope (unchanged)

- Queue, POS sale path, Treasury trigger, messaging worker, entitlement enforcement, second tenant.
