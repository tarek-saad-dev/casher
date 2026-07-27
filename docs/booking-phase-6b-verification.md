# Booking Phase 6B — Verification

**Date:** 2026-07-27 · **DB:** last132

## Commands executed

| Check | Result |
|-------|--------|
| Phase 6B connection/persistence unit tests | **PASS** |
| Phase 6 contract + Phase 5 sample | **PASS** (57 in combined unit run) |
| `npx tsx scripts/verify-booking-create-concurrency.ts` | **PASS** |
| ESLint touched 6B files (excl. pre-existing engine anys) | **PASS** |
| `npm run build` | **PASS** |

## Double-book prevention (live)

**GO** — concurrent same-slot reached lock/availability layer (`SLOT_UNAVAILABLE`), not pool acquisition failure.

## Phase 6C follow-up (live coverage)

Phase 6C closes the remaining live-proof gaps. See:

- `docs/booking-phase-6c-any-vs-specific.md`
- `docs/booking-phase-6c-cross-branch-locking.md`
- `docs/booking-phase-6c-rollback-retry.md`
- `docs/booking-phase-6c-multi-service-overlap.md`
- `docs/booking-phase-6c-overnight-equivalence.md`
- `docs/booking-phase-6c-code-collision.md`
- `docs/booking-phase-6c-smoke-results.md`
- `docs/booking-phase-6c-verification.md`
- `docs/booking-phase-6c-closure.md`

All Phase 6B artifacts remain valid evidence; Phase 6C adds a real `TblBranchSmokeRun` row for consistent auditability.

## Design-only vs live-proven

Phase 6B statements above were live-proven against the `last132` database. Phase 6C statements are either design contracts (until executed) or live metrics from `scripts/verify-booking-phase6c-final-proof.ts`.

| Gap | Status in 6B | Status in 6C |
|---|---|---|
| Cross-branch global Emp race | design-covered | live-proven |
| Injected rollback mid-details | design-covered | live-proven |
| Explicit any-vs-specific race case | design-covered | live-proven |
| Booking-code collision injection | design-covered | live-proven |
| Multi-service overlap boundaries | design-covered | live-proven |
| Overnight equivalent representation | design-covered | live-proven |
