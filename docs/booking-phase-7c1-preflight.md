# Booking Phase 7C1 — Preflight

Successful allowed OPTIONS → **204** with:

- ACAO exact origin
- Vary: Origin
- Allow-Methods: route-specific
- Allow-Headers: Content-Type (+ Idempotency-Key for create/cancel, Authorization for lookup)
- Max-Age: 600

Disallowed OPTIONS → **403** nested `CORS_ORIGIN_NOT_ALLOWED` without ACAO.
