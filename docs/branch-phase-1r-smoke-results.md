# Phase 1R — Smoke Results

**Date:** 2026-07-26  
**SmokeRunID:** `PHASE1R-CONTRACT-2026-07-26` (static/contract verification; no production employee mutations)

## Boundary honored

- Real Ziad schedule not modified.
- Camp Caesar remains SETUP / non-public / not listed in normal transfer destinations.
- No sync restart.
- No silent booking BranchID moves.

## Contract scenarios verified in code + nested 1Q verifier

| Scenario | Result |
|---|---|
| HR entry «الفروع ومواعيد العمل» | PASS |
| Weekly planner empId + preview/save APIs | PASS |
| Same-weekday multi-branch rejection codes present | PASS |
| Transfer preview blockers (bookings/attendance/queue/payroll/leave) | PASS |
| FromBranchID mismatch rejection | PASS |
| Soft cancel (no DELETE) | PASS |
| Flow-board location filter | PASS |
| SETUP excluded from ops destinations | PASS |
| Nested Phase 1Q verifier | PASS (when run) |

## Live apply/cancel on a disposable test employee

Deferred to controlled DB smoke when a disposable employee with dual-branch assignment + payroll + services is provisioned. Do not use production Ziad.
