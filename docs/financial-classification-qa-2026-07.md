# Financial Classification QA — July 2026

## Environment
- FINANCIAL_REPORT_CLASSIFICATION_ENABLED: `true`
- isFinancialReportClassificationEnabled(): **true**
- date/time: 2026-07-12T01:50:23.169Z
- script command: `node scripts/qa-financial-classification-enabled.js --month=2026-07`
- mode: **READ ONLY** (SELECT only; no TblCashMove / TblEmpLedgerEntry writes)
- restart note: If the Next.js dev server was already running before the flag was set, **restart it** so API routes load `FINANCIAL_REPORT_CLASSIFICATION_ENABLED=true`.

## Summary
- Result: **WARN**
- recommendation: `READY_FOR_CLASSIFIED_REPORTS=true`
- Failures: 0
- Warnings: 1

## Legacy vs Classified Totals

| Metric | Amount |
|--------|--------|
| legacyRevenue (cash in) | 103,572.00 |
| legacyExpenses (cash out) | 72,720.00 |
| legacyNet | 30,852.00 |
| invoiceSalesRevenue (services / partners source) | 73,830.00 |
| cleanNetProfit (cash-move sales base) | 31,908.07 |
| cleanNetProfit (partners override) | 34,142.07 |
| difference (partners clean − legacyNet) | 3,290.07 |
| difference % | 10.66% |

## Classified Breakdown

| Bucket | Amount |
|--------|--------|
| salesRevenue | 71,596.00 |
| otherBusinessIncome | 270.00 |
| nonRevenueCashIn | 24,246.00 |
| legacyEmployeeIncomeMirror | 7,460.00 |
| operatingExpense | 16,250.00 |
| employeeAdvances | 31,854.00 |
| employeePayouts | 200.00 |
| payrollExpenseFromLedger | 23,707.93 |
| legacyPayrollExpense | 0.00 |
| internalTransfers | 24,416.00 |
| uncategorizedCashIn | 0.00 |
| uncategorizedCashOut | 0.00 |
| cashInTotal | 103,572.00 |
| cashOutTotal | 72,720.00 |
| cleanNetProfit | 31,908.07 |

### Phase 5A audit alignment (cash buckets)

| Audit bucket | Audit amount | Classified amount |
|--------------|--------------|-------------------|
| sales_revenue | 71,596.00 | 71,596.00 |
| other_business_income | 270.00 | 270.00 |
| non_revenue_cash_in | 24,246.00 | 24,246.00 |
| legacy_employee_income_mirror | 7,460.00 | 7,460.00 |
| operating_expense | 16,250.00 | 16,250.00 |
| employee_advance | 31,854.00 | 31,854.00 |
| employee_payout | 200.00 | 200.00 |
| legacy_payroll_expense | 0.00 | 0.00 |

Ledger payroll credits: hourly=14,707.93, monthly=9,000.00, total=23,707.93, salaryCreditsExist=true.

## Partner Split Comparison

Base old = legacyNet (30,852.00)  
Base clean = partners cleanNetProfit (34,142.07)  
Shares: Zeyad 36.6666666667%, Mohamed Hamdy 31.6666666667%, Ali Elziny 31.6666666667%

| Partner | Old Split | Clean Split | Difference |
|---------|-----------|-------------|------------|
| Zeyad (زياد) | 11,312.40 | 12,518.76 | 1,206.36 |
| Mohamed Hamdy (محمد حمدي) | 9,769.80 | 10,811.66 | 1,041.86 |
| Ali Elziny (علي الزيني) | 9,769.80 | 10,811.66 | 1,041.86 |

## Checks

| Check | Status | Detail |
|-------|--------|--------|
| flag_enabled | PASS | isFinancialReportClassificationEnabled() = true |
| classified_totals_present | PASS | classifiedTotals built from Phase 5B helpers |
| legacy_totals_present | PASS | legacyRevenue=103,572.00, legacyExpenses=72,720.00, legacyNet=30,852.00 |
| clean_net_formula | PASS | cleanNetProfit=31,908.07 matches formula |
| payroll_from_ledger | PASS | payrollExpenseFromLedger=23,707.93 (entries=68) |
| non_revenue_excluded | PASS | nonRevenueCashIn=24,246.00 not in cleanNetProfit formula |
| advances_excluded | PASS | employeeAdvances=31,854.00 not subtracted in cleanNetProfit formula |
| payouts_excluded | PASS | employeePayouts=200.00 not subtracted in cleanNetProfit formula |
| mirror_not_real_revenue | PASS | legacyEmployeeIncomeMirror=7,460.00; real revenue uses sales+otherBusiness only |
| partners_use_clean_net | PASS | Partner split base = partnersClassified.cleanNetProfit=34,142.07 (invoice sales override) |
| no_writes | PASS | All 4 queries were SELECT-only; no TblCashMove/TblEmpLedgerEntry writes |
| legacy_mirror_warn | WARN | legacyEmployeeIncomeMirror=7,460.00 |

## Warnings
- **legacy_mirror_warn**: legacyEmployeeIncomeMirror=7,460.00



## Endpoint Checks

| Endpoint | Status | HTTP | classificationEnabled | classifiedTotals | Notes |
|----------|--------|------|-----------------------|------------------|-------|
| `/api/reports/monthly?year=2026&month=7` | SKIPPED | 401 | — | — | SKIPPED: requires auth/session |
| `/api/admin/reports/partners?year=2026&month=7` | SKIPPED | 401 | — | — | SKIPPED: requires auth/session |
| `/api/reports/expenses/monthly?year=2026&month=7` | SKIPPED | 401 | — | — | SKIPPED: requires auth/session |
| `/api/incomes?fromDate=2026-07-01&toDate=2026-07-31` | SKIPPED | 401 | — | — | SKIPPED: requires auth/session |
| `/api/treasury/daily-summary?dateFrom=2026-07-01&dateTo=2026-07-31` | SKIPPED | 401 | — | — | SKIPPED: requires auth/session |

## Final Recommendation

**Classification can be used behind the feature flag for review**, but review warnings (uncategorized rows, legacy mirrors/payroll, large clean vs legacy delta) before treating classified totals as the sole production truth.

`READY_FOR_CLASSIFIED_REPORTS=true`

---
*Generated by `scripts/qa-financial-classification-enabled-runner.ts` — read-only QA, no data mutations.*
