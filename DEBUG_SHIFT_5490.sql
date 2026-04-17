-- Diagnostic query to understand why Shift 5490 (Hoda) shows zero sales

-- 1. Check shift details
SELECT 
  sm.ID AS ShiftMoveID,
  sm.NewDay,
  sm.StartDate,
  sm.StartTime,
  sm.EndDate,
  sm.EndTime,
  sm.Status,
  s.ShiftName,
  u.UserName
FROM [dbo].[TblShiftMove] sm
LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
WHERE sm.ID = 5490;

-- 2. Check ALL invoices for this shift (regardless of date)
SELECT 
  h.invID,
  h.invDate,
  h.invTime,
  h.invType,
  h.GrandTotal,
  h.ShiftMoveID,
  h.isActive
FROM [dbo].[TblinvServHead] h
WHERE h.ShiftMoveID = 5490
  AND h.invType = N'مبيعات'
ORDER BY h.invDate, h.invTime;

-- 3. Check if dates match
SELECT 
  sm.ID AS ShiftMoveID,
  CAST(sm.NewDay AS DATE) AS ShiftDate,
  h.invID,
  h.invDate AS InvoiceDateTime,
  CAST(h.invDate AS DATE) AS InvoiceDate,
  CASE 
    WHEN CAST(sm.NewDay AS DATE) = CAST(h.invDate AS DATE) THEN 'MATCH'
    ELSE 'MISMATCH'
  END AS DateMatch,
  h.GrandTotal
FROM [dbo].[TblShiftMove] sm
LEFT JOIN [dbo].[TblinvServHead] h ON h.ShiftMoveID = sm.ID 
  AND h.invType = N'مبيعات'
  AND h.isActive = 'yes'
WHERE sm.ID = 5490;

-- 4. Test the exact query from today sales
DECLARE @targetDate DATE = '2026-04-05';

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
  AND CAST(h.invDate AS DATE) = @targetDate 
  AND h.invType = N'مبيعات' 
  AND h.isActive = 'yes'
WHERE CAST(sm.NewDay AS DATE) = @targetDate
  AND sm.ID = 5490
GROUP BY sm.ID, s.ShiftName, u.UserName, sm.Status;

-- 5. Compare with shift history query (what admin page uses)
SELECT 
  sm.ID,
  (SELECT COUNT(*) FROM [dbo].[TblinvServHead] WHERE ShiftMoveID = sm.ID AND invType = N'مبيعات') AS salesCount,
  (SELECT ISNULL(SUM(GrandTotal), 0) FROM [dbo].[TblinvServHead] WHERE ShiftMoveID = sm.ID AND invType = N'مبيعات') AS totalRevenue
FROM [dbo].[TblShiftMove] sm
WHERE sm.ID = 5490;
