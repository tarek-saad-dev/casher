# Phase 1E Verification

```bash
node scripts/audit-branches/09a-phase1e-legacy-null-day-preflight.cjs
npx tsx scripts/run-branch-partner-shares-migration.ts --mode=cloud --expected-database=last132
npx tsx scripts/verify-branch-financial-reporting.ts --mode=cloud --expected-database=last132
npx vitest run src/lib/__tests__/phase1e*.test.ts src/lib/__tests__/monthlyFinancialEquations.test.ts src/lib/__tests__/partnersReport.test.ts
```

Expected: partner shares sum 100%, no overlaps, GLEEM day/month fingerprints stable, legacy null-day cash included by BranchID (authoritative live count documented in Phase 1D backfill note — currently **19**).
