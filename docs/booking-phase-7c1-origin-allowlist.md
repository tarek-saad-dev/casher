# Booking Phase 7C1 — Origin Allowlist

**Env:** `PUBLIC_BOOKING_ALLOWED_ORIGINS` — comma-separated absolute origins.

Production minimum example: `https://cutsaloon.com`  
Add `https://www.cutsaloon.com` only when that host is an approved live origin.

Matching: **exact normalized origin equality** only (no substring / suffix / includes).

Normalization rejects: paths, query, hash, wildcards, credentials in URL.
