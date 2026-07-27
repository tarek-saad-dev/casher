# Booking Phase 6 — Idempotency

Table: `TblPublicBookingCreateRequest` (ensured at runtime + migration SQL).

Key = `clientRequestId` or `Idempotency-Key`.
Fingerprint = sha256(contract, branch, WorkDate, time, dayOffset, services, mode, empId, phone).

Same key+fp → replay. Same key different fp → `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`. PENDING → `IDEMPOTENCY_REQUEST_IN_PROGRESS`. Legacy absent key allowed (documented gap until frontend ships keys).
