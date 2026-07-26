# Phase 1Q — Booking API Contract

**Date:** 2026-07-26  
**Public visibility:** `PUBLIC_LIVE` + `IsActive` + `PublicBookingEnabled` + QBS.`BookingEnabled`  
**Camp Caesar:** SETUP → **hidden** (no activation this phase)

---

## Endpoints (1Q schedule surface)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/public/booking/barbers` | `mode=global` (default without branchCode) or `mode=branch` + `branchCode` |
| GET | `/api/public/booking/barbers/{empId}/calendar` | `from`/`to`; optional `branchCode`, `serviceIds` |
| GET | `/api/public/booking/barbers/{empId}/location` | `date`; returns operational branch |
| GET | `/api/public/booking/barbers/{empId}/available-slots` | Requires resolvable public branch; schedule-checked |
| POST | `/api/public/booking/create` | Branch-stamped; rejects wrong-branch barber |

### Related public booking (pre-1Q, still branchCode-gated)

| Method | Path |
|---|---|
| GET | `/api/public/booking/config` |
| GET | `/api/public/booking/status` |
| GET | `/api/public/booking/services` |
| GET | `/api/public/booking/available-days` |
| GET | `/api/public/booking/available-slots` |
| POST | `/api/public/booking/check-slot` |
| POST | `/api/public/booking/plan` |
| GET | `/api/public/booking/[code]` |
| POST | `/api/public/booking/cancel` |
| POST | `/api/public/booking/[code]/cancel` |
| POST | `/api/public/booking/upcoming` |

---

## Error codes (schedule)

| Code | When |
|---|---|
| `BARBER_AVAILABLE_AT_DIFFERENT_BRANCH` | Barber working elsewhere, not at requested branch |
| `EMPLOYEE_MULTI_BRANCH_SAME_WORKDAY_NOT_ALLOWED` | Policy conflict (>1 working branch same WorkDate) |

---

## Admin schedule API

| Method | Path |
|---|---|
| GET | `/api/admin/employees/{id}/branch-schedule` |
| PUT | `/api/admin/employees/{id}/branch-schedule` |

UI: `/admin/hr/employees/{empId}/branch-schedule`

---

## Frontend (Phase 1P)

Multi-branch public UX / explicit `branchCode` on cutsaloon.com remains **pending**. Backend contract above is ready; do not expose CC publicly.
