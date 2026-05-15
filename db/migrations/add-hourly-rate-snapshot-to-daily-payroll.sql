-- ============================================================
-- Migration: Add HourlyRateSnapshot to TblEmpDailyPayroll
-- Run once against the database.
-- ============================================================

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TblEmpDailyPayroll' AND COLUMN_NAME = 'HourlyRateSnapshot'
)
BEGIN
    ALTER TABLE [dbo].[TblEmpDailyPayroll]
    ADD [HourlyRateSnapshot] DECIMAL(10, 4) NULL;
    PRINT 'Added HourlyRateSnapshot to TblEmpDailyPayroll';
END
ELSE
    PRINT 'HourlyRateSnapshot already exists in TblEmpDailyPayroll';
GO

-- Back-fill snapshot for existing rows from TblEmp.HourlyRate
UPDATE p
SET p.HourlyRateSnapshot = e.HourlyRate
FROM dbo.TblEmpDailyPayroll p
INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
WHERE p.HourlyRateSnapshot IS NULL
  AND e.HourlyRate IS NOT NULL;
PRINT 'Back-filled HourlyRateSnapshot for existing payroll rows';
GO

-- Verify
SELECT TOP 10
    p.ID,
    e.EmpName,
    p.WorkDate,
    p.ActualHours,
    p.HourlyRateSnapshot,
    p.DailyWage,
    p.Status
FROM dbo.TblEmpDailyPayroll p
INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
ORDER BY p.WorkDate DESC;
GO
