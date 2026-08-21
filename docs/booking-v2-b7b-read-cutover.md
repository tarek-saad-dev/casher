# Booking V2 — Phase B7B Staged Read Cutover

## Goal

Serve V2 FreeMask availability on public reads gradually, with an instant kill
switch, identical public contracts, and **no write-path changes**.

## Flags

| Env | Values | Default |
|---|---|---|
| `BOOKING_V2_READ_MODE` | `legacy` \| `shadow` \| `canary` \| `v2` | `shadow` |
| `BOOKING_V2_READ_CANARY_PERCENT` | `0`–`100` | `10` |

| Mode | User response | Forward shadow (Legacy auth) | Reverse shadow (V2 auth) |
|---|---|---|---|
| `legacy` | Legacy | off | off |
| `shadow` | Legacy | on | off |
| `canary` | V2 if bucket &lt; % | on for Legacy cohort | on for V2 cohort |
| `v2` | V2 | off | on (sampled) |

**Kill switch (no deploy):** `BOOKING_V2_READ_MODE=legacy`

## Deterministic canary

Bucket = FNV-1a(`canaryKey`) % 100. Serve V2 iff `bucket < CANARY_PERCENT`.

Key priority:

1. `X-Booking-Canary-Key` / `X-Client-Id` / `?canaryKey=`
2. cookie `booking_canary` / `booking_session`
3. fallback fingerprint: `branchCode|empId|UA|IP`

Same client stays on the same engine across steps.

## Fallback

On **technical** V2 failure before a valid response:

1. log `V2_READ_FALLBACK`
2. serve Legacy
3. increment V2 `fallbackCount`

`PublicBookingAvailabilityError` (semantic) is **not** fallen back — rethrown.

## Public contracts

V2 maps to existing `PublicAvailableSlotsResponse` / `PublicAvailableDaysResponse`
(`contractVersion: v7`). Ops/admin `source=operations|admin` envelopes unchanged.

## Rollout steps (manual)

1. Internal admin probe `/api/admin/booking/v2/availability` + metrics `/api/admin/booking/v2/cutover`
2. `BOOKING_V2_READ_MODE=canary` + `BOOKING_V2_READ_CANARY_PERCENT=10`
3. 25 → 50 → 100 (env only; never auto)

## Metrics

Per engine (`legacy` / `v2`): requestCount, errorRate, fallbackCount, p50/p95,
dbMs, queryCount, slotCountAvg. See admin cutover route.

## Write path

Unchanged: create / confirm / hold / cancel / reschedule / applocks /
SERIALIZABLE / legacy write guards / slot-claims (still shadow).

## Recommended initial percentage

**10%** (`BOOKING_V2_READ_MODE=canary`, `BOOKING_V2_READ_CANARY_PERCENT=10`).

## GO / NO-GO for 10% canary

**GO** — prerequisites from B7A.5 met (34/34 parity, 0 mismatches, V2 faster),
deterministic canary + kill switch + fallback + contract mapping covered by tests;
write path untouched.
