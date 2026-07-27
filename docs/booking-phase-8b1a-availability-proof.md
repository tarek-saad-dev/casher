# Booking Phase 8B1A — Availability Proof

## Live API

`available-days` / `available-slots` / `check-slot` require `bookingEnabled && publicBookingEnabled`.

While paused, availability calls return **`BRANCH_BOOKING_DISABLED`** (same gate as services).

| Proof | Status |
|---|---|
| available-days cold/warm timings | **NOT MEASURED live** (branch paused) |
| available-slots | **NOT RUN** |
| check-slot parity | **NOT RUN** |
| overnight dayOffset | **NOT RUN** |

## Historical `global_leave` explanation

Documented in barber-schedule proof: specific-barber `isGlobalDayOff` mapping + public visibility collapse while paused; plus Emp12 day_off on 2026-07-27.

## Regression coverage

`bookingPhase8b1aPausedBranchGates.test.ts` asserts gate ordering and `global_leave` mapping source.
