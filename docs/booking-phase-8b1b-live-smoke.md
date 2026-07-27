# Booking Phase 8B1B — Controlled Live Smoke

**Date:** 2026-07-27  
**Alias:** `https://casher-five.vercel.app`  
**Contract mode:** `compat`  
**Artifact:** `_booking-phase8b1b-live-smoke.json`  
**Verifier:** `scripts/verify-booking-phase8b1b-live-smoke.ts`

## Live API smoke (passed)

| Step | Result |
|---|---|
| branches | GLEEM only |
| services | **30** |
| barbers | **5** |
| available-days | statuses include `available` |
| selected slot | **2026-07-28 / 11:00 / dayOffset=0** (serviceId=9, any_barber) |
| check-slot | `available=true` |
| plan | planToken present (redacted), subtotal **200**, duration **30** |
| create | **201** bookingCode **BK-KQJ5SP** |
| idempotent replay | same bookingCode, `idempotentReplay=true` |
| lookup | confirmed |
| cancel | cancelled |
| slot release | check-slot available again |
| Camp Caesar | `BRANCH_NOT_PUBLIC` |

### Timings (ms)

branches 1232 · services 936 · barbers 4332 · available-days 11523 · slots 2907 · check-slot 2909 · plan 2885 · create 7155 · replay 595 · lookup 691 · cancel 4529

## Browser proof (`https://cutsaloon.com`)

| Field | Result |
|---|---|
| contractVersion | `booking-public-v1` |
| contractUnverified | **false** |
| plan | nested `plan.planToken` OK |
| create | **201** `BK-XGHWB4` |
| cancel | **OK** |
| selected | 2026-07-28 / 13:00 / dayOffset 0 |

Tokens redacted in artifacts. No enforce mode. No Camp Caesar enable. No hard-delete.

## Note

First smoke attempt used same-day 23:52 and hit `BOOKING_CANCELLATION_WINDOW_CLOSED` (30m cutoff). Final smoke uses a future day outside the cancel window.

## Verification

| Check | Result |
|---|---|
| Phase 8B1B + 8B1A gate tests | **8 PASS** |
| ESLint touched files | **PASS** |
| `npm run build` | **PASS** |

## Verdict

**GO** — controlled live public booking flow proven after `BookingEnabled=1`.
