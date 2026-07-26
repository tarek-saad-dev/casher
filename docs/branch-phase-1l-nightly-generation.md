# Phase 1L — Nightly Generation

**Date:** 2026-07-25  
**Service:** `src/lib/hr/nightly-close.service.ts`

## Topology

```text
load active branches

for each active branch:
    finalize attendance for branch
    validate branch attendance
    generate branch hourly payroll
    sync branch hourly-wage ledger
    generate branch targets
    sync branch target ledger

when WorkDate is last calendar day of month:
    for each active branch:
        post monthly salary components (idempotent)

after all branches:
    send employee WhatsApp once with branch breakdown
    send owner reports using branch sections
```

## Rules

* Never invoke payroll core without `branchId`
* Inactive branches excluded
* One branch failure is recorded independently; others remain committed
* Retry is idempotent per BranchID + WorkDate
* With one active branch (GLEEM), behavior remains unchanged

## Status

| Step | Status |
|---|---|
| Per-branch attendance finalize | Done |
| Per-branch payroll + ledger | Done |
| Per-branch targets | Done |
| Month-end monthly salary | Done |
| One employee WA with branchEarnings | Done |
| Owner WA branch sections | Done |

## Non-goals

* Second-branch activation to prove iteration (code iterates `listActiveBranches`)
* Global employee/date payroll generation
