# Phase 1O — Booking / Employee Handoff

**Scope note:** Documents Phase **1P** and **1Q** boundaries from Phase 1O. Schedule ownership for **1Q is implemented** (branch-owned); **1P frontend remains pending**.

## Phase 1P — Booking / public (GO for start · frontend pending)

| Work | Intent | Status |
|---|---|---|
| Public multi-branch selection UX | Unblock `public.branch_selection` / frontend multi-branch | **Pending** |
| Explicit `branchCode` on public booking requests | Unblock `public.explicit_branch_code` | **Pending** (backend supports; frontend TBD) |
| Public booking flow smoke | Unblock `public.booking_flow_smoke` | Pending |
| Branch-scoped customer notifications | Unblock `public.customer_notifications` when ExternalNotifications allowed | Pending |
| Overnight hours in booking availability | Consume CC 11:00–01:30 / cutoff 04:00 | Backend ready; CC not public |

Camp Caesar stays SETUP until INTERNAL_LIVE; public APIs must not expose CC while PublicBookingEnabled=0.

## Phase 1Q — Employees / schedules (implemented · branch-owned)

| Work | Intent | Status |
|---|---|---|
| Branch-owned weekly schedule SoT | `TblEmpBranchWorkSchedule`; policy one operational branch per WorkDate | **Done** |
| Resolvers + booking/attendance guards | Global/branch calendar; wrong-branch + attendance codes | **Done** |
| Admin branch-schedule UI | `/admin/hr/employees/{empId}/branch-schedule` | **Done** |
| Real employee assignment UI | Drive `commitEmployeeBranchAssignment` | Ops/UI follow-on |
| Real payroll values at assignment | Clear payroll.plan_coverage with approved amounts | Open (business) |
| Real target values / NO_TARGET | Clear target.policy_coverage | Open (business) |
| Eligible barbers for booking | CanReceiveBookings on CC | Blocked until CC activation |

See: `docs/branch-phase-1q-closure.md` and related `branch-phase-1q-*.md`.

## Explicit non-goals here

- Do not activate Camp Caesar INTERNAL_LIVE or PUBLIC_LIVE from 1O handoff alone  
- Do not invent opening cash, inventory qty, EffectiveFrom, payroll, or targets  
- Do not treat 1P frontend as done because 1Q schedule APIs shipped  

## Current handoff gate

| Item | Verdict |
|---|---|
| 1Q schedule model (branch-owned) | **GO (implemented)** |
| 1P booking frontend | **NO-GO / pending** |
| 1P booking APIs (backend schedule-aware) | **GO** |
| CC INTERNAL_LIVE | **NO-GO** |
| CC PUBLIC_LIVE | **NO-GO** |
