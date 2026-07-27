# Booking Phase 6 — Create audit

**Scope:** Casher backend only. cutsaloon.com unchanged.  
**Date:** 2026-07-27 · **DB:** last132

## Pre-migration create (`POST .../create`)

| Step | Current implementation | TX-owned? | Lock-protected? | Canonical evaluator? | Branch-safe? | Overnight-safe? | Idempotent? | Side-effect timing | Required change |
|------|------------------------|-----------|-----------------|----------------------|--------------|-----------------|-------------|--------------------|-----------------|
| Branch resolve | `resolvePublicBranchCode` (single-public fallback) | No | No | No | Weak | n/a | No | n/a | Central Phase-1 context |
| Duration/price | `calculateServicePlanDuration` emp/system | No | No | No | n/a | n/a | No | n/a | Phase-2 catalog only |
| Precheck | `validateBookingSlot` outside TX | No | No | No | Partial | dayOffset→actualDate | No | n/a | `create_precheck` + under-lock revalidate |
| Customer | `upsertCustomer` **outside** TX | No | No | n/a | n/a | n/a | No | Before commit | Move into TX + normalize phone |
| Write guard | `assertEmployeeIntervalAvailable` SERIALIZABLE | Yes | Schedule applock | No | EmpID global busy | operationalDate from slot | No | n/a | Keep + interval applock + any-barber |
| Insert head/services | Same TX | Yes | Via prior lock | No | BranchID set | BookingDate=actualDate | Code retry | n/a | Snapshots from catalog; WorkDate meta |
| WhatsApp | `scheduleBookingWhatsAppAfterCommit` | After commit | n/a | n/a | n/a | n/a | No replay guard | After commit ✓ | Guard on idempotent replay |
| Cache | None | n/a | n/a | n/a | n/a | n/a | n/a | Missing | Invalidate Phase-4 caches |
| planToken | Unused | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Verify + never skip revalidation |
| Idempotency | None | n/a | n/a | n/a | n/a | n/a | **Missing** | n/a | Durable table |

## Explicit risks identified

| Risk | Status pre-Phase-6 |
|------|-------------------|
| Writes before final availability | Customer upsert before TX |
| Availability only outside TX | Precheck outside; guard inside (partial) |
| Branch-scoped busy only | Guard is global EmpID ✓ |
| Any-barber first-hit before TX | `validateBookingSlot` nearest pick outside TX |
| Missing idempotency | Confirmed |
| Notification before commit | No — after commit ✓ |
| Duplicate customer risk | Race on concurrent same phone |
| Booking-code collision | 3 retries + unique index |
| Partial service inserts | Rolled back with TX ✓ |
| Legacy duration/price fallbacks | Emp/system path |
| plan/create payload mismatch | Create ignores planToken |

## Compatibility

- Legacy body: `mode: nearest|specific`, optional `clientRequestId` / `Idempotency-Key`.
- Response upgraded to Phase-6 contract; keep 201 on success.
- `BookingDate` remains **calendar date of absolute start** (busy engine). WorkDate + dayOffset stored on idempotency row + optional booking columns / notes meta.
