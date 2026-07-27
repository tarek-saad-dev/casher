# Booking Phase 7B — Policy & Cutoff

**Module:** `src/lib/booking/publicBookingCancellationPolicy.ts`

- Shared `resolvePublicCancellationCutoff` used by Phase 7A `canCancel` and Phase 7B cancel.
- Cutoff: **30 minutes** before `AbsoluteStartUtc` (hardcoded constant `PUBLIC_CANCELLATION_CUTOFF_MINUTES`).
- Cairo wall-clock via Absolute UTC ms — not server local TZ.
- Ambiguous legacy dates → `BOOKING_CANCELLATION_REQUIRES_STAFF`.
- Status via `mapPublicBookingStatus`: confirmed/pending cancellable; cancelled/in_service/completed/no_show not.

## Payment

No public create deposit/invoice path today. Cancel is **operational only**. If `InvoiceID` present → `BOOKING_HAS_PAYMENT` (staff). No auto-refund.
