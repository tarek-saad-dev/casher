# Phase 1F Closure — Booking, Queue, Availability & Public Booking Branch Ownership

**Status:** Complete on cloud `last132` (migration + verifier + idempotent re-run OK)  
**Date:** 2026-07-23  
**Database:** cloud / `last132` only  
**Founding branch:** GLEEM (`BranchCode = N'GLEEM'`) → BranchID **1**  
**Sync:** stopped and unused

## 1. Live dependencies

See `docs/branch-phase-1f-booking-queue-dependency-audit.md`.

Pre-capture at migration (`_phase1f-booking-queue-before.json`): Bookings **1500**, BookingServices **1527**, QueueTickets **139**, QueueTicketHistory **176**, QueueBookingSettings **1**, QueueTicketServices **0**. BookingCode: 0 duplicates, 20 nulls. TicketCode+QueueDate: 0 duplicates. No CT on booking/queue tables. BranchID columns absent pre-migration.

## 2. Columns changed

| Table | Column |
|---|---|
| `Bookings` | `BranchID NOT NULL` |
| `QueueTickets` | `BranchID NOT NULL` |
| `QueueBookingSettings` | `BranchID NOT NULL` |

Children (`BookingServices`, `QueueTicketHistory`, `QueueTicketServices`) — **no** BranchID; inherit via parent.

## 3. Constraints and indexes

* FKs: `FK_Bookings_BranchID`, `FK_QueueTickets_BranchID`, `FK_QueueBookingSettings_BranchID`  
* `IX_Bookings_Branch_BookingDate`, `IX_QueueTickets_Branch_QueueDate`  
* Preserve `UX_Bookings_BookingCode` (global)  
* Drop `UQ_QueueTickets_Code_Date` → add `UQ_QueueTickets_Branch_Date_Code (BranchID, QueueDate, TicketCode)`  
* `UQ_QueueBookingSettings_BranchID`

## 4. Backfill counts

| Object | Total | Null BranchID | GLEEM | Non-GLEEM |
|---|---:|---:|---:|---:|
| Bookings | 1500 | 0 | 1500 | 0 |
| QueueTickets | 139 | 0 | 139 | 0 |
| QueueBookingSettings | 1 | 0 | 1 | 0 |

Business fingerprints (counts, checksums, estimates, codes) unchanged across before/after of the migration window. Idempotent second runner execution: OK.

## 5. Queue uniqueness

Ticket codes and numbers scoped to **BranchID + QueueDate** (`queueTicketCode.ts` + new unique constraint). Global date-only uniqueness removed.

## 6. Public contract

* `GET /api/public/branches`  
* Public booking requires `branchCode` except BookingCode global lookup/cancel  
* No silent GLEEM default (`BRANCH_REQUIRED` / `INVALID_BRANCH`)  
* Public UI (sibling **cut-salon-rtl-booking**): Branch → Services → …

## 7. Booking / queue protection

Session mutations assert persisted BranchID equals active branch; wrong branch → non-disclosing not-found. Convert requires `Booking.BranchID = session BranchID`. BranchID never accepted from client payload.

## 8. Employee assignment

Bookable emps via `TblEmpBranchAssignment` + `CanReceiveBookings` + effective dates (`bookingQueueOwnership.ts`). No branch service price overrides.

## 9. Global conflicts

`buildBookingIntervals` / `buildQueueIntervals` remain **emp-global** (no BranchID filter). Schedule lock: `operations-schedule:{EmpID}:{operationalDate}`.

## 10. Overnight

47 cross-midnight bookings in pre-capture; `dayOffset` overnight slot behavior unchanged. Schedules/day-off/overrides **not** given BranchID this phase.

## 11. Flow board

Filters bookings/queue by active `BranchID`; response includes `activeBranch` metadata. No internal branch switcher.

## 12. Caches

Settings: `__pos_public_settings_cache_by_branch_v1` Map keyed by BranchID. Ticket sequences DB-scoped per branch+date. Flow-board refresh keys include branchId.

## 13. WhatsApp / calendar

* WhatsApp: pass persisted `branchName`; do not rely on `WHATSAPP_DEFAULT_BRANCH_NAME` when BranchID known.  
* Calendar: no active Google/Calendly import in POS — inactive/legacy; unsafe for second branch until redesigned.

## 14. Fingerprints

See `_phase1f-booking-queue-before.json` / `_phase1f-booking-queue-after.json`. Matching checksums for Bookings, BookingServices, QueueTickets, QueueHistory, estimate sums; ownership columns present only after.
Compare before/after capture keys (counts, checksums, estimate wait, cross-midnight, dup codes). **Matched** on migration window; ownership counts filled in after capture.

## 15. Tests and commands

```bash
npx tsx scripts/run-booking-queue-branch-ownership-migration.ts --mode=cloud --expected-database=last132 --confirm-maintenance
npx tsx scripts/verify-booking-queue-branch-ownership.ts --mode=cloud --expected-database=last132
npx vitest run src/lib/__tests__/phase1fBookingQueueOwnership.test.ts src/lib/__tests__/bookingSettingsCache.test.ts
```

Helper: `src/lib/branch/bookingQueueOwnership.ts`. Migration: `db/migrations/add-booking-queue-branch-ownership.sql`.

## 16. Change Tracking / sync-service

No Change Tracking on booking/queue tables (pre or post). Sync-service remains **stopped and unused** — not part of multi-branch architecture.

## 17. Limitations

* One live branch (GLEEM); no second branch; no switcher  
* Emp conflicts + schedule locks remain global per emp/day  
* Schedules / day-off / overrides lack BranchID  
* No service price overrides  
* Calendar import inactive  

## 18. Next-phase boundary

Do **not** start the next phase from this closure alone without acceptance.

**Recommend Phase 1G — Second-branch operational readiness** (settings seed for a new branch + assignment/ops validation) **OR** hybrid employee schedule/day-off per branch **only if** multi-hour-per-branch is required.

**Still deferred:** HR / payroll / attendance / ledger BranchID (frozen).

## 19. Go / no-go

**GO for Phase 1F** — migration verified on cloud `last132` (idempotent re-run OK); code + docs on the described contracts.

**NO-GO for enabling a second branch in production** until Phase 1G readiness (settings seed + assignment/ops validation, and hybrid schedules if required) is accepted. Do not resume calendar import without branch-aware design.
