# Phase 1S-R — Verification

## Live probe

```bash
npx tsx scripts/branch-smoke/probe-phase1s-r-authoritative.ts
```

Artifact: `scripts/branch-smoke/_phase1s-r-authoritative-truth.json`

## Required verifiers

```bash
npx tsx scripts/verify-camp-caesar-internal-go-live.ts
npx tsx scripts/verify-employee-schedule-operations-integration.ts
npx tsx scripts/verify-cross-branch-employee-scheduling-booking.ts
npx tsx scripts/verify-camp-caesar-real-configuration.ts
npx tsx scripts/verify-camp-caesar-operational-readiness.ts
npx tsx scripts/verify-branch-provisioning-readiness-smoke.ts
npx tsx scripts/verify-employee-financial-branch-ownership.ts
```

## Must fail if

- Phase 1S docs still claim NOT RUN / SETUP / transition not executed while live is INTERNAL_LIVE
- “Final smoke” is retained-only (SmokeRun 18 pattern)
- Open hours with zero employee coverage and no closed-day rows
- Service catalog unexpectedly incomplete (&lt;10 bookable)
- Camp Caesar publicly exposed / public booking enabled
- GLEEM lifecycle or public booking changed

## Authoritative agreement

All `docs/branch-phase-1s-*.md` regenerated in Phase 1S-R must report:

- Lifecycle **INTERNAL_LIVE**
- Final smoke **22** (not 18)
- Phase 1R smoke **16**
- Weekly coverage **NO-GO**
- PUBLIC_LIVE **NO-GO**
