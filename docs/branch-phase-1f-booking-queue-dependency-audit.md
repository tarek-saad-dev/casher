# Phase 1F — Booking / Queue Dependency Audit

**Date:** 2026-07-23  
**Database:** cloud / `last132` (sole source of truth)  
**Sync:** stopped and unused  
**Founding branch:** `BranchCode = N'GLEEM'` → live `BranchID = 1`  
**Pre-capture:** `scripts/audit-branches/_phase1f-booking-queue-before.json`  
**Live schema audit:** `scripts/audit-branches/_phase1f-live-schema-audit.json`

## Pre-migration live counts

| Object | Count |
|---|---:|
| Bookings | 1499 |
| BookingServices | 1526 |
| QueueTickets | 139 |
| QueueTicketHistory | 176 |
| QueueBookingSettings | 1 |
| QueueTicketServices (table may exist) | 0 |
| Null BookingCode | 20 |
| Distinct BookingCode | 1479 |
| Duplicate BookingCode | 0 |
| Duplicate (TicketCode, QueueDate) | 0 |
| Cross-midnight bookings (`EndTime` time &lt; `StartTime` time) | 47 |
| Booking emp+date pairs | 236 |

### Status distributions (pre)

**Bookings:** confirmed 1195, cancelled 296, pending 5, arrived 1, completed 1, queued 1  

**Queue:** called 47, cancelled 35, done 34, waiting 20, in_service 3  

## Pre-migration BranchID

| Table | BranchID present |
|---|---|
| Bookings | no |
| QueueTickets | no |
| QueueBookingSettings | no |
| BookingServices / QueueTicketHistory / QueueTicketServices | no (children inherit via parent; no child BranchID this phase) |

## Uniqueness (pre → post)

| Constraint | Pre | Post (migration) |
|---|---|---|
| `UX_Bookings_BookingCode` | global unique on `BookingCode` (0 dups; 20 nulls) | **preserved** — do not weaken |
| `UQ_QueueTickets_Code_Date` | unique `(TicketCode, QueueDate)` | **dropped** |
| `UQ_QueueTickets_Branch_Date_Code` | — | unique `(BranchID, QueueDate, TicketCode)` |
| `UQ_QueueBookingSettings_BranchID` | — | unique `(BranchID)` — one settings row per branch |

## Change Tracking

No Change Tracking on Bookings, BookingServices, QueueTickets, QueueTicketHistory, or QueueBookingSettings (`changeTracking: []` in live schema audit). Phase 1F does not enable CT.

## Critical app dependencies

| Area | Pre-1F risk | Phase 1F treatment |
|---|---|---|
| Public booking APIs | Implicit single-salon | Require `branchCode` (except BookingCode lookup/cancel) |
| Settings cache | Process-global | Keyed by BranchID (`__pos_public_settings_cache_by_branch_v1`) |
| Ticket codes | Scoped by QueueDate only | Scoped by BranchID + QueueDate |
| Flow board | Would mix branches when second opens | Filter `BranchID` + return `activeBranch` |
| Convert → sale | Stamp active branch only | Require `Booking.BranchID = session BranchID` |
| Emp busy intervals | Emp-global (by design for multi-branch emp) | **Remain emp-global** — no BranchID filter |
| Schedule applock | `operations-schedule:{EmpID}:{operationalDate}` | Unchanged |
| Emp schedules / day-off / overrides | No BranchID | **Not in scope** |
| Service prices | Global catalog | No branch price overrides |
| WhatsApp | `WHATSAPP_DEFAULT_BRANCH_NAME` fallback | Pass persisted `branchName` when BranchID known |
| Calendar import | No active Google/Calendly path in POS | Document inactive / unsafe for second branch |
| Sync registry | Financial tables previously registered | Sync remains stopped; booking/queue CT absent |

## Explicit non-goals (frozen)

* Second branch creation / internal branch switcher  
* HR / payroll / attendance / ledger BranchID  
* Hybrid employee schedule/day-off per branch (candidate Phase 1G only if needed)  
* Enabling Change Tracking or sync for booking/queue tables  

## Classification

* **OWNED_ROOT:** Bookings, QueueTickets, QueueBookingSettings  
* **CHILD_INHERIT:** BookingServices, QueueTicketHistory, QueueTicketServices (via parent FK)  
* **EMP_GLOBAL_CONFLICT:** `buildBookingIntervals` / `buildQueueIntervals` / schedule lock  
* **DEFERRED:** schedules, day-off, overrides, HR, calendar import, second-branch seed ops  
