# Booking Phase 7C2 — Backend Readiness

**Date:** 2026-07-27 · **Phase:** Public booking contract hardening (compat mode, rate limits, errors, perf)

## Executive verdict

| Gate | Verdict | Notes |
|---|---|---|
| Ship 7C2 backend under **`compat`** | **GO** | Default mode; production must remain compat |
| Activate **`enforce`** in production | **NO-GO** | Until frontend cutover sends `planToken` + idempotency on create |
| Camp Caesar public enable | **NO-GO** | Must remain non-public |
| Distributed rate-limit store | **NO-GO** (optional later) | In-memory best-effort is accepted for 7C2 |
| cutsaloon.com full cutover | **NO-GO** (client) | Backend ready in compat; client work remains |

## Delivered (backend)

| Area | Module / artifact |
|---|---|
| Contract mode | `publicBookingContractMode.ts` → `booking-public-v1`, default `compat` |
| Response headers | `publicBookingResponse.ts` + route gate |
| Rate limits | `publicBookingRateLimitPolicy.ts` + `gatePublicBookingRoute` on **17** routes |
| Client IP | `publicBookingClientIp.ts` |
| Request limits | `publicBookingRequestLimits.ts` |
| Error catalog / matrix | `publicBookingErrorCatalog.ts` (67 codes) |
| available-days perf | Parallel days + preloaded slot context |
| upcoming perf | `loadServiceLinesBatch` |
| Verifier | `scripts/verify-booking-phase7c2-readiness.ts` → `_booking-phase7c2-readiness-proof.json` (**passed**) |
| Live smoke | `scripts/verify-booking-phase7c2-backend-readiness-smoke.ts` → **SmokeRunID 74** (**passed**) |
| Tests | Phase 7C2 vitest suite (contract, RL, IP, errors, limits, readiness smoke) |

## GO criteria checklist

| Criterion | Status |
|---|---|
| All 17 public booking routes gated | PASS |
| No legacy `getRateLimitKey` / `checkRateLimit` on those routes | PASS |
| Default contract mode `compat` | PASS |
| `.env.example` documents `PUBLIC_BOOKING_CONTRACT_MODE=compat` | PASS |
| Rate-limit matrix documented & coded | PASS |
| Camp Caesar excluded from public discovery / booking | PASS (unchanged policy) |
| CORS allowlist from 7C1 retained | PASS (prerequisite) |
| Enforce mode available but not production-default | PASS |

## NO-GO / remaining

1. **Mandatory enforce activation** — blocked on frontend planToken + Idempotency-Key cutover  
2. **Live available-days timing** — SmokeRunID 74: **10.5s cold** (14-day range, down from ~64s sequential); under 15s Phase 8 blocker  
3. **Distributed RL** — multi-instance fairness not guaranteed  
4. **OTP / notification outbox** — out of 7C2  
5. **Camp Caesar public** — explicitly excluded  

## Recommendation

Merge/ship Phase 7C2 backend with **`PUBLIC_BOOKING_CONTRACT_MODE=compat`**. Monitor `public_booking.legacy_contract_used` logs. Flip to `enforce` only after client proof and a coordinated release.
