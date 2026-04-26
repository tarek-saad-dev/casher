-- Fix PersonalNotes column issue
-- Add PersonalNotes column if it doesn't exist

PRINT N'Fixing PersonalNotes column...';

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'PersonalNotes'
)
BEGIN
    PRINT N'Adding PersonalNotes column to TblEmp';
    ALTER TABLE dbo.TblEmp ADD PersonalNotes NVARCHAR(500) NULL;
    PRINT N'PersonalNotes column added successfully';
END
ELSE
BEGIN
    PRINT N'PersonalNotes column already exists in TblEmp';
END

-- Verify the column was added
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'TblEmp' 
  AND COLUMN_NAME = 'PersonalNotes';

PRINT N'PersonalNotes column fix completed!';
