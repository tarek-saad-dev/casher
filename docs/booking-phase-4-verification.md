# Booking Phase 4 — Verification

**Date:** 2026-07-27 · **DB:** last132

## Tests

| Suite | Result |
|-------|--------|
| Phase 4 available-days/slots/overnight/security | **PASS** |
| Phase 1–3 + availability engine/duration + 1Q | **PASS** |
| Combined sample | **111 tests PASS** |

## Build / ESLint

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| ESLint Phase 4 files | **PASS** (0 errors; 2 pre-existing warnings in engine) |

## Live probe (GLEEM EmpID 12, service 9)

See `scripts/branch-smoke/_booking-phase4-live-probe.json`.

- available-days cold/warm measured
- available-slots on working day with overnight dayOffset support
- any-barber candidate counts
- multi-service duration sum
- calendar presence_only without services; enriched statuses with serviceIds
- CAMP_CAESAR → `BRANCH_NOT_PUBLIC`

## Cache

TTL 8s, max 48 entries. Key includes branch/mode/emp/date/services/duration/contract. Short TTL because busy-version signals are incomplete.
