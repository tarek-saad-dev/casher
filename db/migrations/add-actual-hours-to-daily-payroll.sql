-- ============================================================
-- Migration: Add ActualHours column to TblEmpDailyPayroll
-- Run once against the database.
-- ============================================================

-- 1. Add ActualHours column (decimal hours actually worked that day)
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TblEmpDailyPayroll' AND COLUMN_NAME = 'ActualHours'
)
BEGIN
    ALTER TABLE [dbo].[TblEmpDailyPayroll]
    ADD [ActualHours] DECIMAL(5, 2) NULL;
    PRINT 'Added ActualHours to TblEmpDailyPayroll';
END
ELSE
    PRINT 'ActualHours already exists in TblEmpDailyPayroll';
GO

-- 2. Back-fill ActualHours for existing rows that have CheckIn/CheckOut in TblEmpAttendance
--    Supports midnight crossover (e.g. CheckIn=19:30, CheckOut=01:00 next day)
UPDATE p
SET p.ActualHours = CAST(
    CASE
        WHEN a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL
        THEN
            CASE
                WHEN a.CheckOutTime >= a.CheckInTime
                THEN DATEDIFF(MINUTE, a.CheckInTime, a.CheckOutTime) / 60.0
                ELSE (DATEDIFF(MINUTE, a.CheckInTime, '23:59:59') + DATEDIFF(MINUTE, '00:00:00', a.CheckOutTime) + 1) / 60.0
            END
        ELSE NULL
    END
AS DECIMAL(5,2))
FROM dbo.TblEmpDailyPayroll p
INNER JOIN dbo.TblEmpAttendance a ON a.ID = p.AttendanceID
WHERE p.ActualHours IS NULL;
PRINT 'Back-filled ActualHours for existing payroll rows';
GO

-- Verify
SELECT TOP 20
    p.ID,
    e.EmpName,
    p.WorkDate,
    CONVERT(VARCHAR(5), a.CheckInTime,  108) AS CheckIn,
    CONVERT(VARCHAR(5), a.CheckOutTime, 108) AS CheckOut,
    p.ActualHours,
    p.DailyWage
FROM dbo.TblEmpDailyPayroll p
INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
LEFT  JOIN dbo.TblEmpAttendance a ON a.ID = p.AttendanceID
ORDER BY p.WorkDate DESC, e.EmpName;
GO
