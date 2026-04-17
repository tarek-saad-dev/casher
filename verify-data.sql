-- Verify required data exists for Treasury feature

PRINT '============================================================';
PRINT 'Checking TblTreasuryCloseRecon table...';
PRINT '============================================================';

IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblTreasuryCloseRecon')
BEGIN
    PRINT '[OK] TblTreasuryCloseRecon table exists';
    SELECT COUNT(*) AS RecordCount FROM [dbo].[TblTreasuryCloseRecon];
END
ELSE
BEGIN
    PRINT '[ERROR] TblTreasuryCloseRecon table does NOT exist!';
END

PRINT '';
PRINT '============================================================';
PRINT 'Checking TblCashMove (Primary Data Source)...';
PRINT '============================================================';

SELECT 
    COUNT(*) AS TotalMovements,
    SUM(CASE WHEN inOut = 'in' THEN 1 ELSE 0 END) AS InflowCount,
    SUM(CASE WHEN inOut = 'out' THEN 1 ELSE 0 END) AS OutflowCount,
    MIN(invDate) AS OldestDate,
    MAX(invDate) AS LatestDate
FROM [dbo].[TblCashMove];

PRINT '';
PRINT '============================================================';
PRINT 'Checking TblPaymentMethods...';
PRINT '============================================================';

SELECT 
    PaymentMethodID,
    PaymentMethodName,
    IsActive
FROM [dbo].[TblPaymentMethods]
WHERE IsActive = 1
ORDER BY PaymentMethodID;

PRINT '';
PRINT '============================================================';
PRINT 'Checking TblNewDay (Business Days)...';
PRINT '============================================================';

SELECT TOP 5
    NewDay,
    DayDate,
    IsOpen
FROM [dbo].[TblNewDay]
ORDER BY NewDay DESC;

PRINT '';
PRINT '============================================================';
PRINT 'Checking TblShiftMove (Active Shifts)...';
PRINT '============================================================';

SELECT TOP 5
    sm.ShiftMoveID,
    sm.NewDay,
    s.ShiftName,
    u.UserName,
    sm.StartDate,
    sm.EndDate
FROM [dbo].[TblShiftMove] sm
LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
ORDER BY sm.ShiftMoveID DESC;

PRINT '';
PRINT '============================================================';
PRINT 'Sample Cash Movements by Payment Method...';
PRINT '============================================================';

SELECT 
    pm.PaymentMethodName,
    COUNT(*) AS TransactionCount,
    SUM(CASE WHEN cm.inOut = 'in' THEN cm.GrandTolal ELSE 0 END) AS TotalInflow,
    SUM(CASE WHEN cm.inOut = 'out' THEN cm.GrandTolal ELSE 0 END) AS TotalOutflow
FROM [dbo].[TblCashMove] cm
INNER JOIN [dbo].[TblPaymentMethods] pm ON cm.PaymentMethodID = pm.PaymentMethodID
GROUP BY pm.PaymentMethodName
ORDER BY TransactionCount DESC;
