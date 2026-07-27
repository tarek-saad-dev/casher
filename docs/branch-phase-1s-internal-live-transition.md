# Phase 1S-R — Internal-live transition

## SUPERSEDED

Previous **Not executed** claim is **SUPERSEDED**.

## Executed path

`transitionBranchLifecycle` on BranchID=3:

1. AuditID **22** — SETUP → SMOKE_TEST (actor 10)
2. AuditID **23** — SMOKE_TEST → INTERNAL_LIVE (actor 10, smokeRunId 18 at time of transition)

Script reference: `scripts/branch-smoke/activate-phase1s-internal-live.ts`

## Flags preserved

```
LifecycleStatus = INTERNAL_LIVE
IsActive = 1
PublicBookingEnabled = 0
QueueBookingSettings.BookingEnabled = 0
ExternalNotificationsEnabled = 1
LifecycleStatus ≠ PUBLIC_LIVE
```

## Note on smoke at transition

Transition referenced SmokeRun **18**. Phase 1S-R later proved **18 is retained-only** and executed authoritative final smoke **22**. Lifecycle remains INTERNAL_LIVE; readiness now requires current-config smoke (22), not retained 18.
