# Phase 1G — Validation (Assignment Integrity, Readiness, Verifier)

**Status:** Implemented and live-verified on cloud `last132`  
**Date:** 2026-07-24  
**Helpers:** `src/lib/branch/assignmentIntegrity.ts`, `src/lib/branch/readiness.ts`  
**Verifier:** `scripts/verify-second-branch-readiness.ts`

## 1. Assignment integrity

`auditEmployeeAssignmentIntegrity()` inspects `TblEmpBranchAssignment` without redesigning rules.

| Code | Severity | Meaning |
|---|---|---|
| `ASSIGNMENT_ORPHAN_BRANCH` | error | Assignment references missing `BranchID` |
| `ASSIGNMENT_INVALID_DATES` | error | `EffectiveTo` before `EffectiveFrom` |
| `DUPLICATE_ACTIVE_ASSIGNMENT` | error | Multiple concurrent active rows for same emp+branch on audit day |
| `OVERLAPPING_ASSIGNMENT_RANGES` | error | Overlapping date ranges for same emp+branch among active rows |
| `ASSIGNMENT_INACTIVE_BRANCH` | warning | Active assignment on inactive branch |
| `EMP_ASSIGNED_NOWHERE` | warning | Active barber/assistant with no effective assignment on audit day |

Bookable eligibility for readiness still uses existing `listBookableEmployeeIdsForBranch` (`CanReceiveBookings` + effective dates + active branch) — not redesigned here.

Bootstrap helper: `ensureEmployeeBranchAssignment` — minimal insert if no effective active row for emp+branch on `effectiveFrom`.

## 2. Opening readiness checklist

`evaluateBranchOperationalReadiness({ branchId | branchCode })` returns `ready`, `blockers`, `warnings`, and `checks[]`.

`ready === true` iff no **blocker** failed.

### Blockers

| Code | Pass condition |
|---|---|
| `BRANCH_EXISTS` | Branch resolved (missing → report with `ready=false`) |
| `BRANCH_ACTIVE` | `IsActive=1` |
| `BRANCH_METADATA` | Code, name, timezone, cutoff present |
| `QUEUE_SETTINGS` | `QueueBookingSettings` row for `BranchID` |
| `ELIGIBLE_BARBER` | ≥1 bookable employee on branch for audit day |
| `OPERATOR_ACCESS` | ≥1 non-deleted user with active `CanOperate` access |
| `BUSINESS_DAY_SCHEMA` | `TblNewDay.BranchID` present |
| `SHIFT_SCHEMA` | `TblShiftMove.BranchID` present |
| `BOOKING_SCHEMA` | `Bookings.BranchID` present |
| `QUEUE_SCHEMA` | `QueueTickets.BranchID` present |
| `ASSIGNMENT_INTEGRITY` | No assignment integrity **errors** in scope for this branch |

### Warnings / info

| Code | Severity | Notes |
|---|---|---|
| `PUBLIC_BOOKING_FLAG` | info / warning | Info if `BookingEnabled=1`; warning if `0` (ops may still work) |
| `REPORT_VISIBILITY` | warning | No `CanViewReports` access yet |
| `PARTNER_SHARES` | warning | Missing open shares or sum ≠ ~100 |

## 3. Verifier (`verify-second-branch-readiness.ts`)

```bash
npx tsx scripts/verify-second-branch-readiness.ts \
  --mode=cloud \
  --expected-database=last132
```

**Fails** when:

* Missing `UQ_TblBranch_BranchCode`, `UQ_TblBranch_BranchName`, or `UX_TblBranch_ShortName_NotNull`
* Active branch missing `QueueBookingSettings`
* Missing prior-phase BranchID columns / booking-queue FKs
* Any BranchID on forbidden HR tables (`TblEmpAttendance`, `TblEmpPayroll`, `TblEmpTarget`, `TblEmpLedgerEntry`, `TblBudget`)
* GLEEM missing / missing settings / partner shares not summing to 100%
* Assignment integrity **errors**
* GLEEM readiness `ready=false`

**Does not fail** solely because a second branch is absent or not yet ready — Phase 1G does not require a second branch to exist. Non-GLEEM not-ready is a **warning**.

### Live result (2026-07-24, `last132`)

```
branch uniqueness constraints present: UQ_TblBranch_BranchCode, UQ_TblBranch_BranchName, UX_TblBranch_ShortName_NotNull
active branch count: 1
assignment integrity: 0 issue(s) (errors=0, warnings=0)
readiness[GLEEM]: ready=true blockers=(none) warnings=(none)
Phase 1G verification PASSED
```

## 4. Unscoped settings fixes

Previously singleton-minded `QueueBookingSettings` readers were branch-scoped so a second row cannot silently serve GLEEM config:

| Path | Fix |
|---|---|
| `src/app/api/admin/booking-settings/route.ts` | `requireActiveBranchContext` / `requireBranchOperationAccess`; create/select/update by `BranchID`; never seed branch-less rows |
| `src/app/api/queue/route.ts` | Settings load `WHERE BranchID = @branchId` |
| `src/app/api/operations/bookings/[id]/arrive/route.ts` | Settings load by `booking.BranchID` |
| `src/app/api/services/[id]/barber-durations/route.ts` | Timing defaults via `getPublicSettings(activeBranch.branchId)` / `getGlobalTimingDefaults` |

Source-contract tests in `phase1gSecondBranchReadiness.test.ts` assert these call sites stay scoped.
