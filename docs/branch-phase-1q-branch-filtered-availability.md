# Phase 1Q — Branch-Filtered Availability

**Date:** 2026-07-26  
**Engine:** `bookingAvailabilityEngine.ts` + `resolveEmployeeBranchSchedule`

---

## Rules

1. Candidate barbers for a branch = assignment + CanReceiveBookings + branch schedule working that WorkDate.  
2. Slots load settings/hours for **that** `branchId`.  
3. Global leave / day_off → not available at any branch.  
4. Temporary transfer: **from** branch not working; **to** branch uses transfer window.  
5. Public path: branch must be PUBLIC_LIVE + IsActive + PublicBookingEnabled + QBS.BookingEnabled.

---

## Wrong-branch booking

If barber works elsewhere that day but not at requested branch:

```text
BARBER_AVAILABLE_AT_DIFFERENT_BRANCH
```

Used by:

- `GET …/barbers/{empId}/available-slots`
- `POST …/booking/create`

---

## Employee-global busy timeline

Busy intervals remain EmpID-scoped across branches (Phase 1F): bookings/tickets at any branch block the same emp timeline. Schedule ownership is branch-scoped; conflict timeline is still global per employee.

---

## Overnight

Start/end where end ≤ start → `endDayOffset=1`; absolute `endDateTime` on next calendar date. Branch hours (e.g. CC 11:00–01:30) consumed when that branch is in scope — CC stays non-public while SETUP.
