# Payment Logic Audit & Fix Plan

## ROOT CAUSE CONFIRMED

**Critical Finding**: Payment data exists in TWO locations with no guaranteed consistency:

1. **Legacy invoices** (older data):
   - Payment stored in `TblinvServHead.PaymentMethodID` + `GrandTotal`
   - NO rows in `TblinvServPayment`
   - Example: ShiftMoveID 5490 - 10 invoices, 1520 total, ZERO payment rows

2. **Modern invoices** (newer data):
   - Payment stored in `TblinvServPayment` table
   - Supports split payments (multiple payment methods per invoice)
   - Header may or may not have PaymentMethodID populated

3. **Current queries**: Only use header-based PaymentMethodID
   - Works for legacy invoices ✅
   - FAILS for split-payment invoices ❌
   - Doesn't aggregate payment rows when they exist ❌

---

## VERIFIED SQL BASELINE

For ShiftMoveID 5490 (header-only invoices):

```sql
-- This works correctly for legacy:
SELECT
    ISNULL(pm.PaymentMethod, N'غير محدد') AS PaymentMethod,
    COUNT(*) AS InvoiceCount,
    SUM(ISNULL(h.GrandTotal, 0)) AS TotalAmount
FROM dbo.TblinvServHead h
LEFT JOIN dbo.TblPaymentMethods pm ON h.PaymentMethodID = pm.PaymentID
WHERE h.invType = N'مبيعات' AND h.ShiftMoveID = 5490
GROUP BY pm.PaymentMethod;

-- Expected Result:
-- Cash = 1220
-- Visa = 250
-- Tilda = 50
-- Total = 1520
```

---

## REQUIRED PAYMENT SOURCE HIERARCHY

```
FOR EACH INVOICE:
  IF TblinvServPayment has rows for this invoice:
    → Use payment rows (SUM of PayValue grouped by PaymentMethodID)
    → Handles split payments correctly
  ELSE:
    → Fallback to TblinvServHead.PaymentMethodID + GrandTotal
    → Handles legacy invoices correctly
  END IF
```

---

## UNIFIED PAYMENT AGGREGATION QUERY

```sql
-- This query implements the hierarchy:
WITH InvoicePayments AS (
  SELECT 
    h.invID,
    h.invType,
    h.ShiftMoveID,
    h.invDate,
    h.isActive,
    -- Use payment rows if they exist, otherwise use header
    COALESCE(p.PaymentMethodID, h.PaymentMethodID) AS PaymentMethodID,
    COALESCE(p.PayValue, h.GrandTotal) AS PayValue
  FROM [dbo].[TblinvServHead] h
  LEFT JOIN [dbo].[TblinvServPayment] p 
    ON h.invID = p.invID 
    AND h.invType = p.invType
  WHERE h.invType = N'مبيعات'
    AND h.isActive = 'yes'
    AND CAST(h.invDate AS DATE) = @targetDate
)
SELECT 
  pm.PaymentID,
  pm.PaymentMethod,
  COUNT(DISTINCT ip.invID) AS invoiceCount,
  ISNULL(SUM(ip.PayValue), 0) AS totalAmount
FROM InvoicePayments ip
INNER JOIN [dbo].[TblPaymentMethods] pm ON ip.PaymentMethodID = pm.PaymentID
GROUP BY pm.PaymentID, pm.PaymentMethod
ORDER BY totalAmount DESC;
```

**Key Features**:
- `LEFT JOIN TblinvServPayment` - gets payment rows if they exist
- `COALESCE(p.PaymentMethodID, h.PaymentMethodID)` - uses payment row first, header as fallback
- `COALESCE(p.PayValue, h.GrandTotal)` - uses payment amount first, grand total as fallback
- Handles split payments (one invoice can create multiple rows)
- Handles legacy invoices (falls back to header)

---

## QUERIES TO FIX

1. **KPI Top Payment Method** (lines ~98-109)
2. **By Payment Method** (lines 246-257)
3. **Top Payment Method per Shift** (lines 212-221)
4. **All other payment aggregations**

---

## TESTING REQUIREMENTS

✅ Test shift 5490 (header-only) → should show Cash=1220, Visa=250, Tilda=50
✅ Test shift 5491 (modern with payment rows) → should use payment rows
✅ Test split payment invoice → should show multiple payment methods for one invoice
✅ Test mixed shift → some invoices with rows, some without
✅ Verify totals match: sum of payment methods = KPI total sales

---

## IMPLEMENTATION NOTES

**DO NOT**:
- Use invoice Notes to determine payment method
- Assume TblinvServPayment is always populated
- Use PayCash/PayVisa from header (they're NULL in legacy data)

**DO**:
- Always LEFT JOIN to TblinvServPayment
- Use COALESCE for fallback logic
- Count DISTINCT invoices (for split payments)
- Test against verified SQL baseline
