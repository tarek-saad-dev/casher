# Booking Phase 7B — Post-Commit

| Effect | Behavior |
|---|---|
| Cache invalidation | After commit; skipped on pure idempotent replay path that never entered write TX success mutation |
| WhatsApp | **Not sent** on public cancel today (create-only schedule path). Gap documented — no pre-commit send |
| Printer | None |
| Side-effect failure | Cannot roll back committed cancel |

Reliability gap: no durable cancel outbox yet. Idempotency `NotificationSent` column reserved.
