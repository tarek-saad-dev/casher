# Phase 1G — Second-Branch Operational Readiness (Overview)

**Status:** Infrastructure complete on cloud `last132` (uniqueness migration + verifier PASSED; GLEEM `ready=true`)  
**Date:** 2026-07-24  
**Database:** cloud / `last132` only  
**Founding branch:** GLEEM (`BranchCode = N'GLEEM'`) → BranchID **1**  
**Live active branches:** **1** (GLEEM only — no second branch created)  
**Sync:** stopped and unused

Companion docs: `branch-phase-1g-bootstrap.md`, `branch-phase-1g-validation.md`, `branch-phase-1g-closure.md`.

## 1. Goals

Prepare the system so a second branch **can** be created and operated safely **without** changing financial formulas or employee payroll/HR logic.

This phase is **operational readiness only**:

* Deliberate one-command bootstrap (create branch + seed settings/shares + optional access/assignment + readiness report)
* Assignment integrity audit (no redesign of assignment rules)
* Opening readiness checklist (`evaluateBranchOperationalReadiness`)
* Fix remaining unscoped `QueueBookingSettings` readers so a second settings row cannot silently leak GLEEM config
* Branch identity uniqueness (`BranchName`, filtered `ShortName`) so bootstrap cannot collide with GLEEM display names

No architectural redesign. No business-rule redesign.

## 2. What was audited

Pre-implementation readiness audit (read-only) found:

| Gap | Pre-1G state |
|---|---|
| Branch create | Only SQL seed of GLEEM in foundation migration; **no** create helper / API |
| Queue settings seed | GLEEM row from 1F; lazy insert only when session already on that branch; several **unscoped** `TOP 1` readers |
| Partner shares | GLEEM seed only; helpers exist but no create-branch wiring |
| Emp assignment CRUD | Table + GLEEM backfill; **no** bootstrap assign path |
| User access for new branch | No grant helper that avoids stealing `IsDefault` |
| Uniqueness | `UQ_TblBranch_BranchCode` only — no unique `BranchName` / `ShortName` |
| Opening checklist | No single readiness report |
| Switcher / calendar / HR | Explicitly out of scope (frozen) |

## 3. What is ready

On cloud `last132` (verifier 2026-07-24):

* `UQ_TblBranch_BranchName` + `UX_TblBranch_ShortName_NotNull` present (with existing `UQ_TblBranch_BranchCode`)
* Active branch count **1** (GLEEM); GLEEM has `QueueBookingSettings` + partner shares summing to 100%
* Assignment integrity: **0** errors, **0** warnings
* `readiness[GLEEM]: ready=true` (no blockers, no warnings)
* Prior phase BranchID columns / FKs intact; **0** BranchID columns on forbidden HR tables
* Bootstrap CLI + helpers: dry-run by default; writes require `--confirm`
* Unscoped settings paths fixed for admin booking-settings, queue POST, booking arrive, barber-durations timing defaults

## 4. Frozen exclusions (do not implement in 1G)

Still **deferred / frozen** — unchanged by this phase:

* HR / payroll / attendance BranchID  
* Ledger / targets / budgets BranchID  
* Service **price overrides** per branch  
* **Hybrid** employee schedule / day-off / overrides per branch  
* Internal **branch switcher** UI/API  
* Calendar import / Google / Calendly sync (inactive; unsafe until redesigned)  
* Sync-service resume  

Creating a second live branch remains a **deliberate human act** via `bootstrap-branch.ts --confirm` (plus grant + assign + readiness), not an automatic product action.

## 5. Boundary

**GO** for operational readiness infrastructure (see closure).  
**CONDITIONAL GO** for opening branch #2 only after bootstrap with grant-user + assign-emp and `ready=true`, plus business acceptance.  
**NO-GO** to casually enable a second branch without that checklist.
