# Phase 1S-R — Internal-live readiness

## Gate

`evaluateBranchReadiness(3)` — public `public.*` keys block **PUBLIC_LIVE only**.

## Required for INTERNAL_LIVE (policy)

- Opening cash + opening inventory
- Active dated partners
- Real employees + payroll + target/NO_TARGET coverage
- Service catalog operational (≥10 bookable)
- **Weekly employee coverage** (every open weekday staffed or explicitly closed)
- Phase 1R live transfer proof
- **Final current-config smoke** (rejects retained-only copies)
- Cleanup + GLEEM isolation
- Nightly via active list + authorized switcher + public exclusion

## Live state after Phase 1S-R

Cleared for activation path: opening, partners, real employee (Ziad), catalog (~30 bookable), SmokeRun 16 + **22**.

Still blocking operational readiness:

| Key | Status |
|-----|--------|
| `ops.weekly_employee_coverage` | **blocker** — Sun–Thu+Sat uncovered |
| `public.*` | blockers (PUBLIC_LIVE only) |

`final.current_config_smoke` → pass (SmokeRun 22).  
Retained SmokeRun 18 is rejected by readiness policy.

## Verdict

Database may remain INTERNAL_LIVE, but **INTERNAL_LIVE operational readiness = NO-GO** until weekly coverage is resolved by business decision.
