# Phase 1F — Availability

**Engine:** `src/lib/bookingAvailabilityEngine.ts`  
**Busy intervals:** `buildBookingIntervals` / `buildQueueIntervals` in `src/lib/queueEstimateEngine.ts`  
**Locks:** `src/lib/scheduleIntegrity.ts`

## Branch-scoped eligibility

When `branchId` is supplied, candidate barbers = `listBookableEmployeeIdsForBranch(branchId, date)` (`TblEmpBranchAssignment` + `CanReceiveBookings`). Settings/timing load via `getPublicSettings(branchId)`.

## Employee-global conflicts (intentional)

Busy interval builders filter by **employee + date/status only** — **no BranchID predicate**. An employee’s bookings/tickets at any branch block the same emp timeline. Unit tests assert this contract.

Schedule lock remains:

```text
operations-schedule:{EmpID}:{operationalDate}
```

Not branch-scoped. Prevents double-commit across concurrent writers for the same emp/day.

## Overnight / dayOffset

Live: **47** cross-midnight bookings (`EndTime` time &lt; `StartTime` time). Engine continues to emit slots with `dayOffset` 0|1 for overnight salon hours. Phase 1F does not change overnight semantics — only adds branch eligibility + settings scope around the existing timeline math.

## Not branch-scoped this phase

* Employee weekly schedules  
* Day-off / overrides  
* Freelance unlocks remain emp-keyed as before  

Multi-hour-per-branch schedule hybrid is **out of scope** (possible Phase 1G only if required).
