-- Migration: Add dual CashMove support for daily payroll
-- Run this once against the production database.

-- 1. Add IsEmployeePayrollIncome to TblCashMove
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TblCashMove' AND COLUMN_NAME = 'IsEmployeePayrollIncome'
)
BEGIN
    ALTER TABLE [dbo].[TblCashMove]
    ADD [IsEmployeePayrollIncome] BIT NOT NULL DEFAULT 0;
    PRINT 'Added IsEmployeePayrollIncome to TblCashMove';
END
ELSE
    PRINT 'IsEmployeePayrollIncome already exists in TblCashMove';
GO

-- 2. Add EmployeeIncomeCashMoveID to TblEmpDailyPayroll
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TblEmpDailyPayroll' AND COLUMN_NAME = 'EmployeeIncomeCashMoveID'
)
BEGIN
    ALTER TABLE [dbo].[TblEmpDailyPayroll]
    ADD [EmployeeIncomeCashMoveID] INT NULL;
    PRINT 'Added EmployeeIncomeCashMoveID to TblEmpDailyPayroll';
END
ELSE
    PRINT 'EmployeeIncomeCashMoveID already exists in TblEmpDailyPayroll';
GO

-- Verify
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('TblCashMove', 'TblEmpDailyPayroll')
  AND COLUMN_NAME IN ('IsEmployeePayrollIncome', 'EmployeeIncomeCashMoveID')
ORDER BY TABLE_NAME, COLUMN_NAME;
GO
