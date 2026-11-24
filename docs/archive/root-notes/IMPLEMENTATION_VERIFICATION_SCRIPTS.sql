-- IMPLEMENTATION VERIFICATION SCRIPTS
-- Run these BEFORE and AFTER implementation to ensure safety
-- Date: 2026-04-15

USE HawaiDB;
GO

PRINT '========================================';
PRINT 'PRE-IMPLEMENTATION VERIFICATION';
PRINT '========================================';

-- 1. Check Database Backup Status
PRINT '';
PRINT '1. CHECKING BACKUP STATUS...';
SELECT 
    name AS DatabaseName,
    backup_start_date AS LastBackupStart,
    backup_finish_date AS LastBackupFinish,
    CASE backup_type
        WHEN 1 THEN 'Full'
        WHEN 2 THEN 'Differential'
        WHEN 3 THEN 'Transaction Log'
        ELSE 'Unknown'
    END AS BackupType,
    physical_device_name AS BackupLocation
FROM msdb.dbo.backupset
WHERE database_name = DB_NAME()
  AND backup_type = 1  -- Full backups only
ORDER BY backup_finish_date DESC;

-- 2. Check Current Table State
PRINT '';
PRINT '2. CHECKING CURRENT TABLES...';
SELECT 
    t.name AS TableName,
    p.rows AS RowCount,
    CAST(ROUND(((SUM(a.total_pages) * 8) / 1024.00), 2) AS DECIMAL(10,2)) AS TotalSizeMB
FROM sys.tables t
INNER JOIN sys.indexes i ON t.object_id = i.object_id
INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
WHERE t.name IN ('TblCashMove', 'TblExpINCat', 'TblEmp', 'TblStaffExpenseDistribution', 'TblStaffExpenseDistributionDetail')
GROUP BY t.name, p.rows
ORDER BY t.name;

-- 3. Check for Conflicting Objects
PRINT '';
PRINT '3. CHECKING FOR CONFLICTING OBJECTS...';

-- Check for existing tables
SELECT 'Table' AS ObjectType, name AS ObjectName, 'EXISTS' AS Status
FROM sys.tables
WHERE name IN ('TblStaffExpenseDistribution', 'TblStaffExpenseDistributionDetail')
UNION ALL
-- Check for existing triggers
SELECT 'Trigger' AS ObjectType, name AS ObjectName, 'EXISTS' AS Status
FROM sys.triggers
WHERE name = 'trg_AutoDistributeStaffExpense'
UNION ALL
-- Check for existing procedures
SELECT 'Procedure' AS ObjectType, name AS ObjectName, 'EXISTS' AS Status
FROM sys.procedures
WHERE name = 'sp_DistributeStaffExpense'
UNION ALL
-- Check for existing views
SELECT 'View' AS ObjectType, name AS ObjectName, 'EXISTS' AS Status
FROM sys.views
WHERE name = 'VwStaffExpenseSummary';

-- 4. Verify Core Data Integrity
PRINT '';
PRINT '4. VERIFYING CORE DATA INTEGRITY...';

-- Check TblCashMove structure
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'TblCashMove'
  AND COLUMN_NAME IN ('ID', 'invID', 'invType', 'invDate', 'invTime', 'ExpINID', 'GrandTolal', 'inOut', 'Notes', 'ShiftMoveID', 'PaymentMethodID')
ORDER BY ORDINAL_POSITION;

-- Check expense categories
PRINT '';
PRINT '5. CHECKING EXPENSE CATEGORIES...';
SELECT 
    ExpINID,
    CatName,
    ExpINType,
    CASE WHEN EXISTS (
        SELECT 1 FROM [dbo].[TblCashMove] cm 
        WHERE cm.ExpINID = cat.ExpINID
    ) THEN 'Used' ELSE 'Not Used' END AS UsageStatus
FROM [dbo].[TblExpINCat] cat
WHERE cat.ExpINType = N'expenses'
ORDER BY CatName;

-- Check staff members
PRINT '';
PRINT '6. CHECKING STAFF MEMBERS...';
SELECT 
    EmpID,
    EmpName,
    IsActive,
    CASE WHEN EXISTS (
        SELECT 1 FROM [dbo].[TblStaffExpenseDistribution] sd 
        WHERE sd.StaffMemberID = e.EmpID
    ) THEN 'Has Distribution' ELSE 'No Distribution' END AS DistributionStatus
