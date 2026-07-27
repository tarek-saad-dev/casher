# Booking Phase 7C2 — Cache Review

In-memory, process-local caches used by the public booking surface. None are phone-keyed. HTTP responses remain `Cache-Control: no-store` via the route gate.

## Inventory

| Module | Global key | TTL | Max entries | Contents |
|---|---|---|---|---|
| `publicBookingAvailability.ts` | `__pos_public_booking_availability_v4` | **8_000** ms | **48** | available-days, available-slots, `slots-pre` snapshots |
| `publicBookingBranchContext.ts` | `__pos_public_booking_branch_ctx_v1` | **30_000** ms | (map eviction) | Resolved public branch context |
| `publicBookingServices.ts` | `__pos_public_booking_services_v2` | **30_000** ms | — | Service catalog per branch |
| `publicBookingBarbers.ts` | `__pos_public_booking_barbers_v3` | **20_000** ms | — | Barber catalog |

## Invalidation

| Event | Action |
|---|---|
| Successful public **create** (post-commit) | `invalidatePublicBookingAvailabilityCache()` + `invalidatePublicBookingBarberRelatedCaches()` |
| Successful public **cancel** (post-commit) | Same |
| Services / barbers admin changes | Module-specific invalidators (existing) |

`invalidatePublicBookingBarberRelatedCaches()` clears barbers + services caches.

## Rate-limit buckets

Separate from response caches: in-memory Map in `publicBookingRateLimitPolicy.ts` (per-instance, window reset). Cleared only via `resetPublicBookingRateLimitsForTests()`.

## Review verdicts

| Topic | Verdict |
|---|---|
| Availability TTL 8s | Acceptable for public slot freshness; invalidate on create/cancel |
| Branch/services 20–30s | Acceptable for catalog; Camp Caesar never enters public discovery cache as bookable |
| Distributed cache | **Not required** for 7C2 GO; document as future hardening |
| CDN / HTTP caching | **Do not** enable — keep `no-store` |
| Phone / PII in cache keys | **None** observed on public booking caches |
