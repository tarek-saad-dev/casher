# Booking Phase 6B — Concurrency results

**Artifact:** `scripts/branch-smoke/_booking-phase6b-concurrency.json`  
**Verifier:** `scripts/verify-booking-create-concurrency.ts`

| Scenario | Result |
|----------|--------|
| Specific same-slot (barrier, 2 keys) | **1 success** (`BK-NJX2CY`) + **SLOT_UNAVAILABLE**; `poolError: false` |
| Same idempotency key concurrent | Both returned **same code** `BK-F3AXRC` |
| Reused key different payload | `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST` |
| Any-barber N=2 → 3 requests | 2 successes (Emp 25, 7) + SLOT_UNAVAILABLE; no Emp overlap |
| Overnight create | OK; `PublicDayOffset=1` |
| Persistence columns | WorkDate, DayOffset, AbsoluteStart/End, IdempotencyRequestID present |
| Cleanup | leftover **0** |

Pool-acquisition failure is treated as verifier **FAIL** (not accepted).
