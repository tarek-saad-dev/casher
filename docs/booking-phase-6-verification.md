# Booking Phase 6 — Verification

**Date:** 2026-07-27 · **DB:** last132

## Tests / build / ESLint

| Check | Result |
|-------|--------|
| Phase 6 contract tests | **PASS** (11) |
| Phase 1–5 booking sample | **PASS** (98 in combined run) |
| `npm run build` | **PASS** |
| ESLint Phase 6 files | **PASS** |

## Live smoke

Artifacts:
- `scripts/branch-smoke/_booking-phase6-live-probe.json`
- `scripts/branch-smoke/_booking-phase6-idempotency-probe.json`

| Case | Result |
|------|--------|
| Specific create | OK · Emp 12 · `fixed_barber` |
| Idempotent replay | **same code**, `idempotentReplay: true` |
| Key reused different payload | `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST` |
| Any-barber create | OK · Emp 7 · `server_selected` |
| Overnight create | OK · dayOffset=1 |
| CAMP_CAESAR | `BRANCH_NOT_PUBLIC` |
| WhatsApp on placeholder | skipped |
| Cleanup | deleted smoke bookings + idempotency keys |

Concurrent same-slot smoke observed connection-pool contention under parallel TX (`Can't acquire connection`); locks + SERIALIZABLE remain the double-book barrier. Re-run under production pool sizing for stronger concurrent timing proof.

## Phase 6B update

Live concurrency proof completed via `scripts/verify-booking-create-concurrency.ts` after fixing Transaction same-connection `Promise.all` busy loads.

**Double-book prevention live concurrency:** **GO** (see `docs/booking-phase-6b-concurrency-results.md`).

## Migration matrix

| Route | Status |
|-------|--------|
| create | **migrated** |
| lookup by code | **migrated (Phase 7A)** |
| upcoming | **migrated (Phase 7A)** |
| cancel | **pending Phase 7B** |
| cutsaloon.com | pending after backend closure |

## Phase 7 remaining

- Public upcoming / lookup / cancel contracts
- cutsaloon.com planToken + clientRequestId mandatory
- Durable notification outbox (optional hardening)
