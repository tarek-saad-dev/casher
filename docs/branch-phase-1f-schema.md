# Phase 1F Schema — Booking / Queue Branch Ownership

**Migration:** `db/migrations/add-booking-queue-branch-ownership.sql`  
**Runner:** `scripts/run-booking-queue-branch-ownership-migration.ts --confirm-maintenance`  
**Database:** cloud / `last132`  
**GLEEM:** `WHERE BranchCode = N'GLEEM'` → live BranchID **1**

## Columns added

| Table | Column | Nullability (final) | FK |
|---|---|---|---|
| `Bookings` | `BranchID` | NOT NULL | `FK_Bookings_BranchID` → `TblBranch` |
| `QueueTickets` | `BranchID` | NOT NULL | `FK_QueueTickets_BranchID` → `TblBranch` |
| `QueueBookingSettings` | `BranchID` | NOT NULL | `FK_QueueBookingSettings_BranchID` → `TblBranch` |

Migration path: add nullable → backfill GLEEM → ALTER NOT NULL → add FK.

## Indexes / constraints

| Name | Table | Definition |
|---|---|---|
| `IX_Bookings_Branch_BookingDate` | Bookings | `(BranchID, BookingDate)` INCLUDE AssignedEmpID, Status, StartTime, EndTime, BookingCode |
| `UX_Bookings_BookingCode` | Bookings | **preserved** global unique on `BookingCode` |
| `UQ_QueueTickets_Branch_Date_Code` | QueueTickets | UNIQUE `(BranchID, QueueDate, TicketCode)` — replaces `UQ_QueueTickets_Code_Date` |
| `IX_QueueTickets_Branch_QueueDate` | QueueTickets | `(BranchID, QueueDate)` INCLUDE EmpID, Status, TicketCode, TicketNumber |
| `UQ_QueueBookingSettings_BranchID` | QueueBookingSettings | UNIQUE `(BranchID)` |

## Children (no BranchID)

| Table | Ownership |
|---|---|
| `BookingServices` | via `BookingID` → Bookings.BranchID |
| `QueueTicketHistory` | via `QueueTicketID` → QueueTickets.BranchID |
| `QueueTicketServices` | via `QueueTicketID` (0 rows live; may exist) — no child BranchID |

## Backfill

All existing rows stamped to GLEEM. Pre-state captured; **post counts pending migration run** (see verification/closure).

Expected after successful run (single founding branch):

* Bookings → 1499 GLEEM, 0 null, 0 non-GLEEM  
* QueueTickets → 139 GLEEM, 0 null, 0 non-GLEEM  
* QueueBookingSettings → 1 GLEEM, 0 null  

## Explicit non-changes

No BranchID on: emp schedules, day-off, overrides, BookingServices, QueueTicketHistory, QueueTicketServices, attendance, payroll, targets, ledger, budgets.  
No service price override tables.  
No Change Tracking enabled on booking/queue tables.  
PK shapes unchanged (`BookingID`, `QueueTicketID`, `SettingID`).
