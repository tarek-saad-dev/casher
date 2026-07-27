# Booking Phase 5 — Check-slot / plan parity

Both endpoints call `evaluatePublicBookingSelection` with the same request shape.

Verifier helper: `assertCheckSlotPlanParity` → throws `PLAN_CHECK_SLOT_MISMATCH` (internal).

Plan must not succeed when check-slot would report unavailable.
