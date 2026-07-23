# Phase 1F — Queue Ownership

## Stamp on create

Walk-in and booking-arrive tickets stamp `QueueTickets.BranchID` from the owning booking/session branch (already asserted equal to active branch for arrive). History rows stay children of the ticket — no `BranchID` column.

## Uniqueness & numbering

| Concern | Rule |
|---|---|
| DB unique | `UQ_QueueTickets_Branch_Date_Code (BranchID, QueueDate, TicketCode)` |
| Generation | `src/lib/queueTicketCode.ts` — `MAX(TicketNumber)+1` WHERE `BranchID = @branchId AND QueueDate = @qDate` with `UPDLOCK, HOLDLOCK` in-transaction |

Same ticket code may exist on different branches on the same calendar date; not across BranchID within a date.

## Mutate protection

Queue announce/cancel/status routes load `BranchID` and call `assertBookingOwnedByActiveBranch` (shared assert). Wrong branch → non-disclosing not-found.

## Settings

`QueueBookingSettings` is one row per `BranchID` (`UQ_QueueBookingSettings_BranchID`). Reads for public/ops timing use `WHERE BranchID = @branchId`.

## Children

`QueueTicketHistory` / `QueueTicketServices` (0 rows live) inherit ownership via parent ticket. No child BranchID this phase.
