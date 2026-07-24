# Phase 1K — Check-In / Check-Out Contract

**Date:** 2026-07-24  
**Service:** `src/lib/hr/attendance/branchAttendance.service.ts`  
**Database:** cloud / `last132`

---

## 1. Design principles

1. **Branch-owned rows** — every attendance write stamps session `BranchID`.  
2. **Session wins** — routes reject body `BranchID` / `branchId`.  
3. **Assignment required** — employee must have active `TblEmpBranchAssignment` for that branch on `WorkDate`.  
4. **Employee-global open conflict** — at most one open session (`CheckIn` set, `CheckOut` null) per EmpID across all branches.  
5. **Idempotent retries** — re-check-in / re-check-out of the same open/closed state returns existing row.  
6. **Concurrency** — `sp_getapplock` resource `attendance-session:{EmpID}` + `UPDLOCK`/`HOLDLOCK` on reads.

---

## 2. WorkDate resolution

`resolveAttendanceWorkDate(branch)`:

| Condition | WorkDate |
|---|---|
| Open business day for branch | `TblNewDay.newDay` |
| Else | `getBranchBusinessDate(branch)` |

Client-supplied WorkDate is not authoritative for check-in (optional server-derived override only inside service callers).

---

## 3. Check-in (`checkInEmployee`)

| Step | Behavior |
|---|---|
| Gate | `branch.canOperate` |
| Eligibility | Active emp + assignment for session branch / WorkDate |
| Lock | Exclusive applock on EmpID |
| Any open elsewhere | **409** `ALREADY_OPEN` unless same branch+WorkDate (idempotent return) |
| Existing closed same branch+date | **409** `ALREADY_CLOSED` |
| Existing pending/absent row | UPDATE check-in fields (same BranchID) |
| No row | INSERT with `BranchID` |

---

## 4. Check-out (`checkOutEmployee`)

| Step | Behavior |
|---|---|
| Load by attendance ID | `UPDLOCK`/`HOLDLOCK` |
| Branch match | Persisted `BranchID` must equal session branch — else **404** |
| Lock | Applock on EmpID |
| Already checked out | Idempotent return |
| No check-in | **400** `NO_CHECKIN` |
| Success | SET `CheckOutTime` (+ status / early leave / notes) |

---

## 5. Open-session representation

| Fact | Value |
|---|---|
| Open = | `CheckInTime IS NOT NULL AND CheckOutTime IS NULL` |
| Not a dedicated Status | Status often remains `Present` / `Late` |
| DB unique on open | **None** (historical multi-open incompletes) |
| App exclusivity | Applock + `getOpenAttendanceForEmployee` |

---

## 6. Route expectations

| Route family | Branch gate |
|---|---|
| `/api/employees/attendance` | `requireBranchOperationAccess`; GET filters `BranchID` |
| Admin attendance / bulk | Session branch; assignment assert on writes |
| Breaks / PATCH by ID | Must load via `loadAttendanceOwnedByBranch` (or equivalent) |

Body BranchID rejected on mutating endpoints.
