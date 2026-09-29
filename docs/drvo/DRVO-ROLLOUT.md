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
| DRVO-004 | booking | `extracted` | `extracted` | Platform Core + booking prerequisites are deployed and production readiness is verified. | Source-controlled cutover to extracted Booking; rollback remains `legacy` |
| DRVO-005 | queue | `extracted` | `extracted` | Platform Core + queue prerequisites are deployed and production readiness is verified; extracted create/cancel/quick paths passed staging smoke and review fixes | Source-controlled cutover to extracted Queue; rollback remains `legacy` |
| DRVO-006 | operational-calendar | `extracted` | `always_on_infrastructure` | Composition always uses extracted port adapter; no flag; already serving production | None |
| DRVO-007 | treasury | `extracted` | `always_on_infrastructure` | Non-sale money movement always via MoneyMovement port; sale trigger remains separate | None |

## Future (DRVO-008+)

Every extracted module must declare required migrations, dependencies, readiness checks, rollout state, and rollback path. CI calls `assertExtractedRolloutContract` and fails incomplete `rollout: 'extracted'` declarations.
