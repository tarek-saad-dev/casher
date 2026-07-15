# Employee Daily Target — Source Audit (Phase 0)

**Date:** 2026-07-15  
**Scope:** Phase 0 audit + Phase 1 foundation planning only. No UI, no ledger writes, no generation API.

---

## 1. Official sales source (locked decision)

**Canonical UI / API:** `/admin/reports/employee-services` → `GET /api/reports/employee-services`

**Metric used for daily target `NetSalesAfterDiscount`:**  
`actualInvoiceRevenue` (صافي مبيعات الخدمات بعد خصم البنود + حصة فاتورة الموظف من خصم الرأس).

This is the emerald “صافي بعد خصم الفاتورة” column in the report, produced by `allocateEmployeeInvoiceRevenue()`.

**Not used for daily target (different product formulas):**
| Source | Formula | Why excluded |
|--------|---------|--------------|
| Line-only `getEmployeeRevenueByDate` | `SValue − DisVal` | Ignores header-level invoice discount allocation |
| `sp_GetMonthlyPayroll` SalesAgg | `SUM(SValue)` (no DisVal) + broader invTypes/categories | Legacy monthly commission; will remain untouched |
| `/api/sales/today` rankings | `SUM(SPriceAfterDis)` | Parallel, not the employee-services report |

---

## 2. Exact formulas

### 2.1 Line gross (before header allocation)

```sql
CASE
  WHEN ISNULL(d.SValue, 0) > 0
    THEN ISNULL(d.SValue, 0) - ISNULL(d.DisVal, 0)
  ELSE (ISNULL(d.Qty, 1) * ISNULL(d.SPrice, 0)) - ISNULL(d.DisVal, 0)
END
```

JS twin: `calculateServiceLineTotal()` in `src/lib/services/employeeServiceBreakdown.ts`.  
Does **not** read `SPriceAfterDis` column (though when `SValue > 0` it equals `SValue − DisVal`).

### 2.2 Actual after invoice discount (official)

Per invoice (`invType = N'مبيعات'`):

```
eligibleGross = Σ lineGross for lines with EmpID IS NOT NULL AND ProID IS NOT NULL
employeePool  = GrandTotal × (eligibleGross / SubTotal)
perLineActual = distributeProportionally(weights=lineGross → employeePool)
```

Piaster remainder → largest weight, then highest `detailId`.  
Per employee: `actualInvoiceRevenue = Σ perLineActual`.

Implemented in `src/lib/services/employeeInvoiceAllocation.ts`.

---

## 3. Tables & columns

| Table | Columns used |
|-------|----------------|
| `dbo.TblinvServDetail` | `ID`, `invID`, `invType`, `EmpID`, `ProID`, `Qty`, `SPrice`, `SValue`, `DisVal` |
| `dbo.TblinvServHead` | `invID`, `invType`, `invDate`, `SubTotal`, `GrandTotal`, `DisVal` |
| `dbo.TblEmp` | `EmpID`, `EmpName` (lookup) |

**Filters (BASE):**
- `CAST(h.invDate AS date)` in range  
- `h.invType = N'مبيعات'` only  
- `d.EmpID IS NOT NULL AND d.ProID IS NOT NULL`

**Business date:** `h.invDate` (CAST to date). Inclusive–inclusive in employee-services API.

---

## 4. Cancelled invoices

**None excluded.**  
`TblinvServHead.isActive` exists but is **deliberately unused** — real sales rows often have `isActive='no'`. Filtering would empty the report (`_meta.isActiveFilterApplied: false`).

**Risk:** voided/bad invoices that remain `مبيعات` still count. Phase 1 inherits this (parity with report). Future cancel mechanism must not invent a new filter without changing the report too.

---

## 5. Returns

**Not subtracted.**  
Returns as other invTypes (`مرتجع` / `إرجاع`) are outside `invType = N'مبيعات'`. Daily target will match the report (no return netting).

---

## 6. Multi-employee invoices

Each line keeps its `d.EmpID`.  
Header discount is shared: each employee’s pool share is proportional to their eligible line gross within the invoice.  
Lines missing EmpID/ProID and product/tax residue → `unattributedInvoiceRevenue` (not attributed to any employee).

---

## 7. Legacy monthly target (current)

