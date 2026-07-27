# Booking Phase 6B — Cleanup

Verifier deletes by booking code + sweeps `Notes LIKE '%P6B%'`.  
Idempotency keys `P6B-%` deleted.  
Emergency cleanup: `scripts/branch-smoke/cleanup-p6b.ts`

Post-run expected: leftover marker bookings = 0.
