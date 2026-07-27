# Booking Phase 5 — Plan fingerprint

**Module:** `src/lib/booking/publicBookingPlanFingerprint.ts`

| Field | Meaning |
|-------|---------|
| `planFingerprint` | Deterministic HMAC-SHA256 (SESSION_SECRET) of canonical plan fields (no wall-clock) |
| `planToken` | Short-lived signed token (`exp` ≈ 5 minutes) embedding fingerprint + fields + `evaluatedAt` |
| Signed? | Yes — existing `SESSION_SECRET` (no new secret) |
| Reservation? | **No** |
| Authorization? | **No** — create must revalidate under lock |

Canonical fields: contract version, branchCode, serviceIds, mode, empId, WorkDate, time, dayOffset, totalDurationMinutes, subtotal.
