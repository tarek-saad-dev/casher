# Phase 1F Verification

## Commands

```bash
# Pre-capture (also invoked by runner)
node scripts/audit-branches/10-capture-phase1f-booking-queue-state.cjs before

# Migration (maintenance window; writers paused)
npx tsx scripts/run-booking-queue-branch-ownership-migration.ts --mode=cloud --expected-database=last132 --confirm-maintenance

# Verifier (also invoked by runner after post-capture)
npx tsx scripts/verify-booking-queue-branch-ownership.ts --mode=cloud --expected-database=last132

# Unit / source contracts
npx vitest run src/lib/__tests__/phase1fBookingQueueOwnership.test.ts
```

Capture outputs:

* `scripts/audit-branches/_phase1f-booking-queue-before.json` — **present** (2026-07-23)  
* `scripts/audit-branches/_phase1f-booking-queue-after.json` — **pending migration run**

## Expected verifier checks

* Bookings/Queue/Settings: 0 null BranchID; 0 non-GLEEM (single founding branch)  
* 0 BookingCode duplicates; 0 orphan BookingServices / QueueTicketHistory  
* 0 duplicate `(BranchID, QueueDate, TicketCode)`  
* `UQ_QueueTickets_Branch_Date_Code` present; old `UQ_QueueTickets_Code_Date` absent  
* `UX_Bookings_BookingCode` present  
* FKs on Bookings / QueueTickets / QueueBookingSettings BranchID  
* 0 booking↔converted-sale BranchID mismatches  
* 0 forbidden HR BranchID columns (attendance/payroll/target/ledger/budget)  
* Source: public branches route, settings cache key, queueTicketCode branch scope, flow-board filter + `activeBranch`  
* Fingerprint keys match before/after when both captures exist (counts/checksums/estimate wait/cross-midnight/dup codes)

## Sync / CT

No CT on booking/queue tables (pre and post). Keep **sync stopped and unused**.
