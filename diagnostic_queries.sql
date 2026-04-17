-- DIAGNOSTIC QUERIES FOR 2026-04-06 ZERO DATA ISSUE
-- Run these in SSMS against HawaiDB

USE HawaiDB;
GO

PRINT '========================================';
PRINT 'QUERY A: All invoices on 2026-04-06';
PRINT '========================================';
SELECT
    h.invID,
    h.invType,
    h.invDate,
    h.ShiftMoveID,
    h.PaymentMethodID,
    h.GrandTotal,
    h.Payment,
    h.isActive,
    h.UserID
FROM dbo.TblinvServHead h
WHERE CAST(h.invDate AS DATE) = '2026-04-06'
ORDER BY h.invID DESC;

PRINT '';
PRINT '========================================';
PRINT 'QUERY B: Count by type and isActive status';
PRINT '========================================';
SELECT
    h.invType,
    h.isActive,
    ISNULL(h.isActive, 'NULL_VALUE') AS isActive_Display,
    COUNT(*) AS Cnt,
    SUM(ISNULL(h.GrandTotal,0)) AS TotalAmount
FROM dbo.TblinvServHead h
WHERE CAST(h.invDate AS DATE) = '2026-04-06'
GROUP BY h.invType, h.isActive
ORDER BY h.invType, h.isActive;

PRINT '';
PRINT '========================================';
PRINT 'QUERY C: Group by shift and isActive';
PRINT '========================================';
SELECT
    h.ShiftMoveID,
    h.isActive,
    h.invType,
    COUNT(*) AS InvoiceCount,
    SUM(ISNULL(h.GrandTotal,0)) AS TotalAmount
FROM dbo.TblinvServHead h
WHERE CAST(h.invDate AS DATE) = '2026-04-06'
GROUP BY h.ShiftMoveID, h.isActive, h.invType
ORDER BY h.ShiftMoveID, h.isActive;

PRINT '';
PRINT '========================================';
PRINT 'QUERY D: Shifts for 2026-04-06';
PRINT '========================================';
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
ORDER BY sm.ID DESC;

PRINT '';
PRINT '========================================';
PRINT 'QUERY E: Test current API filter (isActive = yes)';
PRINT '========================================';
SELECT
    COUNT(*) AS MatchCount,
    SUM(ISNULL(h.GrandTotal,0)) AS TotalAmount
FROM dbo.TblinvServHead h
WHERE CAST(h.invDate AS DATE) = '2026-04-06'
  AND h.invType = N'مبيعات'
  AND h.isActive = 'yes';

PRINT '';
PRINT '========================================';
PRINT 'QUERY F: Test alternative filter (isActive = no or NULL)';
PRINT '========================================';
SELECT
    COUNT(*) AS MatchCount,
    SUM(ISNULL(h.GrandTotal,0)) AS TotalAmount
FROM dbo.TblinvServHead h
WHERE CAST(h.invDate AS DATE) = '2026-04-06'
  AND h.invType = N'مبيعات'
  AND ISNULL(h.isActive, 'no') = 'no';

PRINT '';
PRINT '========================================';
PRINT 'QUERY G: All possible isActive values in the table';
PRINT '========================================';
SELECT DISTINCT
    h.isActive,
    ISNULL(h.isActive, 'NULL_VALUE') AS isActive_Display,
    COUNT(*) AS Cnt
FROM dbo.TblinvServHead h
GROUP BY h.isActive
ORDER BY Cnt DESC;
