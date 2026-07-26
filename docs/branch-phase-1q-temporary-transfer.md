# Phase 1Q — Temporary Transfer

**Date:** 2026-07-26  
**Table:** `TblEmpTemporaryBranchTransfer`  
**Module:** `src/lib/hr/temporaryBranchTransfer.ts`

---

## Contract

Date-specific operational move **without** mutating `TblEmpBranchWorkSchedule`.

| Column | Role |
|---|---|
| EmpID | Employee |
| FromBranchID / ToBranchID | Source / destination |
| WorkDate | Single operational date |
| StartTime / EndTime | Optional window at destination |
| Reason | Required |
| IsActive | Prior same-date transfers deactivated on create |

---

## Create guards

| Check | Code / behavior |
|---|---|
| Same from/to | `TRANSFER_SAME_BRANCH` |
| Empty reason | `TRANSFER_REASON_REQUIRED` |
| No to-branch assignment | `EMPLOYEE_NOT_ASSIGNED_TO_BRANCH` |
| No to-branch payroll plan | `EMPLOYEE_BRANCH_PAYROLL_PLAN_REQUIRED` |
| Open attendance that day | `TRANSFER_ATTENDANCE_CONFLICT` |

---

## Resolver effect

| Branch | Result |
|---|---|
| From | Not working (`temporary_branch_transfer_away`) |
| To | Working with transfer window (`temporary_branch_transfer`) if assigned |

Still subject to `ONE_OPERATIONAL_BRANCH_PER_EMPLOYEE_PER_WORKDATE`.
