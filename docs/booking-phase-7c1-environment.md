# Booking Phase 7C1 — Environment

| Env | Behavior when `PUBLIC_BOOKING_ALLOWED_ORIGINS` empty |
|---|---|
| production / VERCEL production | **No** browser origins; no `*`; warn once; no-Origin OK |
| development/test | Defaults: localhost + 127.0.0.1 ports 3000/3001 |

See `.env.example`. Do not commit secrets.
