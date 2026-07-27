# Booking Phase 6 — Transaction

SERIALIZABLE + XACT via mssql Transaction.

Inside TX: idempotency claim → applocks → `assertEmployeeIntervalAvailable` → customer upsert → booking head → service lines → idempotency complete → commit.

No WhatsApp / HTTP inside TX. Rollback marks idempotency FAILED when claimed.
