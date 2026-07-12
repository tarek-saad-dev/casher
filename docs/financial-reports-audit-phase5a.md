# Financial Reports Audit Phase 5A

**Date:** 2026-07-12  
**Scope:** Read-only audit — no report logic, schema, or data changes.  
**Context:** New HR payroll flow posts entitlements to Employee Ledger; cash moves only for advances, payouts, and funding. Legacy daily post-to-cash may still exist in historical data.

---

## Executive Summary

Financial reporting in this codebase uses **three different revenue/expense semantics** that are not aligned:

| Source | Used by | What it measures |
|--------|---------|------------------|
| `TblinvServDetail` (invoice lines) | Employee services, Partners revenue, Monthly profit **revenue** | Real service sales |
| `TblCashMove` (all in/out) | Treasury daily, Monthly profit **net**, All-revenue page | Physical cash/treasury flows |
| `TblCashMove` filtered loosely | Expenses monthly, Partners operating expenses | Cash outflows by category |

**Main risk:** Several reports treat **all** `TblCashMove` income rows as business revenue and **all** expense outflows as operating expenses. That inflates P&L when rows are actually:

- Employee funding (`تمويل من موظف`) — treasury cash-in, **not** profit revenue
- Advance repayment — treasury cash-in, **not** profit revenue  
- Legacy payroll income mirror (`IsEmployeePayrollIncome=1`) — accounting artifact from old daily post-to-cash
- Employee payouts (`صرف مستحقات الموظفين`) — balance settlement, not operating cost
- Employee advances (`TxnKind=advance`) — balance movement, not rent/utilities/etc.
- Legacy payroll expense mirror (`IsPayrollDeduction=1`) — pairs with income mirror; net ~zero in treasury but gross-inflates category views

**Partial mitigation today:** Treasury `TreasurySummaryService` excludes employee funding from the **IncomeIncoming sub-KPI** only. Partners report excludes some payroll/advance categories from **operating** expenses via keyword heuristics. **No production report** uses `IsEmployeePayrollIncome` / `IsPayrollDeduction` flags or `classifyCashMove()`.

**Classification tooling exists but is audit-only:** `src/lib/accounting/cashMoveClassification.ts`, admin classification lab, and `GET /api/admin/audit/cash-move-classification`. Phase 5A adds `financialReportClassificationAudit.ts` + read-only script for month diagnostics.

---

## Current Revenue Sources

### 1. `/income-review/all-revenue` — كل الإيرادات

| Item | Detail |
|------|--------|
| **Page** | `src/app/income-review/all-revenue/page.tsx` |
| **API** | `GET /api/incomes?fromDate=&toDate=` |
| **Route** | `src/app/api/incomes/route.ts` |
| **SQL source** | `TblCashMove CM` JOIN `TblExpINCat` WHERE `CM.invType = N'ايرادات'` + date range |

| Question | Answer |
|----------|--------|
| Reads sales invoices? | **No** — only manual/other income CashMove rows |
| Reads TblCashMove? | **Yes** — all `invType=ايرادات` |
| Employee-named revenue categories? | **Yes** — any category including `TblExpCatEmpMap TxnKind=revenue` |
| Legacy payroll income mirror? | **Yes** — no filter on `IsEmployeePayrollIncome` |
| Employee funding / advance repayment? | **Yes** — included unless user filters by category |

**Risk:** KPI total income mixes real business income with funding, mirrors, and repayments.

---

### 2. `/reports/expenses/monthly` — تقرير المصروفات

| Item | Detail |
|------|--------|
| **Page** | `src/app/reports/expenses/monthly/page.tsx` |
| **API** | `GET /api/reports/expenses/monthly?year=&month=` |
| **Service** | `src/lib/services/monthlyExpensesReportService.ts` |
| **Advances tab API** | `GET /api/reports/expenses/employee-advances` |
| **SQL base** | `TblCashMove` WHERE `invType=مصروفات AND inOut=out` + calendar month |

| Question | Answer |
|----------|--------|
| Reads TblCashMove out? | **Yes** |
| Employee advances? | **Yes** — in total + separate advances tab via `TxnKind=advance` |
| Employee payouts? | **Yes** — if categorized under `صرف مستحقات الموظفين` |
| Old daily payroll expense? | **Yes** — `يوميات الموظفين` + `IsPayrollDeduction=1` rows |
| Operating expenses? | **Mixed** — all outflows in one total |

