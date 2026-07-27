# Booking Phase 6 — Plan token

Verify signature/expiry/fields via `verifyPlanToken` + digest match.

Errors: `PLAN_TOKEN_INVALID` | `EXPIRED` | `REQUEST_MISMATCH`.

Token never skips under-lock availability. Absent → `planTokenStatus: absent_legacy`.
