# Phase 1Q — Global Barber Calendar

**Date:** 2026-07-26  
**Module:** `src/lib/hr/barberGlobalCalendar.ts`  
**Resolver:** `resolveEmployeeGlobalSchedule`

---

## Purpose

Barber-first public/admin calendar: one EmpID across public (or allowed) branches for a date range.

---

## APIs

| Endpoint | Behavior |
|---|---|
| `GET /api/public/booking/barbers?mode=global` | Unique barbers across public branches |
| `GET /api/public/booking/barbers/{empId}/calendar` | Day statuses + per-branch windows/slots |
| `GET /api/public/booking/barbers/{empId}/location` | Operational branch for a date |

---

## Day status values

`available` · `fully_booked` · `day_off` · `global_leave` · `branch_closed` · `not_assigned` · `service_not_available` · `outside_booking_horizon` · `presence_only`

- No `serviceIds` → `presenceOnly` (present but not bookable counts)
- With services → slot counts via `listAvailableBookingSlots` per branch

---

## Visibility

When `publicOnly=true`:

- Only branches passing `canBranchAppearInPublicBooking`
- Camp Caesar SETUP / non-public **hidden**
- Conflict / multi-branch same WorkDate still surfaced via resolver conflict code when applicable

---

## Location

`resolveBarberLocationForDate` returns the first working branch from the global union (policy expects at most one). Day off → `isWorking=false`, `reason=day_off`.
