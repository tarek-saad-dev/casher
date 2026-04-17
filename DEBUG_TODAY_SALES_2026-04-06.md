# DEBUG REPORT - Today Sales Page Zero Data Issue
## Date: 2026-04-06

---

## 1) FRONTEND FILES

### Main Page
**File**: `h:\whatsapp-bot-node\pos-system\src\app\sales\today\page.tsx`
- React client component
- Uses `useState` for data, loading, error, date selection
- Default date: empty string (backend defaults to current date)

### Data Fetching
```typescript
// Line 30-54: loadSalesData function
const loadSalesData = useCallback(async () => {
  const params = new URLSearchParams();
  if (selectedDate) params.set('date', selectedDate);
  
  const response = await fetch(`/api/sales/today?${params.toString()}`);
  const result = await response.json();
  setData(result);
}, [selectedDate]);
```

### Components Used
- `TodaySalesKpiCards` - KPI summary cards
- `ByShiftView` - Shift analysis
- `ByPaymentMethodView` - Payment method analysis
- `ByBarberView` - Barber analysis
- `ByServiceView` - Service analysis
- `ByHourView` - Hourly analysis
- `TodaySalesTransactionsTable` - Transaction details

---

## 2) BACKEND FILES

### API Endpoint
**File**: `h:\whatsapp-bot-node\pos-system\src\app\api\sales\today\route.ts`

### Queries Structure:
1. **KPI Summary** (lines ~50-146)
   - Total sales, invoice count, customer count
   - Top shift, top payment method, top barber, top service

2. **By Shift** (lines ~159-239)
   - All shifts for the day
   - Top barber per shift
   - Top payment method per shift

3. **By Payment Method** (lines ~262-332)
   - Payment aggregation using CTE with PaymentRows/FallbackRows

4. **By Barber** (lines ~307-328)
   - Barber sales from TblinvServDetail

5. **By Service** (lines ~330-351)
   - Service sales from TblinvServDetail

6. **By Hour** (lines ~353-463)
   - Hourly breakdown

7. **Transactions** (lines ~469-527)
   - Detailed invoice list

---

## 3) ACTUAL INPUT PARAMETERS

### From API Route (line ~40-47):
```typescript
const url = new URL(request.url);
const dateParam = url.searchParams.get('date');
const targetDate = dateParam || new Date().toISOString().split('T')[0];

const shiftMoveIdFilter = url.searchParams.get('shiftMoveId');
const paymentMethodIdFilter = url.searchParams.get('paymentMethodId');
const empIdFilter = url.searchParams.get('empId');
```

### For 2026-04-06:
- `targetDate` = '2026-04-06'
- `shiftMoveIdFilter` = null
- `paymentMethodIdFilter` = null
- `empIdFilter` = null
- No timezone conversion (using DATE type in SQL)

---

## 4) FINAL SQL QUERIES WITH PARAMETERS

### A. WHERE Clause Builder (lines 50-58):
```typescript
let whereConditions = [
  `CAST(h.invDate AS DATE) = @targetDate`,
  `h.invType = N'مبيعات'`,
  `h.isActive = 'yes'`
];
```

**Compiled WHERE**:
```sql
WHERE CAST(h.invDate AS DATE) = '2026-04-06' 
  AND h.invType = N'مبيعات' 
  AND h.isActive = 'yes'
```

### B. KPI Total Sales Query (lines ~60-67):
```sql
SELECT 
  ISNULL(SUM(h.GrandTotal), 0) AS totalSales,
  COUNT(h.invID) AS invoiceCount,
  COUNT(DISTINCT h.ClientID) AS customerCount
FROM [dbo].[TblinvServHead] h
WHERE CAST(h.invDate AS DATE) = '2026-04-06' 
  AND h.invType = N'مبيعات' 
  AND h.isActive = 'yes'
```

### C. Shift Query (lines ~162-180):
```sql
SELECT 
  sm.ID AS shiftMoveId,
  s.ShiftName,
  u.UserName,
  sm.Status,
  COUNT(h.invID) AS invoiceCount,
  ISNULL(SUM(h.GrandTotal), 0) AS totalSales
FROM [dbo].[TblShiftMove] sm
INNER JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
INNER JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
LEFT JOIN [dbo].[TblinvServHead] h ON h.ShiftMoveID = sm.ID 
  AND h.invType = N'مبيعات' 
  AND h.isActive = 'yes'
WHERE CAST(sm.NewDay AS DATE) = '2026-04-06'
GROUP BY sm.ID, s.ShiftName, u.UserName, sm.Status
ORDER BY sm.ID
```

