# Booking Phase 7B — Idempotency

**Table:** `dbo.TblPublicBookingCancelRequest`

Fingerprint: contract version + booking code + ownership digest + reasonCode + reasonText.

| Case | Behavior |
|---|---|
| Same key + same request | Replay stored `ResponseJson`; no duplicate mutation/notification |
| Same key + different request | `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST` |
| Already cancelled (other key) | Business success `alreadyCancelled` / idempotent |
| Claim | Autonomous SERIALIZABLE claim **outside** cancel write TX (FAILED survives rollback) |