| Piece | Location |
|-------|----------|
| Config columns | `TblEmp.TargetMinSales`, `TblEmp.TargetCommissionPercent` |
| Profile edit | `PATCH /api/employees/[id]`, `PATCH /api/admin/employees/[id]/profile` |
| Calculation | `dbo.sp_GetMonthlyPayroll` in `sql/payroll-migration.sql` |
| Formula | `IF MonthlyWorkTotal >= TargetMinSales THEN MonthlyWorkTotal × TargetCommissionPercent / 100 ELSE 0` |
| Sales in SP | `SUM(SValue)` with category/`مبيعات بالكارت` rules — **differs from employee-services** |

Daily payroll (`dailyPayrollGenerateCore`, `/api/payroll/daily*`) does **not** compute sales targets.

---

## 8. `TblEmpLedgerEntry`

Exists with `EntryReason` including `N'target'` (credit bucket `EMP_LEDGER_TARGET_CREDIT_REASONS`).  
**No production write path inserts `EntryReason='target'` today.** Phase 1 must **not** write ledger entries.

Unique active index: `(RefType, RefID, EntryReason) WHERE IsVoided=0`.

---

## 9. Risks of sharing employee-services sales

1. Three “sales” definitions coexist (line net / actual / SP SValue). Using the wrong one breaks trust.  
2. No cancel / return filters (inherited consciously for parity).  
3. Allocation rounding is JS `Math.round` to 2dp — shared core must call the same functions.  
4. Date range conventions differ across helpers (inclusive vs exclusive) — daily core must use inclusive single-day `[workDate, workDate]`.  
5. Old monthly threshold target remains live until a later phase — no dual meaning in UI yet.

---

## 10. Decisions locked for Phase 1

1. **NetSalesAfterDiscount = actualInvoiceRevenue** for the work date (employee-services parity).  
2. Extract thin shared loader that uses the same SQL filters + `allocateEmployeeInvoiceRevenue`; **do not change** `GET /api/reports/employee-services` response.  
3. Progressive marginal tiers on daily net sales; round **only final** `targetAmount` to 2dp.  
4. `ConversionDays` converts monthly input → `DailyStartAmount` only; attendance-independent.  
5. Tables only — no generate API, no HR UI, no ledger/cash writes.  
6. Use `decimal.js` for engine math (added dependency).  
7. Reject invalid tiers (duplicate starts, unordered, rate out of `[0,100]`, negative sales input).

---

## 11. Phase 1 file plan

| Action | Path |
|--------|------|
| Create | `docs/employee-daily-target-source-audit.md` (this file) |
| Create | `db/migrations/create-employee-daily-target-system.sql` |
| Create | `src/lib/payroll/employee-target/target.types.ts` |
| Create | `src/lib/payroll/employee-target/target.validation.ts` |
| Create | `src/lib/payroll/employee-target/calculate-daily-target.ts` |
| Create | `src/lib/payroll/employee-target/employee-target-sales-service.ts` |
| Create | `src/lib/payroll/employee-target/index.ts` |
| Create | `src/lib/__tests__/employeeDailyTarget.test.ts` |
| Create | `scripts/audit-employee-target-sales-parity.mjs` |
| Update | `package.json` (+ `decimal.js`) |

**Explicitly unchanged in Phase 1:**  
`page.tsx` HR, `DailyPayrollPanel`, daily payroll generate, ledger dual-write, `sp_GetMonthlyPayroll`, profile Target* fields, employee-services report route behavior.

---

## 12. Actual query pattern (employee-services)

Headers:
```sql
SELECT h.invID, h.invType, h.SubTotal, h.GrandTotal, h.DisVal
FROM dbo.TblinvServHead h
WHERE CAST(h.invDate AS date) >= @fromDate AND CAST(h.invDate AS date) <= @toDate
  AND h.invType = N'مبيعات'
```

Details:
```sql
SELECT d.ID, d.invID, d.invType, d.EmpID, e.EmpName, d.ProID,
       d.Qty, d.SPrice, d.SValue, d.DisVal,
       <LINE_TOTAL_SQL> AS lineTotal
FROM dbo.TblinvServDetail d
JOIN dbo.TblinvServHead h ON h.invID=d.invID AND h.invType=d.invType
LEFT JOIN dbo.TblEmp e ON e.EmpID = d.EmpID
WHERE CAST(h.invDate AS date) BETWEEN @fromDate AND @toDate
  AND h.invType = N'مبيعات'
  AND d.EmpID IS NOT NULL AND d.ProID IS NOT NULL
```

Then JS: `allocateEmployeeInvoiceRevenue(headers, details)`.

Daily core will reuse this for `fromDate = toDate = workDate`.