**KEY ISSUE**: Notice LEFT JOIN does NOT filter by invDate!

### D. Payment Method Query (lines ~262-332):
```sql
WITH HeadInvoices AS (
  SELECT
    h.invID,
    h.invType,
    h.ShiftMoveID,
    h.PaymentMethodID,
    PayValue = COALESCE(NULLIF(h.Payment, 0), h.GrandTotal, 0)
  FROM [dbo].[TblinvServHead] h
  WHERE CAST(h.invDate AS DATE) = '2026-04-06'
    AND h.invType = N'مبيعات'
    AND h.isActive = 'yes'
),
PaymentRows AS (...),
FallbackRows AS (...),
NormalizedPayments AS (...)
SELECT pm.PaymentID, pm.PaymentMethod, COUNT(*), SUM(...)
FROM MethodInvoiceTotals mit
INNER JOIN [dbo].[TblPaymentMethods] pm ON ...
```

---

## 5) RAW JSON RESPONSE

**Expected structure** (from code):
```json
{
  "date": "2026-04-06",
  "kpi": {
    "totalSales": 0,
    "invoiceCount": 0,
    "customerCount": 0,
    "averageInvoice": 0,
    "topShift": null,
    "topPaymentMethod": null,
    "topBarber": null,
    "topService": null
  },
  "byShift": [
    {
      "shiftMoveId": 5492,
      "shiftName": "الوردية الاولى",
      "userName": "Hoda",
      "totalSales": 0,
      "invoiceCount": 0,
      "averageInvoice": 0,
      "topBarber": null,
      "topPaymentMethod": null,
      "percentageOfTotal": 0,
      "status": "open/closed"
    }
  ],
  "byPaymentMethod": [],
  "byBarber": [],
  "byService": [],
  "byHour": [],
  "transactions": []
}
```

---

## 6) DATE FIELD REVIEW

### Fields Used:
1. **TblinvServHead.invDate** - Invoice date/time (DATETIME)
   - Used in: ALL KPI queries, payment, barber, service, hour, transactions
   - Filter: `CAST(h.invDate AS DATE) = @targetDate`

2. **TblShiftMove.NewDay** - Shift business day (DATETIME or DATE)
   - Used in: Shift selection only
   - Filter: `CAST(sm.NewDay AS DATE) = @targetDate`

### Critical Finding:
**MISMATCH LOGIC**:
- Shifts are selected by `sm.NewDay = 2026-04-06`
- Invoices are filtered by `h.invDate = 2026-04-06`
- But in shift LEFT JOIN: **NO invDate filter!**

This means:
- If shift was opened on 2026-04-06
- But invoices have invDate = 2026-04-05 or another date
- Those invoices are **EXCLUDED** from KPI/payment/barber queries
- But **INCLUDED** in shift query (because LEFT JOIN has no date filter)

**WAIT** - Actually looking at line 173-174:
```sql
LEFT JOIN [dbo].[TblinvServHead] h ON h.ShiftMoveID = sm.ID 
  AND h.invType = N'مبيعات' 
  AND h.isActive = 'yes'
```
There's **NO invDate filter in the LEFT JOIN**!

This is **CORRECT** behavior (we removed it intentionally to match admin page).

So the real question is: **Why are KPI queries returning zero?**

---

## 7) CRITICAL FILTERS REVIEW

### A. invType Filter:
```sql
h.invType = N'مبيعات'
```
**Status**: ✅ Correct (matches sales type)

### B. isActive Filter:
```sql
h.isActive = 'yes'
```
**Status**: ⚠️ **CRITICAL ISSUE FOUND!**

Looking at user's diagnostic query from their previous message:
```sql
WHERE ISNULL(h.isActive, N'no') = N'no'
```

**They're checking for isActive = 'no'!**

This suggests the actual invoice data has:
- `isActive = 'no'` for ACTIVE invoices
- `isActive = 'yes'` for DELETED/CANCELLED invoices

**OR** the field is NULL and defaults to 'no' for active.

### C. Excluded Records:
- No filter for returns/cancellations beyond isActive
- No filter for reserved invoices

### D. JOIN Issues:
- Payment method query uses INNER JOIN to TblPaymentMethods
  - Could exclude invoices if PaymentMethodID is NULL or invalid
- Barber query uses INNER JOIN to TblinvServDetail
  - Excludes invoices with no detail rows

---

