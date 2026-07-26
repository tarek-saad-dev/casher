# Phase 1L — Verification

**Date:** 2026-07-25  
**Database:** cloud / `last132`

## Commands run

```bash
npx vitest run \
  src/lib/__tests__/phase1lEmployeeFinancialBranchOwnership.test.ts \
  src/lib/__tests__/phase1kAttendanceBranchOwnership.test.ts \
  src/lib/__tests__/phase1jBranchInventory.test.ts \
  src/lib/__tests__/phase1iMultibranchBoundaries.test.ts \
  src/lib/__tests__/phase1hBranchSwitcher.test.ts \
  src/lib/__tests__/phase1gSecondBranchReadiness.test.ts \
  src/lib/__tests__/phase1fBookingQueueOwnership.test.ts \
  src/lib/__tests__/phase1bSession.test.ts \
  src/lib/__tests__/phase1dFinancialOwnership.test.ts \
  src/lib/__tests__/phase1eReportScope.test.ts \
  src/lib/__tests__/employeeLedgerMonthlySalary.test.ts

node scripts/audit-branches/20-phase1l-employee-financial-after.cjs

npx tsx scripts/verify-employee-financial-branch-ownership.ts \
  --mode=cloud \
  --expected-database=last132 \
  --with-phase1k --with-phase1j --with-phase1i --with-phase1h --with-phase1g

npm run build
```

## Results

| Check | Result |
|---|---|
| Vitest | **11 files / 143 tests passed** (Phase 1L alone: **12 tests**) |
| After fingerprint | **PASS** — nulls 0, PH1GTEST 0, cash mismatch 0, branch=global 23209.04 |
| Verifier + nested 1K→1G | **PASS** |
| Build | **PASS** |
| ESLint (touched) | **0 errors / 0 warnings** |

Agree with `docs/branch-phase-1l-closure.md` and `docs/branch-phase-1l-final-application-audit.md`.
