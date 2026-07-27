# Booking Phase 5 — Plan

**Route:** `POST /api/public/booking/plan`

## Behavior

Read-only plan via canonical evaluator (`purpose: plan`).

Succeeds only when `available = true`.

**Does not** INSERT bookings, holds, or customers. Create remains Phase 6.

## Response

`contractVersion: booking-plan-v1`, branch (no BranchID), services lines, subtotal=total, `pricingScope: global`, `planFingerprint` + short-lived `planToken`.
