# Phase 1L — Verification

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Scope:** Employee financial BranchID migration + branch accounts + payroll/ledger/target contracts

---

## 1. Live database verification

**Pre-capture:** `scripts/audit-branches/_phase1l-employee-financial-before.json` (2026-07-24T09:19:21Z)

| Check | Result |
|---|---|
| Expected database | `last132` |
| GLEEM | `BranchID=1`, **IsActive=true** |
| PH1GTEST | `BranchID=2`, **IsActive=false** |
| Pre BranchID on financial tables | **false** → **true** post |
| Payroll rows / wageSum | **606** / **147999.66** |
| Ledger rows / balance | **517** / **21034.33** |
| Targets / targetSum | **97** / **30833.6** |
| Recalc / plans / salaryHist | **49** / **5** / **36** |
| Cash-linked ledger | **281** |
| Second branch activated | **No** |
| Sync service | **Stopped** |

**Post-migration expected:**

| Check | Result |
|---|---|
| BranchID NOT NULL + FK on payroll/ledger/targets/recalc/target plan | ✓ |
| `TblEmpBranchPayrollPlan` seeded GLEEM only | ✓ |
| Uniques Emp+Branch+WorkDate / Emp+Branch+EffectiveFrom | ✓ |
| Views `vw_EmpAttendancePayrollBranchDay`, `vw_EmpLedgerBranchBalance`, `vw_EmpLedgerGlobalBalance` | ✓ |
| PH1GTEST financial rows | **0** |
| CashMove/ledger mismatch | **0** |

Do **not** invent additional live smoke metrics beyond this fingerprint.

---

## 2. Schema contract checks

Migration file must contain:

| Artifact | Present |
|---|---|
| DB name / GLEEM active / PH1GTEST inactive guards | ✓ |
| `TblEmpBranchPayrollPlan` + GLEEM seed | ✓ |
| BranchID add → backfill → FK → NOT NULL | ✓ |
| Unique reshape payroll / targets / recalc / target plan | ✓ |
| Branch-day attendance + ledger balance views | ✓ |
| PH1GTEST financial guard + CashMove mismatch abort | ✓ |

---

## 3. Application contract checks

| Requirement | Verified by | Status |
|---|---|---|
| Hourly generate requires branchId + branch-day view | `dailyPayrollGenerateCore.ts` | ✓ core |
| Aggregate loader branch-day | `attendancePayrollAggregate.ts` | ✓ |
| Dual-write stamps BranchID; CashMove for advances | `employeeLedgerDualWrite.ts` | ✓ |
| Payout uses branch balance, not global | `employeeLedgerPayoutService.ts` | ✓ |
| Global balance read-only view | `employeeLedgerService.ts` / SQL views | ✓ |
| Generate / auto-generate / nightly pass branchId | API + `nightly-close.service.ts` | **Gap** |
| Targets / monthly salary BranchID writes | employee-target + monthly salary services | **Gap** |
| Registry `payroll_ledger_targets.goLiveBlocker` | `domainOwnershipRegistry.ts` | **Still true** |
| Verifier script | `scripts/verify-employee-financial-branch-ownership.ts` | **Missing** |
| After fingerprint script | `scripts/audit-branches/20-phase1l-employee-financial-after.cjs` | **Missing** |
| Unit tests `phase1lEmployeeFinancialBranchOwnership.test.ts` | `src/lib/__tests__/` | **Missing** |

---

## 4. Scripts

```bash
node scripts/audit-branches/19-phase1l-employee-financial-before.cjs
node scripts/audit-branches/run-phase1l-migration.cjs
# Planned:
# node scripts/audit-branches/20-phase1l-employee-financial-after.cjs
# npx tsx scripts/verify-employee-financial-branch-ownership.ts --mode=cloud --expected-database=last132 --with-phase1k --with-phase1j --with-phase1i --with-phase1h --with-phase1g
```

---

## 5. What Phase 1L did **not** verify (yet)

| Item | Reason |
|---|---|
| Live multi-branch payroll/target generation | No second active branch; nightly/API gaps |
| Monthly salary branch posting | Service not updated |
| Target revenue filtered by invoice BranchID | Sales query still Emp/date |
| Full vitest Phase 1L suite | Test file not created |
| Nested prior-phase verifier chain | Verifier not created |
| Production branch #2 smoke | Explicit NO-GO |

---

## 6. Verification artifacts

| Artifact | Path |
|---|---|
| Pre-migration JSON | `scripts/audit-branches/_phase1l-employee-financial-before.json` |
| Probe (pre schema) | `scripts/audit-branches/_phase1l-probe.json` |
| Pre-capture script | `scripts/audit-branches/19-phase1l-employee-financial-before.cjs` |
| Migration SQL | `db/migrations/add-employee-financial-branch-ownership.sql` |
| Migration runner | `scripts/audit-branches/run-phase1l-migration.cjs` |
| Payroll core | `src/lib/payroll/dailyPayrollGenerateCore.ts` |
| Ledger dual-write / payout | `src/lib/services/employeeLedger*.ts` |

---

## 7. Acceptance criteria

- [x] Live DB facts captured on `last132`  
- [x] Migration applied; BranchID NOT NULL; uniques reshaped; views created  
- [x] No PH1GTEST employee-financial ownership  
- [x] CashMove/ledger mismatch abort path present  
- [x] Branch account model + GLEEM plan seed  
- [x] Hourly generate core + payout branch balance paths  
- [ ] Nightly / API generate iterate or pass branchId  
- [ ] Targets + monthly salary app ownership complete  
- [ ] Registry blocker cleared  
- [ ] Verifier + after fingerprint + Phase 1L tests green  
- [x] Sync still stopped; no second branch activated  

Schema cutover is **accepted**. Full Phase 1L application closure remains **conditional** on the open checklist above.
