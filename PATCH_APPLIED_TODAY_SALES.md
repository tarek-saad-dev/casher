# PATCH APPLIED - Today Sales isActive Filter Fix

## Date: 2026-04-06
## File: src/app/api/sales/today/route.ts

---

## CHANGES SUMMARY

### 1. Added Helper Functions (Lines 15-17)
```typescript
// NEW: Helper functions for consistent filter logic
const activeSalesCondition = (alias: string) => `ISNULL(${alias}.isActive, 'no') = 'no'`;
const dateFilter = (alias: string) => `CAST(${alias}.invDate AS DATE) = @targetDate`;
```

**Purpose**: 
- Centralized filter logic to prevent inconsistencies
- `activeSalesCondition`: Treats NULL or 'no' as active invoices (not 'yes')
- `dateFilter`: Ensures consistent CAST usage for date comparisons

---

## 2. CHANGED LINES - Detailed Diff

### Line 55: WHERE Clause Builder
**BEFORE**:
```typescript
let whereConditions = [`CAST(h.invDate AS DATE) = @targetDate`, `h.invType = N'مبيعات'`, `h.isActive = 'yes'`];
```

**AFTER**:
```typescript
let whereConditions = [dateFilter('h'), `h.invType = N'مبيعات'`, activeSalesCondition('h')];
```

**Impact**: Fixes ALL queries using `whereClause` variable:
- KPI summary (totalSales, invoiceCount, customerCount)
- By payment method
- By barber
- By service
- By hour
- Detailed transactions

---

### Line 96: Top Shift KPI Query
**BEFORE**:
```sql
WHERE CAST(h.invDate AS DATE) = @targetDate AND h.invType = N'مبيعات' AND h.isActive = 'yes'
```

**AFTER**:
```sql
WHERE ${dateFilter('h')} AND h.invType = N'مبيعات' AND ${activeSalesCondition('h')}
```

---

### Line 113: Top Payment Method KPI - HeadInvoices CTE
**BEFORE**:
```sql
WHERE CAST(h.invDate AS DATE) = @targetDate AND h.invType = N'مبيعات' AND h.isActive = 'yes'
```

**AFTER**:
```sql
WHERE ${dateFilter('h')} AND h.invType = N'مبيعات' AND ${activeSalesCondition('h')}
```

---

### Line 161: Top Barber KPI Query
**BEFORE**:
```sql
WHERE CAST(h.invDate AS DATE) = @targetDate AND h.invType = N'مبيعات' AND h.isActive = 'yes'
```

**AFTER**:
```sql
WHERE ${dateFilter('h')} AND h.invType = N'مبيعات' AND ${activeSalesCondition('h')}
```

---

### Line 175: Top Service KPI Query
**BEFORE**:
```sql
WHERE CAST(h.invDate AS DATE) = @targetDate AND h.invType = N'مبيعات' AND h.isActive = 'yes'
```

**AFTER**:
```sql
WHERE ${dateFilter('h')} AND h.invType = N'مبيعات' AND ${activeSalesCondition('h')}
```

---

### Line 216: Shift LEFT JOIN
**BEFORE**:
```sql
LEFT JOIN [dbo].[TblinvServHead] h ON h.ShiftMoveID = sm.ID 
  AND h.invType = N'مبيعات' 
  AND h.isActive = 'yes'
```

**AFTER**:
```sql
LEFT JOIN [dbo].[TblinvServHead] h ON h.ShiftMoveID = sm.ID 
  AND h.invType = N'مبيعات' 
  AND ${activeSalesCondition('h')}
```

---

### Line 243: Top Barber per Shift (alias h3)
**BEFORE**:
```sql
WHERE h3.ShiftMoveID = @shiftMoveId 
  AND h3.invType = N'مبيعات'
  AND h3.isActive = 'yes'
```

**AFTER**:
```sql
WHERE h3.ShiftMoveID = @shiftMoveId 
  AND h3.invType = N'مبيعات'
  AND ${activeSalesCondition('h3')}
```

---

### Line 264: Top Payment Method per Shift - HeadInvoices CTE (alias h2)
**BEFORE**:
```sql
WHERE h2.ShiftMoveID = @shiftMoveId 
  AND h2.invType = N'مبيعات'
  AND h2.isActive = 'yes'
```

**AFTER**:
```sql
WHERE h2.ShiftMoveID = @shiftMoveId 
  AND h2.invType = N'مبيعات'
  AND ${activeSalesCondition('h2')}
```

---

### Lines 449-451: Barber's Top Service Query (alias h4) - **BONUS FIX**
**BEFORE**:
```sql
WHERE d4.EmpID = @empId
  AND h4.invDate = @targetDate          -- ❌ Missing CAST!
  AND h4.invType = N'مبيعات'
  AND h4.isActive = 'yes'
```

**AFTER**:
```sql
WHERE d4.EmpID = @empId
  AND ${dateFilter('h4')}               -- ✅ Fixed date comparison
  AND h4.invType = N'مبيعات'
  AND ${activeSalesCondition('h4')}
```

**Note**: This also fixed an inconsistent date filter that was missing CAST!

---

## 3. TOTAL CHANGES

| Change Type | Count |
|-------------|-------|
| Helper functions added | 2 |
| `isActive = 'yes'` replaced | 9 occurrences |
| Date filter fixed (h4.invDate) | 1 occurrence |
| **Total lines modified** | **12** |