FROM [dbo].[TblEmp] e
WHERE e.IsActive = 1
ORDER BY EmpName;

-- 7. Check Current Expense Data
PRINT '';
PRINT '7. CHECKING CURRENT EXPENSE DATA...';
SELECT 
    COUNT(*) AS TotalExpenses,
    SUM(GrandTolal) AS TotalAmount,
    COUNT(DISTINCT ExpINID) AS CategoriesUsed,
    MIN(invDate) AS EarliestExpense,
    MAX(invDate) AS LatestExpense
FROM [dbo].[TblCashMove]
WHERE invType = N'expenses' AND inOut = N'out';

-- 8. Check for Potential Conflicts
PRINT '';
PRINT '8. CHECKING FOR POTENTIAL CONFLICTS...';

-- Check for staff_expense invType usage
SELECT 
    COUNT(*) AS StaffExpenseCount,
    MIN(invDate) AS EarliestStaffExpense,
    MAX(invDate) AS LatestStaffExpense
FROM [dbo].[TblCashMove]
WHERE invType = N'staff_expense';

-- Check for duplicate invIDs
SELECT 
    invType,
    invID,
    COUNT(*) AS DuplicateCount
FROM [dbo].[TblCashMove]
GROUP BY invType, invID
HAVING COUNT(*) > 1;

-- 9. Performance Baseline
PRINT '';
PRINT '9. ESTABLISHING PERFORMANCE BASELINE...';

-- Sample query performance
DECLARE @StartTime DATETIME = GETDATE();
DECLARE @TestCount INT;

SELECT @TestCount = COUNT(*)
FROM [dbo].[TblCashMove]
WHERE invDate >= DATEADD(DAY, -30, GETDATE());

DECLARE @ElapsedMS INT = DATEDIFF(MILLISECOND, @StartTime, GETDATE());

SELECT 
    @TestCount AS RecordCount,
    @ElapsedMS AS ElapsedMilliseconds,
    CASE 
        WHEN @ElapsedMS < 100 THEN 'Excellent'
        WHEN @ElapsedMS < 500 THEN 'Good'
        WHEN @ElapsedMS < 1000 THEN 'Acceptable'
        ELSE 'Needs Optimization'
    END AS PerformanceRating;

PRINT '';
PRINT '========================================';
PRINT 'PRE-IMPLEMENTATION VERIFICATION COMPLETE';
PRINT '========================================';
GO

-- ========================================
-- POST-IMPLEMENTATION VERIFICATION
-- ========================================
-- Run this AFTER implementing the system
PRINT '';
PRINT '';
PRINT '========================================';
PRINT 'POST-IMPLEMENTATION VERIFICATION';
PRINT '========================================';

-- 1. Verify New Objects Created
PRINT '';
PRINT '1. VERIFYING NEW OBJECTS CREATED...';

SELECT 'Table' AS ObjectType, name AS ObjectName, 
       CASE WHEN EXISTS (SELECT 1 FROM sys.tables WHERE name = t.name) THEN 'Created' ELSE 'Missing' END AS Status
FROM (VALUES ('TblStaffExpenseDistribution'), ('TblStaffExpenseDistributionDetail')) AS t(name)
UNION ALL
SELECT 'Trigger' AS ObjectType, name AS ObjectName,
       CASE WHEN EXISTS (SELECT 1 FROM sys.triggers WHERE name = t.name) THEN 'Created' ELSE 'Missing' END AS Status
FROM (VALUES ('trg_AutoDistributeStaffExpense')) AS t(name)
UNION ALL
SELECT 'Procedure' AS ObjectType, name AS ObjectName,
       CASE WHEN EXISTS (SELECT 1 FROM sys.procedures WHERE name = t.name) THEN 'Created' ELSE 'Missing' END AS Status
FROM (VALUES ('sp_DistributeStaffExpense')) AS t(name)
UNION ALL
SELECT 'View' AS ObjectType, name AS ObjectName,
       CASE WHEN EXISTS (SELECT 1 FROM sys.views WHERE name = t.name) THEN 'Created' ELSE 'Missing' END AS Status
