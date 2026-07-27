# Booking Phase 6 — Post-commit

After commit only:

1. Invalidate Phase-4 availability (+ barber-related) caches.
2. Schedule WhatsApp if usable non-placeholder phone and not idempotent replay / suppressed.

Side-effect failure does not roll back booking. No durable outbox yet — documented reliability gap.
