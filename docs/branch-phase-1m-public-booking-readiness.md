# Phase 1M — Public Booking Multi-Branch Readiness

## Backend (this repo)

| Endpoint area | branchCode |
|---|---|
| `/api/public/branches` | lists only PUBLIC_LIVE + PublicBookingEnabled + IsActive |
| `config`, `status`, `services`, `barbers`, `available-days`, `available-slots`, `check-slot`, `plan`, `create` | resolve via `resolvePublicBranchCode` |
| lookup/cancel by booking code | global code (existing) |

### Rules

- Zero public branches → empty list / BRANCH_REQUIRED  
- One public branch → temporary compatibility fallback may auto-select **that public** branch only  
- Multiple public branches → **fail closed** (BRANCH_REQUIRED) until client sends branchCode  
- PH1GTEST / SETUP / SMOKE_TEST never discoverable  
- Single-active fallback uses `listPublicActiveBranches`, not all `IsActive` ops branches  

## Frontend (cutsaloon.com) — required before second PUBLIC_LIVE

```text
GET /api/public/branches
→ resolve or ask for selected branch
→ send branchCode with every booking request
```

- Cache keys include branchCode  
- Stale persisted branch validated  
- Switching clears dates/slots/barber/incompatible services  
- No request after init without branchCode  

## Gate

`public.frontend_multi_branch` readiness item remains a **public_live** concern.  
Do not enable a second PUBLIC_LIVE branch until production frontend deployment passes.

## Status helper

`GET /api/public/booking/status?branchCode=` — lightweight bookingEnabled gate for UI.