**Risk:** `totalExpenses` is not operating-only; advances and payouts inflate expense KPIs.

---

### 3. `/treasury/daily` — الخزنة اليومية

| Item | Detail |
|------|--------|
| **Page** | `src/app/treasury/daily/page.tsx` → `TreasuryDailyView.tsx` |
| **APIs** | `GET /api/treasury/daily-summary`, `GET /api/treasury/movements`, `GET /api/treasury/current` |
| **Service** | `src/lib/services/TreasurySummaryService.ts` |

| Question | Answer |
|----------|--------|
| Reads TblCashMove? | **Yes** — authoritative for in/out/net |
| Sales vs income split? | **Partial** — `SalesIncoming` vs `IncomeIncoming` |
| Employee funding excluded? | **Partial** — only from `IncomeIncoming` sub-total, not from total inflow/net |
| Legacy mirrors? | **Included** in totals |
| Employee payouts/advances? | **Included** in outflow |

**Risk:** Correct for **treasury balance**; misleading if interpreted as **P&L**.

---

### 4. `/admin/reports/partners` — تقرير الشركاء

| Item | Detail |
|------|--------|
| **Page** | `src/app/admin/reports/partners/page.tsx` |
| **API** | `GET /api/admin/reports/partners?year=&month=` |
| **Service** | `src/lib/services/partnersReportService.ts` |
| **Expense drill-down** | `GET /api/admin/reports/partners/expense-category-details` |

| Question | Answer |
|----------|--------|
| Revenue from invoices? | **Yes** — `TblinvServDetail` / `employeeServicesRevenue` |
| Revenue from TblCashMove? | **No** for partner revenue total |
| Expenses from TblCashMove? | **Yes** — via `getMonthlyExpensesByCategory` |
| Operating filter? | **Yes** — `filterOperatingExpenseCategories()` excludes سلف, يوميات+موظف, transfers, etc. |
| Advances handling? | Subtracted separately in `operatingNet`; raw expense total still includes them |

**Risk:** Lower than all-revenue; **operatingNet** is best current P&L-like view. Payouts may still appear in operating expenses if category name doesn't match heuristics.

---

### 5. `/admin/reports/employee-services` — خدمات الموظفين

| Item | Detail |
|------|--------|
| **Page** | `src/app/admin/reports/employee-services/page.tsx` |
| **API** | `GET /api/reports/employee-services?fromDate=&toDate=` |
| **Service** | `src/lib/reports/employeeServicesReportService.ts`, `employeeServicesRevenue.ts` |
| **SQL** | `TblinvServDetail` + `TblinvServHead` WHERE `invType=مبيعات` |

| Question | Answer |
|----------|--------|
| Reads TblCashMove? | **No** |
| Legacy mirrors? | **No** |
| Employee ledger inflation? | **Low direct risk** — invoice-based only |

**Risk:** Cross-report mismatch when compared to all-revenue CashMove totals.

---

### 6. `/reports/monthly` — التقرير الشهري / net profit

| Item | Detail |
|------|--------|
| **Page** | `src/app/reports/monthly/page.tsx` |
| **API** | `GET /api/reports/monthly?year=&month=` |
| **Route** | `src/app/api/reports/monthly/route.ts` |

| Field | Source |
|-------|--------|
| `totalRevenue` | `getAllEmployeesRevenueTotal()` → invoice lines |
| `netProfit` | `TreasurySummaryService.getMonthlyFinancialSummary()` → CashMove in − out |
| `totalExpenses` | **Derived:** `revenue - netProfit` (not from expenses report) |

**Risk:** **Highest conceptual risk.** Revenue and net profit come from different domains; derived expenses are a residual, not auditable operating expenses. Legacy mirrors net to ~zero in treasury but distort interpretation of each side.

---

### 7. `/admin/reports/employee-monthly-work-revenue`

| Item | Detail |
|------|--------|
| **API** | `GET /api/admin/reports/employee-monthly-work-revenue` |
| **Sources** | Attendance + invoice revenue per employee |
| **TblCashMove** | **Not used** |

---

## Current Expense Sources

(Summary table — see per-report sections above.)

| Report | CashMove out | Advances | Payouts | Legacy payroll expense | Operating |
|--------|-------------|----------|---------|------------------------|-----------|
| Expenses monthly | All | Yes | Yes | Yes | Mixed |
| Treasury daily | All | Yes | Yes | Yes | N/A (flow) |
| Partners | Filtered subset | Separate KPI | Maybe | Excluded by keyword | Filtered |
| Monthly profit | Via derived residual | Indirect | Indirect | Indirect | Not explicit |

