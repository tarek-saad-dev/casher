-- ============================================================
-- Migration: Add HourlyRate computed column + auto-update trigger
-- Run once against the database.
-- ============================================================

-- 1. Add HourlyRate column (persisted computed via trigger, stored as DECIMAL)
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'HourlyRate'
)
BEGIN
    ALTER TABLE [dbo].[TblEmp]
    ADD [HourlyRate] DECIMAL(10, 4) NULL;
    PRINT 'Added HourlyRate column to TblEmp';
END
ELSE
    PRINT 'HourlyRate already exists in TblEmp';
GO

-- 2. Back-fill HourlyRate for existing rows that already have Salary + work hours
--    Formula: DailyWage / WorkHoursPerDay
--    WorkHoursPerDay = DATEDIFF(minute, DefaultCheckInTime, DefaultCheckOutTime) / 60.0
UPDATE [dbo].[TblEmp]
SET HourlyRate = CASE
    WHEN DefaultCheckInTime IS NOT NULL
     AND DefaultCheckOutTime IS NOT NULL
     AND DefaultCheckOutTime > DefaultCheckInTime
     AND ISNULL(Salary, 0) > 0
    THEN CAST(Salary AS DECIMAL(10,4))
        / NULLIF(CAST(DATEDIFF(MINUTE, DefaultCheckInTime, DefaultCheckOutTime) AS DECIMAL(10,4)) / 60.0, 0)
    ELSE NULL
END
WHERE HourlyRate IS NULL;
PRINT 'Back-filled HourlyRate for existing employees';
GO

-- 3. Drop old trigger if exists (idempotent re-run)
IF OBJECT_ID('dbo.trg_TblEmp_CalcHourlyRate', 'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_TblEmp_CalcHourlyRate;
GO

-- 4. Create trigger: recalculates HourlyRate whenever Salary/DefaultCheckInTime/DefaultCheckOutTime changes
CREATE TRIGGER dbo.trg_TblEmp_CalcHourlyRate
ON dbo.TblEmp
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only fire when relevant columns changed
    IF NOT (
        UPDATE(Salary)
     OR UPDATE(BaseSalary)
     OR UPDATE(DefaultCheckInTime)
     OR UPDATE(DefaultCheckOutTime)
    )
        RETURN;

    UPDATE e
    SET e.HourlyRate = CASE
        WHEN i.DefaultCheckInTime  IS NOT NULL
         AND i.DefaultCheckOutTime IS NOT NULL
         AND i.DefaultCheckOutTime > i.DefaultCheckInTime
         AND ISNULL(i.Salary, 0)  > 0
        THEN CAST(i.Salary AS DECIMAL(10,4))
             / NULLIF(
                 CAST(DATEDIFF(MINUTE, i.DefaultCheckInTime, i.DefaultCheckOutTime) AS DECIMAL(10,4)) / 60.0,
               0)
        ELSE NULL
    END
    FROM dbo.TblEmp e
    INNER JOIN inserted i ON i.EmpID = e.EmpID;
END;
GO

PRINT 'Trigger trg_TblEmp_CalcHourlyRate created successfully';

-- 5. Verify
SELECT
    EmpID,
    EmpName,
    Salary                                                         AS DailyWage,
    CONVERT(VARCHAR(5), DefaultCheckInTime,  108)                  AS CheckIn,
    CONVERT(VARCHAR(5), DefaultCheckOutTime, 108)                  AS CheckOut,
    CAST(DATEDIFF(MINUTE, DefaultCheckInTime, DefaultCheckOutTime)
         AS DECIMAL(10,2)) / 60.0                                  AS WorkHoursPerDay,
    HourlyRate
FROM dbo.TblEmp
WHERE isActive = 1
ORDER BY EmpName;
GO
