-- Check actual column names in TblCashMove
PRINT '============================================================';
PRINT 'TblCashMove Schema';
PRINT '============================================================';
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'TblCashMove'
ORDER BY ORDINAL_POSITION;

PRINT '';
PRINT '============================================================';
PRINT 'TblPaymentMethods Schema';
PRINT '============================================================';
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'TblPaymentMethods'
ORDER BY ORDINAL_POSITION;

PRINT '';
PRINT '============================================================';
PRINT 'Sample TblCashMove Data';
PRINT '============================================================';
SELECT TOP 3 * FROM [dbo].[TblCashMove];

PRINT '';
PRINT '============================================================';
PRINT 'Sample TblPaymentMethods Data';
PRINT '============================================================';
SELECT * FROM [dbo].[TblPaymentMethods];
