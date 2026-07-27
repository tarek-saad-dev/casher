# Booking Phase 7C1 — Security

- Exact origin match only
- No credentials + wildcard combo
- Origin ≠ ownership / access token
- Rejected origins never leak allowlist
- Structured log `public_booking.cors_origin_rejected` (rate-limited)
- Camp Caesar / internal_preview unaffected by CORS allowlist
