-- ============================================================
-- Add Edit History Tracking to TblCashMove
-- ============================================================
-- This migration adds a new column to track edit history
-- Each edit will be recorded with timestamp and user info

USE [HawaiDB];
GO

-- Check if column already exists
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'TblCashMove' 
    AND COLUMN_NAME = 'EditHistory'
)
BEGIN
    -- Add EditHistory column as NVARCHAR(MAX) to store JSON array
    ALTER TABLE [dbo].[TblCashMove]
    ADD [EditHistory] NVARCHAR(MAX) NULL;
    
    PRINT 'EditHistory column added to TblCashMove';
END
ELSE
BEGIN
    PRINT 'EditHistory column already exists in TblCashMove';
END
GO

-- Create index for better performance on queries filtering by edit history
IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE name = 'IX_TblCashMove_EditHistory' 
    AND object_id = OBJECT_ID('TblCashMove')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblCashMove_EditHistory]
    ON [dbo].[TblCashMove] ([EditHistory])
    WHERE [EditHistory] IS NOT NULL;
    
    PRINT 'Index IX_TblCashMove_EditHistory created';
END
ELSE
BEGIN
    PRINT 'Index IX_TblCashMove_EditHistory already exists';
END
GO

PRINT '============================================================';
PRINT 'Migration completed successfully!';
PRINT 'TblCashMove now supports edit history tracking';
PRINT '============================================================';
GO
