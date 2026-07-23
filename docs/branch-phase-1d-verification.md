# Phase 1D Verification

## Scripts

```bash
node scripts/audit-branches/08-capture-phase1d-financial-state.cjs before
npx tsx scripts/run-financial-branch-ownership-migration.ts --mode=cloud --expected-database=last132
npx tsx scripts/verify-financial-branch-ownership.ts --mode=cloud --expected-database=last132
```

## Expected checks

* All invoices/cash/recon BranchID = GLEEM (or day branch for recon)
* Invoice BusinessDayID non-null
* Cash BusinessDayID null only for documented legacy (**19** on last132 as of Phase 1E completion 2026-07-22; earlier docs said 17 then 18)
* No invoice/shift or sale-cash/invoice branch mismatches
* CT still enabled on Head + CashMove
* InsCashMoveSales enabled
* Pre/post fingerprints for amounts/counts/checksums match
* Unexpected BranchID columns = 0 beyond allowed set

## Sync

Keep sync **stopped** until local DB receives the same migration. Do not drop BranchID columns to satisfy legacy sync.