## 8) DATA SOURCE REVIEW

### Primary Source:
**TblinvServHead** - Main invoice header table

### Payment Logic:
Uses CTE with fallback:
1. Try **TblinvServPayment** (payment rows)
2. Fallback to **TblinvServHead.PaymentMethodID + GrandTotal**

### No Views Used:
All queries are direct table access.

---

## 9) DATABASE CONNECTION

### Connection String:
**File**: `h:\whatsapp-bot-node\pos-system\src\lib\db.ts`

Expected content:
```typescript
DB_SERVER=localhost
DB_NAME=HawaiDB
DB_USER=...
DB_PASSWORD=...
```

**Status**: Needs verification - connection appears to work (shifts are returned).

---

## 10) DIAGNOSTIC SQL QUERIES

**Run these queries manually in SSMS:**

### Query A: All invoices on 2026-04-06
```sql
SELECT
    h.invID,
    h.invType,
    h.invDate,
    h.ShiftMoveID,
    h.PaymentMethodID,
    h.GrandTotal,
    h.Payment,
    h.PayCash,
    h.PayVisa,
    h.isActive,
    h.UserID,
    h.ClientID
FROM dbo.TblinvServHead h
WHERE CAST(h.invDate AS DATE) = '2026-04-06'
ORDER BY h.invID DESC;
```

### Query B: Count by type and status
```sql
SELECT
    h.invType,
    h.isActive,
    COUNT(*) AS Cnt,
    SUM(ISNULL(h.GrandTotal,0)) AS TotalAmount
FROM dbo.TblinvServHead h
WHERE CAST(h.invDate AS DATE) = '2026-04-06'
GROUP BY h.invType, h.isActive
ORDER BY h.invType, h.isActive;
```

### Query C: Group by shift
```sql
SELECT
    h.ShiftMoveID,
    h.isActive,
    COUNT(*) AS InvoiceCount,
    SUM(ISNULL(h.GrandTotal,0)) AS TotalAmount
FROM dbo.TblinvServHead h
WHERE CAST(h.invDate AS DATE) = '2026-04-06'
  AND h.invType = N'مبيعات'
GROUP BY h.ShiftMoveID, h.isActive
ORDER BY h.ShiftMoveID, h.isActive;
```

### Query D: Shifts for the day
```sql
SELECT
    sm.ID AS ShiftMoveID,
    sm.NewDay,
    sm.StartDate,
    sm.EndDate,
    sm.Status,
    u.UserID,
    u.UserName
FROM dbo.TblShiftMove sm
LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
WHERE CAST(sm.NewDay AS DATE) = '2026-04-06'
   OR CAST(sm.StartDate AS DATE) = '2026-04-06'
   OR CAST(sm.EndDate AS DATE) = '2026-04-06'
ORDER BY sm.ID DESC;
```

### Query E: Payment rows
```sql
SELECT
    p.ID,
    p.invID,
    p.invType,
    p.PayDate,
    p.PayValue,
    p.PaymentMethodID,
    p.ShiftMoveID
FROM dbo.TblinvServPayment p
WHERE CAST(p.PayDate AS DATE) = '2026-04-06'
   OR p.ShiftMoveID IN (
       SELECT ID
       FROM dbo.TblShiftMove
       WHERE CAST(NewDay AS DATE) = '2026-04-06'
   )
ORDER BY p.ID DESC;
```

---

## 11) ROOT CAUSE (Preliminary)

**Based on code analysis**:

### Most Likely Root Cause:
**`isActive` filter logic is inverted**
- Code filters for `h.isActive = 'yes'`
- But actual active invoices have `h.isActive = 'no'` or NULL

### Evidence:
1. User's previous diagnostic query used: `ISNULL(h.isActive, N'no') = N'no'`
2. Shifts return correctly (proving DB connection works)
3. All invoice queries return zero (proving filter is wrong)

### Exact Fix Location:
**File**: `h:\whatsapp-bot-node\pos-system\src\app\api\sales\today\route.ts`
**Line**: 51
**Change**: `h.isActive = 'yes'` → `ISNULL(h.isActive, 'no') = 'no'`

---

## 12) REQUIRED VERIFICATION

Before applying fix, **RUN QUERY B** from section 10 to confirm:
- What is the actual value of `isActive` for sales invoices on 2026-04-06?
- Is it 'yes', 'no', NULL, or something else?

Once confirmed, I will apply the exact patch.

---

**STOP - AWAITING USER TO RUN DIAGNOSTIC QUERIES**
