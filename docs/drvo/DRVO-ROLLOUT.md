# DRVO Module Rollout — Classification Audit

| Field | Value |
|-------|-------|
| Authority | `src/platform/drvo/moduleManifest.ts` |
| Principle | Schema readiness ≠ business-path readiness |

## Precedence

1. `DRVO_FORCE_<MODULE>_PATH=legacy|extracted` (emergency)
2. Compat env `=== 'true'` → force extracted (testing only)
3. Compat env `false` / unset → ignored → use manifest
4. `moduleManifest.rollout`

## Module table

| DRVO | Module | Source `rollout` | Classification | Why | Behavior change this PR |
|------|--------|------------------|---------------|-----|-------------------------|
| DRVO-004 | booking | `legacy` | `legacy` | Strangler port exists; production incident required legacy. Extracted path not production-activated. | Path still legacy; authority moves from env-required to Git |
| DRVO-005 | queue | `legacy` | `legacy` | Same strangler pattern; not independently proven production-safe | Path still legacy |
| DRVO-006 | operational-calendar | `extracted` | `always_on_infrastructure` | Composition always uses extracted port adapter; no flag; already serving production | None |
| DRVO-007 | treasury | `extracted` | `always_on_infrastructure` | Non-sale money movement always via MoneyMovement port; sale trigger remains separate | None |

## Future (DRVO-008+)

Every extracted module must declare required migrations, dependencies, readiness checks, rollout state, and rollback path. CI calls `assertExtractedRolloutContract` and fails incomplete `rollout: 'extracted'` declarations.
