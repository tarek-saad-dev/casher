# Phase 1M — Controlled Smoke Plan (PH1GTEST)

## Target

```text
BranchCode = PH1GTEST
BranchID = 2 (live last132)
```

Do **not** create a new test branch. Do **not** expose publicly.

## Isolation model

1. Move to `SMOKE_TEST` only when smoke readiness passes.  
2. Keep `PublicBookingEnabled=0`, `IsActive=0` (not in production nightly).  
3. Start run via `POST /api/admin/branches/{id}/smoke/start` → `TblBranchSmokeRun`.  
4. Register artifacts in `TblBranchSmokeArtifact`.  
5. External side effects disabled on run (`ExternalSideEffectsEnabled=0`).  
6. Cleanup via script/API — refuses GLEEM; returns PH1GTEST to SETUP.

## Workflow checklist (execute manually / runner)

A Access & isolation  
B Employee setup + payroll/target plans  
C Attendance  
D Booking & queue (internal)  
E Sales  
F Treasury  
G Inventory  
H Payroll  
I Targets  
J Ledger / payouts  
K Monthly salary (controlled)  
L Explicit smoke nightly (targeted BranchID — not production scheduler)  
M Reports reconciliation  

## GLEEM proof method

Prefer artifact ownership proof over raw row-count freeze while salon operates:

```text
No smoke artifact has BranchID = GLEEM
No GLEEM row references a smoke entity
No PH1GTEST mutation changed a persisted GLEEM-owned record
```

## Status of execution in this delivery

See `docs/branch-phase-1m-smoke-results.md` — **not executed / NO-GO** until run.
