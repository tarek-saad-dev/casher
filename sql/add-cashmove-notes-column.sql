-- Add Notes column to TblCashMove table
-- This column is required by stored procedures and triggers for staff expense distribution

IF NOT EXISTS (
    SELECT 1 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'TblCashMove' 
    AND COLUMN_NAME = 'Notes'
)
BEGIN
    ALTER TABLE [dbo].[TblCashMove]
    ADD [Notes] NVARCHAR(MAX) NULL;
    
    PRINT 'Notes column added to TblCashMove successfully.';
END
ELSE
BEGIN
    PRINT 'Notes column already exists in TblCashMove.';
END
GO

-- Verify the column was added
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'TblCashMove'
ORDER BY ORDINAL_POSITION;
