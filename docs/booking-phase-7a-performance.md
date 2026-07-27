# Booking Phase 7A — Performance

Lookup/upcoming avoid availability engines and catalogs.

Typical round trips:

| Path | SQL |
|---|---|
| Lookup | 1 head + 1 services |
| Upcoming | 1 list + N services (N ≤ limit) |

No new indexes in this phase (evaluate unique BookingCode / phone+AbsoluteStartUtc only with plan evidence).  
Cache: `Cache-Control: no-store`; no phone-keyed caches.
