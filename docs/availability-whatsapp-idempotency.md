# WhatsApp booking event / idempotency

## Events

- `create` — existing post-commit path.
- `move` — after `rescheduleBookingMove` commit (authoritative phone via `loadBookingCustomerContact`).
- `cancel` — after public cancel / staff cancel / ops explicit cancel (`scheduleCancelWhatsAppAfterCommit`).

## Customer phone

Server-only loader: `src/lib/booking/bookingCustomerContact.ts`  
Resolves `TblClient.Mobile` then `TblClient.Phone`, normalized Egyptian numbers. Never trusts frontend phones.

## Idempotency

Key: `wa:{eventType}:{bookingId}:{eventVersion}` in `dbo.TblBookingNotifyRequest`.

Statuses: `queued` → `sending` → `sent` | `failed`.

Columns: `RetryCount`, `ProviderMessageId`, `LastError`, `QueuedAt`, `SendingAt`, `SentAt`, `FailedAt`.

- Missing/invalid phone → row marked `failed` (`MISSING_CUSTOMER_PHONE` / `INVALID_CUSTOMER_PHONE`); booking action stays committed.
- `sent` only after provider confirms (via `onResult` from `scheduleBookingWhatsAppAfterCommit`).
- Retry: `retryBookingEventWhatsApp` — failed only; CAS `failed→sending`; never resend `sent`.

## Tests

`src/lib/__tests__/bookingEventWhatsApp.test.ts` — queue once, duplicate version skip, new version, cancel, missing/invalid phone, retry, concurrent CAS, cancel-after-commit contract.
