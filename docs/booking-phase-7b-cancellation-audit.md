# Booking Phase 7B — Cancellation Audit

**Date:** 2026-07-27 · **DB:** last132

## Matrix

| Route/helper | Identifier | Ownership | Status | Cutoff | TX | Lock | Idempotency | Slot release | Side effects | Security | Migration |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `POST …/cancel` | **numeric BookingID** | phone (local +20 only) | PascalCase Cancelled/Completed | 30m via local Date | **No** | No | No | Implicit via LOWER status filter | None | ID enumeration, existence leak | Canonical service |
| `POST …/[code]/cancel` | Code + **BookingID fallback** | space-strip only | pending/confirmed lowercase | **None** | **No** | No | No | Status→cancelled | None | Code-only after phone; ID fallback | Canonical service |

## Explicit findings

| Finding | Severity |
|---|---|
| Cancellation by numeric BookingID | Critical |
| BookingID fallback from code route | Critical |
| Divergent phone normalization vs Phase 6/7A | High |
| No bookingAccessToken support | High |
| Mixed Status casing (`Cancelled` vs `cancelled`) | High |
| Updates outside transaction | High |
| No durable idempotency → duplicate side effects risk | High |
| Code route has no cutoff | High |
| No cache invalidation after cancel | Medium |
| No WhatsApp today (gap documented) | Low |
| No public deposit/payment on create | Info — operational cancel only |
| Busy intervals use `LOWER(Status) IN (active…)` — cancelled already excluded | OK once status is cancelled |

## cutsaloon.com

Out of scope. Backend will accept `code` + phone/token + optional `clientRequestId`. Legacy BookingID route body must stop working for public cancel.