---

## Category / Mapping Audit

### Tables

- **`TblExpINCat`** — category name, `ExpINType` (`ايرادات` / `مصروفات`)
- **`TblExpCatEmpMap`** — links `EmpID ↔ ExpINID` with `TxnKind`: `advance` | `revenue` | `deduction`

### Known system categories (constants in code)

| Category name | ExpINType | TxnKind | Real revenue? | Operating expense? | Ledger-related |
|---------------|-----------|---------|---------------|-------------------|----------------|
| `تمويل من موظف` | ايرادات | — | **No** — non-revenue cash-in | — | `employee_funding` |
| `صرف مستحقات الموظفين` | مصروفات | — | — | **No** — payout settlement | `payout` |
| `يوميات الموظفين` | مصروفات | — | — | **No** — legacy payroll | legacy mirror pair |
| `سلف(...)` per employee | مصروفات | `advance` | — | **No** — advance out | `advance` |
| Per-employee revenue cats | ايرادات | `revenue` | **No** — legacy mirror target | — | legacy income mirror |
| Advance repayment (name varies) | ايرادات | — | **No** | — | `advance_repayment` |

Run live category audit:

```bash
node scripts/audit-financial-report-classification.js --month=2026-07
```

---

## Classification Proposal (Phase 5B — not implemented)

### Revenue classes

| Class | Description | Include in profit revenue? |
|-------|-------------|---------------------------|
| `sales_revenue` | POS / invoice sales (`invType=مبيعات`) | **Yes** |
| `other_business_income` | Legitimate non-sales income | **Yes** |
| `non_revenue_cash_in` | Funding, repayments, transfers | **No** — treasury only |
| `legacy_employee_income_mirror` | `IsEmployeePayrollIncome` or mapped revenue cats | **No** — legacy adjustment |

### Expense classes

| Class | Description | Include in operating expense? |
|-------|-------------|------------------------------|
| `operating_expense` | Rent, utilities, supplies, etc. | **Yes** |
| `employee_advance` | Salf / `TxnKind=advance` | **No** — separate HR line |
| `employee_payout` | `صرف مستحقات الموظفين` | **No** — balance settlement |
| `legacy_payroll_expense` | `IsPayrollDeduction`, daily payroll post | **No** — legacy adjustment |
| `non_expense_cash_out` | Internal transfers | **No** |

### Employee ledger cash classes

| Class | Maps to |
|-------|---------|
| `advance` | Ledger debit `advance` |
| `payout` | Ledger debit `payout` |
| `employee_funding` | Ledger credit `employee_funding` |
| `advance_repayment` | Cash-in reducing advance liability |

**Helper location (Phase 5A audit only):** `src/lib/accounting/financialReportClassificationAudit.ts`

---

## Impacted Reports

### `/income-review/all-revenue`

| | |
|-|-|
| **Wrong/risky** | Totals include funding, mirrors, repayments as "إيراد" |
| **Should include** | `other_business_income` only |
| **Should exclude** | Funding, mirrors, repayments, transfers |
| **Show separately** | Non-revenue cash-in section |

### `/reports/expenses/monthly`

| | |
|-|-|
| **Wrong/risky** | Single total mixes operating + advances + payouts + legacy payroll |
| **Should include** | Operating expenses |
| **Should exclude** | Advances, payouts, legacy payroll mirrors, transfers |
| **Show separately** | HR settlement section (already partial via advances tab) |

### `/treasury/daily`

| | |
|-|-|
| **Wrong/risky** | None for treasury purpose — risk is **misuse as P&L** |
| **Should include** | All cash flows |
| **Should exclude** | N/A |
| **Show separately** | Optional P&L-safe subtotals (extend funding exclusion) |

### `/admin/reports/partners`

| | |
|-|-|
| **Wrong/risky** | Payout categories may slip into operating; advance math confusing |
| **Should include** | Invoice revenue − operating expenses − advances (current intent) |
| **Should exclude** | Mirrors, funding, payouts from operating |
| **Show separately** | Payouts if tracked via CashMove |

### `/admin/reports/employee-services`

| | |
|-|-|
| **Wrong/risky** | Minimal — invoice-based |
| **Should include** | Service line revenue |
| **Should exclude** | CashMove entirely |

