# Booking Phase 8C — Enable Enforce and Final Smoke

**Date:** 2026-07-28  
**Alias:** `https://casher-five.vercel.app`  
**Contract mode:** `PUBLIC_BOOKING_CONTRACT_MODE=enforce` (live)  
**Artifact:** `_booking-phase8c-enforce-smoke.json`  
**Verifier:** `scripts/verify-booking-phase8c-enforce-smoke.ts`

## Enforce status

| Check | Result |
|---|---|
| Live create without `planToken` | **400 `PLAN_TOKEN_REQUIRED`** |
| Live create with plan, no Idempotency-Key | **400 `IDEMPOTENCY_KEY_REQUIRED`** |
| Live cancel without Idempotency-Key | **400 `IDEMPOTENCY_KEY_REQUIRED`** |
| `X-Booking-Contract-Version` | `booking-public-v1` |
| Expose-Headers | present (contract / request-id / rate-limit) |

**enforce_active = true**

## Canonical API flows

### Branch-first (`any_barber`)

| Step | Result |
|---|---|
| selected | **2026-07-29 / 11:00 / dayOffset=0** (serviceId=9) |
| create | **201 `BK-GJWN68`** |
| idempotent replay | same code |
| lookup | confirmed |
| cancel + cancel replay | cancelled |
| lookup after cancel | cancelled |

### Barber-first (`specific_barber`)

| Step | Result |
|---|---|
| selected barber | empId **25** (18=global_leave; 12=SLOT_UNAVAILABLE race) |
| selected | **2026-07-29 / 14:00 / dayOffset=0** |
| create | **201 `BK-ADRBMH`** |
| idempotent replay | same code |
| lookup / cancel / cancel replay | OK |

## Rejection tests

| Case | Result |
|---|---|
| create without planToken | `PLAN_TOKEN_REQUIRED` |
| create without Idempotency-Key | `IDEMPOTENCY_KEY_REQUIRED` |
| cancel without Idempotency-Key (valid-format code) | `IDEMPOTENCY_KEY_REQUIRED` |

## Browser proof (`https://cutsaloon.com`)

Cross-origin `fetch` from cutsaloon.com origin (enforce + CORS expose):

| Field | Result |
|---|---|
| branches | GLEEM only |
| Camp Caesar services | **404 `BRANCH_NOT_PUBLIC`** |
| plan nested `plan.planToken` | OK |
| create | **201 `BK-J4GW2H`** |
| lookup | confirmed |
| cancel | cancelled |
| create without planToken | `PLAN_TOKEN_REQUIRED` |
| readable headers | `X-Booking-Contract-Version`, `X-RateLimit-*`, `X-Request-Id` |

Tokens redacted in artifacts. No Camp Caesar enable. No real customer data. No contract schema changes.

## Privacy / CORS

| Check | Result |
|---|---|
| Public branches | GLEEM only |
| Camp Caesar | `BRANCH_NOT_PUBLIC` |
| CORS ACAO | `https://cutsaloon.com` |
| Expose-Headers | still working from browser JS |

## Verification

| Check | Result |
|---|---|
| Focused contract/CORS/8C tests | **PASS** |
| ESLint (`verify-booking-phase8c-enforce-smoke.ts`) | **PASS** |
| `npm run build` | **PASS** |
| Production smoke artifact | **passed: true** |

## Verdict

**GO** — production enforce mode proven for branch-first and barber-first journeys, rejections, cutsaloon.com UI CORS, and Camp Caesar privacy.