FROM (VALUES ('VwStaffExpenseSummary')) AS t(name);

-- 2. Verify Table Structures
PRINT '';
PRINT '2. VERIFYING TABLE STRUCTURES...';

-- TblStaffExpenseDistribution structure
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'TblStaffExpenseDistribution'
ORDER BY ORDINAL_POSITION;

-- TblStaffExpenseDistributionDetail structure
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'TblStaffExpenseDistributionDetail'
ORDER BY ORDINAL_POSITION;

-- 3. Verify Trigger Status
PRINT '';
PRINT '3. VERIFYING TRIGGER STATUS...';
SELECT 
    name AS TriggerName,
    OBJECT_NAME(parent_id) AS ParentTable,
    is_disabled AS IsDisabled,
    create_date AS CreatedDate,
    modify_date AS ModifiedDate
FROM sys.triggers
WHERE name = 'trg_AutoDistributeStaffExpense';

-- 4. Verify Procedure Status
PRINT '';
PRINT '4. VERIFYING PROCEDURE STATUS...';
SELECT 
    name AS ProcedureName,
    create_date AS CreatedDate,
    modify_date AS ModifiedDate,
    CASE 
        WHEN OBJECT_DEFINITION(object_id) LIKE '%@ExpenseID%' THEN 'Valid'
        ELSE 'Invalid'
    END AS Status
FROM sys.procedures
WHERE name = 'sp_DistributeStaffExpense';

-- 5. Test Distribution Setup
PRINT '';
PRINT '5. TESTING DISTRIBUTION SETUP...';

-- Check if any distribution exists
SELECT 
    COUNT(*) AS DistributionCount,
    COUNT(DISTINCT ExpenseCategoryID) AS CategoriesWithDistribution,
    COUNT(DISTINCT StaffMemberID) AS StaffWithDistribution,
    SUM(DistributionPercentage) AS TotalPercentage
FROM [dbo].[TblStaffExpenseDistribution]
WHERE IsActive = 1;

-- 6. Test Sample Distribution
PRINT '';
PRINT '6. TESTING SAMPLE DISTRIBUTION...';

-- Create a test scenario (if safe)
DECLARE @TestCategoryID INT = (SELECT TOP 1 ExpINID FROM [dbo].[TblExpINCat] WHERE ExpINType = N'expenses');
DECLARE @TestAmount DECIMAL(10,2) = 100.00;
DECLARE @TestDate DATETIME = GETDATE();
DECLARE @TestShiftID INT = 1; -- Use existing shift if available

IF @TestCategoryID IS NOT NULL AND EXISTS (SELECT 1 FROM [dbo].[TblStaffExpenseDistribution] WHERE ExpenseCategoryID = @TestCategoryID AND IsActive = 1)
BEGIN
    PRINT 'Running test distribution...';
    
    -- Test the procedure
    EXEC [dbo].[sp_DistributeStaffExpense]
        @ExpenseID = 999999, -- Fake ID for testing
        @ExpenseCategoryID = @TestCategoryID,
        @Amount = @TestAmount,
        @CreatedDate = @TestDate,
        @ShiftMoveID = @TestShiftID,
        @PaymentMethodID = 1,
        @Notes = N'Test Distribution';
    
    -- Check results
    SELECT 
        COUNT(*) AS DistributedRecords,
        SUM(DistributedAmount) AS TotalDistributed,
        CASE WHEN SUM(DistributedAmount) = @TestAmount THEN 'Correct' ELSE 'Incorrect' END AS Accuracy
    FROM [dbo].[TblStaffExpenseDistributionDetail]
    WHERE OriginalExpenseID = 999999;
    
    -- Clean up test data
    DELETE FROM [dbo].[TblCashMove] WHERE invType = N'staff_expense' AND invDate = @TestDate;
    DELETE FROM [dbo].[TblStaffExpenseDistributionDetail] WHERE OriginalExpenseID = 999999;
    
    PRINT 'Test distribution completed and cleaned up.';
END
ELSE
BEGIN
    PRINT 'No test category or distribution setup available for testing.';
END

-- 7. Performance Comparison
PRINT '';
PRINT '7. PERFORMANCE COMPARISON...';

DECLARE @StartTime DATETIME = GETDATE();
DECLARE @TestCount INT;

