# Phase 1D — Sales Ownership

## Flow (`POST /api/sales`)

1. Authenticate session
2. `resolveBranchDayAndShiftForWrite(userId)` — never browser `branchId`
3. Require open shift on active branch/day
4. Insert `TblinvServHead` with `BranchID` + `BusinessDayID` from gated context
5. Insert details + payments as children (no BranchID columns)
6. Trigger `InsCashMoveSales` inserts sale cash inheriting head Branch/Day (multi-row safe)
7. Split redistribution (`redistributeFromClearing`) stamps the same Branch/Day on transfer cash pairs
8. Commit atomically (existing applock / isolation preserved)

## Mutations

* Update/delete require active branch = persisted head `BranchID`
* Wrong-branch → non-disclosing 404
* Ownership columns never accepted from payload
* Booking convert creates `خدمة` invoice in active branch (bookings still lack BranchID; cross-branch conversion unsupported)

## Unchanged

Pricing, discounts, tax, employee allocation, loyalty formula, target formula, invoice numbering.
