# Booking Phase 10A — Activate كامب شيزار + Assign Ahmed

**Date:** 2026-07-28  
**BranchCode:** `CAMP_CAESAR` (unchanged)  
**Display:** كامب شيزار  
**Ahmed EmpID:** **18** (احمد) — verified unique among active barbers

## Before → After

| Field | Before | After |
|---|---|---|
| LifecycleStatus | SETUP | **PUBLIC_LIVE** |
| IsActive | 0 | **1** |
| PublicBookingEnabled | 0 | **1** |
| QBS.BookingEnabled | 0 | **1** |
| BranchName / SalonName | فرع كامب شيزار / Camp Caesar | **كامب شيزار** |
| Hours | 11:00→01:30 | unchanged (Africa/Cairo) |

### Assignments (Ahmed)

| Branch | Before | After |
|---|---|---|
| GLEEM | active home (ID 4, from 2026-07-22) | **soft-ended** EffectiveTo=2026-07-27, IsActive=0 |
| CAMP_CAESAR | none | **active home** ID 183 from 2026-07-28, CanReceiveBookings=1 |

### Weekly schedule (Camp)

Sun–Fri working **11:00→01:30**; **Saturday off** (`IsWorking=0`) + branch closed weekday Sat.

### Services

Global catalog (no branch clone). Stamped `services:…` on assignment. Live public catalog: **30** services on both GLEEM and Camp.

## Live smoke (passed)

Artifact: `_booking-phase10a-dual-branch-smoke.json`

| Check | Result |
|---|---|
| Public branches | GLEEM + CAMP_CAESAR |
| Camp `BRANCH_NOT_PUBLIC` | **gone** |
| GLEEM barbers include Ahmed | **false** |
| Camp barbers include Ahmed | **true** (also زياد #12 Fri) |
| Ahmed Saturday | unavailable (`global_leave` / closed) |
| Ahmed Sun–Fri slots | available |
| GLEEM branch-first | **BK-84S5A4** create/replay/lookup/cancel/release |
| Camp barber-first (Ahmed) | **BK-RZK63D** |
| Camp branch-first | **BK-LW8QP3** |
| Contract | `booking-public-v1` (enforce unchanged) |

### Browser (`cutsaloon.com`)

Both branches listed; Ahmed only under Camp; contract header present.

## Rollback

See `scripts/branch-smoke/_phase10a-rollback.sql` (soft suspend public + soft-end Camp assignment; restore GLEEM via admin wizard — **no hard deletes**).

Artifacts: `_phase10a-before-state.json`, `_phase10a-after-state.json`.

## Verification

| Check | Result |
|---|---|
| Focused Phase 10A + branch context tests | **PASS** |
| ESLint | **PASS** |
| `npm run build` | **PASS** |
| Dual-branch live smoke | **PASS** |

## Verdict

**GO**