### `/reports/monthly`

| | |
|-|-|
| **Wrong/risky** | Revenue from invoices vs net from treasury; derived expenses |
| **Should include** | Aligned revenue and expense from same semantic layer |
| **Should exclude** | Legacy mirrors from both sides of P&L |
| **Show separately** | Treasury net vs operating profit |

---

## Suggested Phase 5B Implementation Plan

**Do not implement in 5A.** Proposal only:

### Helpers (new / extend)

| Helper | Purpose |
|--------|---------|
| `classifyCashMoveForReport()` | Wrap `classifyCashMove()` + Phase 5A buckets for report filters |
| `getOperatingRevenueTotal(month)` | Invoice + classified other income |
| `getOperatingExpenseTotal(month)` | CashMove out minus advance/payout/legacy |
| `getTreasuryFlowSummary(month)` | Unchanged total in/out |
| `getLegacyPayrollMirrorTotals(month)` | Sum `IsEmployeePayrollIncome` + `IsPayrollDeduction` |
| `getEmployeeLedgerCashSummary(month)` | Funding, payout, advance, repayment totals |

### API changes

- Add `?pnlView=operating|treasury|legacy` to monthly/treasury summary endpoints
- Extend `/api/reports/monthly` to return breakdown object alongside legacy fields (backward compatible)
- Add `GET /api/reports/financial-classification-summary?month=` for admin

### UI changes

- All-revenue: badge per row from classification; filter chips
- Expenses monthly: split KPI cards (operating vs HR settlements)
- Monthly profit: show operating profit vs treasury net side-by-side
- Partners: explicit payout line if detected

### Migration / compatibility

- **No data migration required** — classification is query-time
- Keep existing totals as `treasuryView` for backward compatibility
- Feature flag: `FINANCIAL_REPORTS_CLASSIFIED_VIEW=true`

### Tests needed

- Classification unit tests (started in Phase 5A)
- Snapshot tests per report API with fixture CashMove rows
- Regression: partners `operatingNet` unchanged when no legacy rows
- Manual QA script output vs report pages for same month

---

## Quick SQL Diagnostics

**Script:** `scripts/audit-financial-report-classification.js`

```bash
node scripts/audit-financial-report-classification.js --month=2026-07
```

**Output sections:**

1. Month TblCashMove totals (in, out, sales, legacy flags)
2. Classification guess buckets
3. Suspicious employee-mapped revenue categories
4. Employee-related category registry
5. Legacy payroll mirror row sample

**Read-only guard:** `READ_ONLY_FINANCIAL_AUDIT_GUARD` in `financialReportClassificationAudit.ts`

---

## Related existing audit tools

| Tool | Path |
|------|------|
| Cash move classification audit | `GET /api/admin/audit/cash-move-classification` |
| Classification heuristics | `src/lib/accounting/cashMoveClassification.ts` |
| Employee ledger reconciliation | `/admin/hr?tab=employee-ledger-reconciliation` |
| Daily payroll HR audit | `scripts/audit-daily-payroll-hr-model.js` |

---

## Files inspected (Phase 5A)

- `src/app/income-review/all-revenue/page.tsx`
- `src/app/api/incomes/route.ts`
- `src/app/reports/expenses/monthly/page.tsx`
- `src/app/api/reports/expenses/monthly/route.ts`
- `src/lib/services/monthlyExpensesReportService.ts`
- `src/app/api/reports/expenses/employee-advances/route.ts`
- `src/app/treasury/daily/page.tsx`
- `src/components/treasury/TreasuryDailyView.tsx`
- `src/app/api/treasury/daily-summary/route.ts`
- `src/lib/services/TreasurySummaryService.ts`
- `src/app/admin/reports/partners/page.tsx`
- `src/lib/services/partnersReportService.ts`
- `src/lib/reports/partnersExpenseCategories.ts`
- `src/app/admin/reports/employee-services/page.tsx`
- `src/app/api/reports/employee-services/route.ts`
- `src/app/reports/monthly/page.tsx`
- `src/app/api/reports/monthly/route.ts`
- `src/lib/accounting/cashMoveClassification.ts`
- `src/lib/services/employeeLedgerFundingService.ts`
- `src/lib/services/employeeLedgerPayoutService.ts`
- `src/app/api/payroll/daily/post-to-cash/route.ts`

**Explicitly not modified in Phase 5A.**
