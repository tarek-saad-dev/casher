# Booking Phase 7B — Transaction & Locking

Isolation: **SERIALIZABLE**

Locks (Transaction-owned applock):
1. `booking:cancel:{normalizedCode}`
2. `booking:emp:{empId}:{startMs}:{endMs}` (when Absolute interval present)

Order: cancel-code lock → reload → cutoff → emp-interval lock → recheck status → UPDATE → complete idempotency → commit.

Notifications / availability probe **after** commit only.