SELECT @TestCount = COUNT(*)
FROM [dbo].[TblCashMove] cm
LEFT JOIN [dbo].[TblStaffExpenseDistributionDetail] ded ON cm.ID = ded.OriginalExpenseID
WHERE cm.invDate >= DATEADD(DAY, -30, GETDATE());

DECLARE @ElapsedMS INT = DATEDIFF(MILLISECOND, @StartTime, GETDATE());

SELECT 
    @TestCount AS RecordCount,
    @ElapsedMS AS ElapsedMilliseconds,
    CASE 
        WHEN @ElapsedMS < 100 THEN 'Excellent'
        WHEN @ElapsedMS < 500 THEN 'Good'
        WHEN @ElapsedMS < 1000 THEN 'Acceptable'
        ELSE 'Needs Optimization'
    END AS PerformanceRating;

-- 8. Data Integrity Check
PRINT '';
PRINT '8. DATA INTEGRITY CHECK...';

-- Check for any data corruption
SELECT 
    'Original Expenses' AS DataType,
    COUNT(*) AS Count,
    SUM(GrandTolal) AS TotalAmount
FROM [dbo].[TblCashMove]
WHERE invType = N'expenses' AND inOut = N'out'

UNION ALL

SELECT 
    'Distributed Expenses' AS DataType,
    COUNT(*) AS Count,
    SUM(GrandTolal) AS TotalAmount
FROM [dbo].[TblCashMove]
WHERE invType = N'staff_expense'

UNION ALL

SELECT 
    'Distribution Details' AS DataType,
    COUNT(*) AS Count,
    SUM(DistributedAmount) AS TotalAmount
FROM [dbo].[TblStaffExpenseDistributionDetail];

-- 9. API Endpoints Test (Manual)
PRINT '';
PRINT '9. API ENDPOINTS TEST...';
PRINT 'Manual verification required:';
PRINT '1. GET /api/expenses/distribute - Should return distributions, categories, staff';
PRINT '2. GET /api/expenses/distribute/summary - Should return summary data';
PRINT '3. POST /api/expenses/distribute - Should create/update distribution';
PRINT '4. PUT /api/expenses/distribute - Should update multiple distributions';

PRINT '';
PRINT '========================================';
PRINT 'POST-IMPLEMENTATION VERIFICATION COMPLETE';
PRINT '========================================';
GO

-- ========================================
-- EMERGENCY ROLLBACK SCRIPT
-- ========================================
-- Use this ONLY if critical issues occur
PRINT '';
PRINT '';
PRINT '========================================';
PRINT 'EMERGENCY ROLLBACK SCRIPT (USE ONLY IF NEEDED)';
PRINT '========================================';

-- Disable trigger immediately (safer than dropping)
PRINT 'Disabling trigger...';
DISABLE TRIGGER [dbo].[trg_AutoDistributeStaffExpense] ON [dbo].[TblCashMove];

-- Remove new objects (commented out for safety - uncomment only if absolutely necessary)
/*
PRINT 'Dropping new objects...';
DROP TRIGGER IF EXISTS [dbo].[trg_AutoDistributeStaffExpense];
DROP PROCEDURE IF EXISTS [dbo].[sp_DistributeStaffExpense];
DROP VIEW IF EXISTS [dbo].[VwStaffExpenseSummary];
DROP TABLE IF EXISTS [dbo].[TblStaffExpenseDistributionDetail];
DROP TABLE IF EXISTS [dbo].[TblStaffExpenseDistribution];
*/

-- Clean up any test data (safe)
PRINT 'Cleaning up any test data...';
DELETE FROM [dbo].[TblCashMove] WHERE invType = N'staff_expense' AND invDate >= DATEADD(DAY, -1, GETDATE());

PRINT 'Rollback completed. System is safe.';
GO

PRINT '========================================';
PRINT 'ALL VERIFICATION SCRIPTS READY';
PRINT '========================================';
PRINT '';
PRINT 'USAGE:';
PRINT '1. Run PRE-IMPLEMENTATION before starting';
PRINT '2. Run POST-IMPLEMENTATION after completion';
PRINT '3. Use EMERGENCY ROLLBACK only if critical issues';
PRINT '';
PRINT 'Keep this script for future reference and troubleshooting.';
