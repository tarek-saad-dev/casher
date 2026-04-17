# Testing Today Sales API

## Quick SQL Test

Run this query directly in SQL Server Management Studio to verify data exists:

```sql
-- Test 1: Check if there are any sales today or recent days
SELECT TOP 5
  invDate,
  COUNT(*) AS InvoiceCount,
  SUM(GrandTotal) AS TotalSales
FROM [dbo].[TblinvServHead]
WHERE invType = N'مبيعات' AND isActive = 'yes'
GROUP BY invDate
ORDER BY invDate DESC;

-- Test 2: Check current open business day
SELECT TOP 1 ID, NewDay, Status 
FROM [dbo].[TblNewDay] 
WHERE Status = 1 
ORDER BY ID DESC;

-- Test 3: Simple sales query for a specific date (update date as needed)
DECLARE @targetDate DATE = '2026-04-05';

SELECT 
  COUNT(*) AS invoiceCount,
  ISNULL(SUM(h.GrandTotal), 0) AS totalSales,
  COUNT(DISTINCT h.ClientID) AS customerCount
FROM [dbo].[TblinvServHead] h
WHERE h.invDate = @targetDate 
  AND h.invType = N'مبيعات' 
  AND h.isActive = 'yes';
```

## Testing Steps

1. First, verify database has data by running Test 1 above
2. Check what the current open business day is (Test 2)
3. Test with a date that has sales data (Test 3)
4. Then test the API endpoint

## Browser Test (Requires Login First)

1. Login to POS system: http://localhost:5500/login
2. After login, open: http://localhost:5500/api/sales/today
3. Or with specific date: http://localhost:5500/api/sales/today?date=2026-04-05

## Common Issues

**Issue:** "Must declare the scalar variable @targetDate"
**Fix:** Ensure targetDate parameter is added to the request object before query execution

**Issue:** No data returned
**Fix:** Check if there are sales for the selected date in the database

**Issue:** 401 Unauthorized
**Fix:** Must be logged in first - login at /login page
