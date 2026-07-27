# Booking Phase 7C2 — Verification

## Readiness proof

| Field | Value |
|---|---|
| Phase | `booking-phase-7c2-readiness-proof` |
| Command | `BOOKING_PHASE_7C2_VERIFIER=enabled npx tsx scripts/verify-booking-phase7c2-readiness.ts` |
| Artifact | `_booking-phase7c2-readiness-proof.json` |
| Result | **PASSED** (`passed: true`, `failed: []`) |

### Proofs asserted

- `no_legacy_rate_limit_helpers`
- `routes_use_gate` (all 17 route files)
- `rate_limit_policy_exists` + gate inputs
- `contract_mode_module_exists`
- `contract_mode_default_compat`
- `error_code_PLAN_TOKEN_REQUIRED`
- `error_code_RATE_LIMIT_EXCEEDED`
- `error_code_LEGACY_BOOKING_CONTRACT_DISABLED`
- `env_example_contract_mode_compat`

## Unit / contract tests

| Suite | Focus |
|---|---|
| `bookingContractMode.test.ts` | default compat, enforce, header name |
| `bookingContractCompatibility.test.ts` | metadata + deprecation headers |
| `bookingContractEnforcement.test.ts` | create/cancel require keys in enforce |
| `bookingPublicRateLimitPolicy.test.ts` | matrix, overrides, digests |
| `bookingPublicClientIp.test.ts` | trusted vs local XFF |
| `bookingPublicRateLimitResponses.test.ts` | 429 shape / headers |
| `bookingPublicErrorCatalog.test.ts` | catalog presence |
| `bookingPublicErrorStatusMatrix.test.ts` | status exclusivity |
| `bookingPublicRequestLimits.test.ts` | caps |
| `bookingUpcomingBatchServices.test.ts` | batch services |
| `bookingBackendReadinessSmoke.test.ts` | verifier registry |

## Manual / live (optional follow-ups)

| Check | Status |
|---|---|
| Cold available-days wall-clock after parallelization | **Not measured** in 7C2 (see performance audit) |
| Production `enforce` smoke | **Blocked** (NO-GO until frontend cutover) |
| Camp Caesar still absent from `GET /api/public/branches` | Policy unchanged — reconfirm in smoke if needed |

## Regression baseline

Retain 7C1 CORS proof and 7A/7B cancel/lookup suites as prerequisites; 7C2 does not reopen CORS wildcard.
