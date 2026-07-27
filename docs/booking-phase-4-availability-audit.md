# Booking Phase 4 — Availability audit

**Date:** 2026-07-27

| Path | Duration source (before) | Schedule | Busy | Branch | Overnight | N+1 | Fallback | Change |
|------|--------------------------|----------|------|--------|-----------|-----|----------|--------|
| available-days | getServicesDuration + default | legacy + batch | custom | resolvePublicBranchCode | yes | low | system default | **Migrated** → Phase-2 durationOverride + engine |
| available-slots | calculateServicePlanDuration / emp | engine | queue+booking | legacy public | yes | parallel barbers | SYSTEM_DEFAULT | **Migrated** public path |
| barbers/.../available-slots | engine | branch schedule | engine | legacy | yes | 1 emp | same | **Shared** getPublicAvailableSlots |
| bookingAvailabilityEngine | emp→service→system | branch-owned | buildQueue/BookingIntervals | branchId | yes | busy parallel | yes | Accept durationOverride + collectAllCandidates |
| public calendar | n/a presence | global schedule | none | publicOnly | yes | days×schedule | n/a | Enrich when serviceIds |

Still using emp/system duration: ops/admin `source=operations|admin` path, plan/create (Phase 5).
