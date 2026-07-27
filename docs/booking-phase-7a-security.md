# Booking Phase 7A — Security

- Numeric BookingID rejected.
- Code alone → minimal summary only.
- Wrong phone / token → generic unauthorized.
- Token has no raw phone; code-bound.
- Smoke / internal_preview / smoke_seed hidden.
- Camp Caesar internal bookings not exposed via public origin policy.
- Rate limits on lookup + upcoming.
- No internal IDs, Notes metadata, idempotency, PlanFingerprint in responses.
