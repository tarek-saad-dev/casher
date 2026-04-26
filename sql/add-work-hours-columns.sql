-- Add work hours columns to TblEmp table
-- This migration is idempotent and can be run multiple times

-- Add DefaultCheckInTime column if not exists
IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'TblEmp'
      AND COLUMN_NAME = 'DefaultCheckInTime'
)
BEGIN
    ALTER TABLE dbo.TblEmp ADD DefaultCheckInTime TIME NULL;
    PRINT 'Added DefaultCheckInTime column to TblEmp';
END
ELSE
BEGIN
    PRINT 'DefaultCheckInTime column already exists in TblEmp';
END

-- Add DefaultCheckOutTime column if not exists
IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'TblEmp'
      AND COLUMN_NAME = 'DefaultCheckOutTime'
)
BEGIN
    ALTER TABLE dbo.TblEmp ADD DefaultCheckOutTime TIME NULL;
    PRINT 'Added DefaultCheckOutTime column to TblEmp';
END
ELSE
BEGIN
    PRINT 'DefaultCheckOutTime column already exists in TblEmp';
END

-- Add WorkScheduleNotes column if not exists
IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'TblEmp'
      AND COLUMN_NAME = 'WorkScheduleNotes'
)
BEGIN
    ALTER TABLE dbo.TblEmp ADD WorkScheduleNotes NVARCHAR(250) NULL;
    PRINT 'Added WorkScheduleNotes column to TblEmp';
END
ELSE
BEGIN
    PRINT 'WorkScheduleNotes column already exists in TblEmp';
END

-- Backfill with default values for active employees
UPDATE dbo.TblEmp
SET DefaultCheckInTime = ISNULL(DefaultCheckInTime, '12:00'),
    DefaultCheckOutTime = ISNULL(DefaultCheckOutTime, '02:00')
WHERE ISNULL(isActive, 1) = 1
  AND (DefaultCheckInTime IS NULL OR DefaultCheckOutTime IS NULL);

PRINT 'Backfilled default work hours for active employees';

-- Verify the columns were added successfully
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = 'TblEmp'
  AND COLUMN_NAME IN ('DefaultCheckInTime', 'DefaultCheckOutTime', 'WorkScheduleNotes')
ORDER BY COLUMN_NAME;

PRINT 'Work hours migration completed successfully';
