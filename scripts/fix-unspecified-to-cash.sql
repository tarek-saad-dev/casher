-- SQL Script: Fix all unspecified payment methods to Cash (كاش)
-- Run this in SQL Server Management Studio or Azure Data Studio

-- Step 1: Find Cash payment method ID
DECLARE @CashPaymentMethodID INT;
SELECT @CashPaymentMethodID = PaymentID FROM dbo.TblPaymentMethods WHERE PaymentMethod = N'كاش';

IF @CashPaymentMethodID IS NULL
BEGIN
    PRINT 'Error: Cash payment method (كاش) not found!';
    RETURN;
END

PRINT 'Cash payment method ID: ' + CAST(@CashPaymentMethodID AS VARCHAR);

-- Step 2: Show what will be updated
SELECT 
    COUNT(*) AS TotalToFix,
    SUM(CASE WHEN invType = N'ايرادات' THEN 1 ELSE 0 END) AS RevenueCount,
    SUM(CASE WHEN invType = N'مصروفات' THEN 1 ELSE 0 END) AS ExpenseCount,
    SUM(GrandTolal) AS TotalAmount
FROM dbo.TblCashMove CM
LEFT JOIN dbo.TblPaymentMethods PM ON CM.PaymentMethodID = PM.PaymentID
WHERE CM.PaymentMethodID IS NULL 
   OR PM.PaymentMethod IS NULL 
   OR PM.PaymentMethod = '' 
   OR PM.PaymentMethod = N'غير محدد';

-- Step 3: Preview sample of affected records
PRINT 'Sample of affected transactions:';
SELECT TOP 10
    CM.ID,
    CM.invID,
    CM.invDate,
    CM.invType,
    CM.GrandTolal,
    ISNULL(CAT.CatName, N'غير مصنف') AS CategoryName,
    ISNULL(U.UserName, N'غير معروف') AS UserName,
    CM.PaymentMethodID AS OldPaymentMethodID,
    ISNULL(PM.PaymentMethod, N'غير محدد') AS OldPaymentMethod
FROM dbo.TblCashMove CM
LEFT JOIN dbo.TblPaymentMethods PM ON CM.PaymentMethodID = PM.PaymentID
LEFT JOIN dbo.TblExpINCat CAT ON CM.ExpINID = CAT.ExpINID
LEFT JOIN dbo.TblShiftMove SM ON CM.ShiftMoveID = SM.ID
LEFT JOIN dbo.TblUser U ON SM.UserID = U.UserID
WHERE CM.PaymentMethodID IS NULL 
   OR PM.PaymentMethod IS NULL 
   OR PM.PaymentMethod = '' 
   OR PM.PaymentMethod = N'غير محدد'
ORDER BY CM.invDate DESC;

-- Step 4: UNCOMMENT THE FOLLOWING TO ACTUALLY UPDATE
-- WARNING: This will modify your database! Make sure you have a backup.

/*
UPDATE CM
SET 
    PaymentMethodID = @CashPaymentMethodID,
    Notes = ISNULL(CM.Notes, '') + ' [AutoFixed: ' + CAST(GETDATE() AS VARCHAR) + ' - PaymentMethod changed from unspecified to كاش]'
FROM dbo.TblCashMove CM
LEFT JOIN dbo.TblPaymentMethods PM ON CM.PaymentMethodID = PM.PaymentID
WHERE CM.PaymentMethodID IS NULL 
   OR PM.PaymentMethod IS NULL 
   OR PM.PaymentMethod = '' 
   OR PM.PaymentMethod = N'غير محدد';

PRINT 'Update complete!';
*/

PRINT '';
PRINT '========================================';
PRINT 'To execute the update, uncomment Step 4';
PRINT 'and run the script again.';
PRINT '========================================';
