# Phase 1M — Readiness Contract

## Engine

`evaluateBranchReadiness(branchId)` → score + gates + blockers/warnings/sections

Activation depends on **blockers for the target gate**, not score alone.

Gates:

- `isReadyForSmoke`  
- `isReadyForInternalLive`  
- `isReadyForPublicLive`  

## Hard examples

| Key | Gate | Rule |
|---|---|---|
| `payroll.plan_coverage` | smoke+ | Assigned employees must have effective branch payroll plan |
| `ops.is_active` | internal/public | IsActive must match live statuses |
| `booking.public_flag` | public | PublicBookingEnabled only when PUBLIC_LIVE |
| `public.frontend_multi_branch` | public | Warning until cutsaloon.com multi-branch proven |

Legacy Phase 1G checks are mapped into sectioned items.

## APIs / UI

- `GET /api/admin/branches/{id}/readiness`  
- `POST /api/admin/branches/{id}/readiness/recheck`  
- `/admin/branches/{id}/readiness` — transition buttons disabled when gate fails  
- Transition API re-runs readiness server-side  

## Transition

`transitionBranchLifecycle({ branchId, targetStatus, actor, reason })`

- Validates FSM  
- Re-runs readiness  
- Requires reason  
- SMOKE→INTERNAL requires PASSED SmokeRunID  
- Blocks PH1GTEST→PUBLIC_LIVE  
- Audits previous/next  
