# Phase 1F — Booking Ownership

**Helper:** `src/lib/branch/bookingQueueOwnership.ts`

## Stamp on create

* Internal (`source` operations/admin): `BranchID` from authenticated active session — never client `branchId`.  
* Public: resolve `branchCode` via `resolvePublicBranchCode` (no silent GLEEM default) → stamp that `BranchID`.  
* `BookingServices` rows inherit via parent FK only.

## Read / mutate protection

`assertBookingOwnedByActiveBranch(activeBranchId, booking.BranchID)` on operations and admin booking mutations (get/update, arrive → queue, convert, etc.).

Wrong branch → non-disclosing `bookingQueueNotFoundResponse()` (same pattern as financial 404).

Ownership is immutable after insert (no API accepts BranchID from payload).

## Convert to sale

`POST /api/bookings/[id]/convert`:

1. Gate open day/shift via `resolveBranchDayAndShiftForWrite`  
2. Require `Booking.BranchID === session BranchID`  
3. Create `خدمة` invoice with gated `BranchID` + `BusinessDayID`  
4. Verifier also checks converted sale BranchID matches booking BranchID

## Global BookingCode

`UX_Bookings_BookingCode` remains global. Public confirmation/cancel by code does **not** require `branchCode` (lookup returns safe branch metadata from persisted BranchID).

## Employee eligibility

Assignments use `TblEmpBranchAssignment` + `CanReceiveBookings` + effective date range (`isEmployeeEligibleForBranchBookings` / `listBookableEmployeeIdsForBranch`). Catalog services remain global (no branch price overrides).
