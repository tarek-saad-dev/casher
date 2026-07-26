# Phase 1O — Employee Assignment Contract

**Module:** `employeeAssignmentCommit` · `commitEmployeeBranchAssignment`  
**Status:** Contract **delivered**; real CC assignments **OPEN** (`biz.real_employees`).

## Identity policy (RESOLVED)

- Employee identity = **global** (`TblEmp`)
- Branch assignment = writable account at EmpID + BranchID
- Do **not** create duplicate people for Camp Caesar
- Do **not** copy GLEEM payroll/target plans as fallback

## Wizard commit requirements

Atomic commit must include:

1. Assignment (`EffectiveFrom`, operate / booking flags, optional home branch)
2. Work schedule days
3. Service eligibility (`serviceProIds` when canOperate)
4. **Payroll plan** at assignment time (hourly / daily / monthly with positive rate)
5. **Target policy**: `TARGET_PLAN` (branch-scoped plan) **or** explicit `NO_TARGET`

No invent of real payroll amounts or target tiers in Phase 1O docs/apply.

## Still OPEN (business)

| Decision | Status |
|---|---|
| Real employee assignments on CC | OPEN |
| Real payroll values | OPEN |
| Real target values | OPEN |

SmokeRunID 11 (1N) used controlled smoke employees then cleaned — not production assignments.

## Handoff

Phase **1Q** implements real employee assignment UI/ops against this contract. Do not activate INTERNAL_LIVE without `biz.real_employees` cleared.
