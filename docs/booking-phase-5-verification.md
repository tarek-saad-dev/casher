# Booking Phase 5 — Verification

**Date:** 2026-07-27 · **DB:** last132

## Tests

| Suite | Result |
|-------|--------|
| Phase 5 check-slot/plan/evaluator/parity/fingerprint | **PASS** |
| Phase 1–4 booking + phase1f ownership | **PASS** (113 in sample; full booking* suite below) |
| Combined Phase 1–5 booking sample | **119 tests PASS** |

## Build / ESLint

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| ESLint Phase 5 touched files | **PASS** (0 errors) |

## Live probe (GLEEM EmpID 12, service 9, WorkDate 2026-08-03)

Artifact: `scripts/branch-smoke/_booking-phase5-live-probe.json`

| Case | Result |
|------|--------|
| Specific check/plan available | true · parity **ok** |
| Specific cold/warm | ~5.4–5.8s (exact `validateBookingSlot` + day classify; strong_fresh) |
| Any-barber check/plan | available · candidates `[12, 7]` · ~2.0s |
| Overnight `00:00` dayOffset=1 | available |
| Multi-service `[9,15]` | duration **90** · subtotal **700** |
| Invalid dayOffset=2 | `INVALID_DAY_OFFSET` |
| CAMP_CAESAR check/plan | `BRANCH_NOT_PUBLIC` |
| evaluationMode | `strong_fresh` (no Phase-4 slot cache) |

## Migration matrix

| Route | Status |
|-------|--------|
| check-slot | **migrated** |
| plan | **migrated** (read-only; no INSERT) |
| create | **pending Booking Phase 6** |

## Phase 6 remaining

- Migrate `POST .../create` onto evaluator `purpose: create_precheck`
- Transactional any-barber pick + EmpID lock
- Revalidate plan fingerprint/token under lock (never treat as auth)
- Concurrency / double-book prevention
- cutsaloon.com contract alignment (out of Casher-only scope until then)