---

## 4. QUERIES AFFECTED

✅ **KPI Summary**:
- Total sales, invoice count, customer count
- Top shift
- Top payment method (HeadInvoices CTE)
- Top barber
- Top service

✅ **By Shift**:
- Shift aggregation LEFT JOIN
- Top barber per shift
- Top payment method per shift (HeadInvoices CTE)

✅ **By Payment Method**:
- HeadInvoices CTE (uses `whereClause`)

✅ **By Barber**:
- Main barber query (uses `detailWhereClause`)
- Barber's top service query (h4) - also fixed date filter!

✅ **By Service**:
- Service sales query (uses `detailWhereClause`)

✅ **By Hour**:
- Hourly sales query (uses `whereClause`)
- Invoice barbers batch query (NO isActive filter - intentional)

✅ **Transactions**:
- Transaction list (uses `whereClause`)

---

## 5. ALIASES FIXED

| Alias | Context | Lines |
|-------|---------|-------|
| `h` | Main queries, KPI | 55, 96, 161, 175, 216 |
| `h2` | Per-shift top payment | 264 |
| `h3` | Per-shift top barber | 243 |
| `h4` | Barber's top service | 449-451 |

**NOTE**: `h5` in hourly barber batch query (line 545) intentionally has NO `isActive` filter to match invoices already filtered by main query.

---

## 6. FILTER LOGIC EXPLANATION

### OLD (Incorrect):
```sql
h.isActive = 'yes'
```
- Excluded all active invoices
- Active invoices have `isActive = 'no'` or `NULL`
- Only matched deleted/cancelled invoices

### NEW (Correct):
```sql
ISNULL(h.isActive, 'no') = 'no'
```
- Includes active invoices (`isActive = 'no'`)
- Includes legacy invoices (`isActive = NULL`, defaults to 'no')
- Excludes deleted/cancelled invoices (`isActive = 'yes'`)

---

## 7. TESTING INSTRUCTIONS

### Test Endpoint:
```bash
# Windows PowerShell
Invoke-RestMethod -Uri "http://localhost:5500/api/sales/today?date=2026-04-06" | ConvertTo-Json -Depth 10

# Or curl
curl "http://localhost:5500/api/sales/today?date=2026-04-06"
```

### Expected Results (2026-04-06):
```json
{
  "kpi": {
    "totalSales": > 0,           // Should NOT be zero
    "invoiceCount": > 0,         // Should NOT be zero
    "topShift": "الوردية الاولى", // Should be populated
    "topPaymentMethod": "نقدي",   // Should be populated
    "topBarber": "...",           // Should be populated
    "topService": "..."           // Should be populated
  },
  "byShift": [
    {
      "shiftMoveId": 5492,
      "invoiceCount": > 0,        // Should NOT be zero
      "totalSales": > 0,          // Should NOT be zero
      "topBarber": "...",         // Should be populated
      "topPaymentMethod": "..."   // Should be populated
    }
  ],
  "byPaymentMethod": [...]        // Should have items
  "byBarber": [...]               // Should have items
  "byService": [...]              // Should have items
  "transactions": [...]           // Should have items
}
```

### Console Logs to Verify:
```
[api/sales/today] Target date: 2026-04-06
[api/sales/today] Fetching ALL shifts for date: 2026-04-06
[api/sales/today] Found X shift(s) for 2026-04-06
  - Shift 5492: الوردية الاولى (Hoda) - Invoices: X, Total: Y
  - Shift 5493: الوردية الاولى (Hoda) - Invoices: X, Total: Y
  - Shift 5494: الوردية الاولى (Tarek) - Invoices: X, Total: Y
[api/sales/today] Payment breakdown:
  - نقدي: X invoices, Y total
  - فيزا: X invoices, Y total
```

---

## 8. VERIFICATION CHECKLIST

- [ ] `kpi.totalSales` > 0
- [ ] `kpi.invoiceCount` > 0
- [ ] `kpi.topPaymentMethod` is populated
- [ ] `kpi.topBarber` is populated
- [ ] `byShift` array has items with non-zero invoiceCount
- [ ] `byPaymentMethod` array is not empty
- [ ] `byBarber` array is not empty
- [ ] `byService` array is not empty
- [ ] `transactions` array is not empty
- [ ] Console shows payment breakdown with actual amounts

---

## 9. ROLLBACK (If Needed)

To rollback, change line 16:
```typescript
// FROM:
const activeSalesCondition = (alias: string) => `ISNULL(${alias}.isActive, 'no') = 'no'`;

// TO:
const activeSalesCondition = (alias: string) => `${alias}.isActive = 'yes'`;
```

---

## 10. SUMMARY

**Root Cause**: 
- `isActive = 'yes'` filter excluded all active invoices
- Active invoices have `isActive = 'no'` or `NULL`

**Fix Applied**:
- Created helper function `activeSalesCondition(alias)`
- Uses `ISNULL(alias.isActive, 'no') = 'no'` pattern
- Applied to 9 query locations across 4 aliases (h, h2, h3, h4)
- Bonus: Fixed inconsistent date filter in h4 query

**Files Changed**: 
- `src/app/api/sales/today/route.ts` only (backend-only fix)

**UI Changes**: 
- None (zero UI modifications)

**Expected Impact**:
- ALL queries now return actual invoice data
- Page displays real sales numbers instead of zeros
