# Booking Phase 7C1 — Proxy

`proxy.ts` classifies `/api/public/*` as `anonymous_public` → next().

- Does not attach login 401 before booking CORS
- `/api/admin/*` remains session-required
- Allowed Origin does **not** authorize admin, preview, or Camp Caesar
