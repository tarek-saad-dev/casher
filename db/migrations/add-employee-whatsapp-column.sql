-- ============================================================
-- Migration: Add WhatsApp column to TblEmp for employee sale notifications
-- Run once against the database.
-- ============================================================

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'WhatsApp'
)
BEGIN
    ALTER TABLE [dbo].[TblEmp]
    ADD [WhatsApp] NVARCHAR(30) NULL;
    PRINT 'Added WhatsApp column to TblEmp';
END
ELSE
    PRINT 'WhatsApp already exists in TblEmp';
GO

-- Back-fill from Mobile where WhatsApp is empty (optional convenience)
UPDATE [dbo].[TblEmp]
SET [WhatsApp] = NULLIF(LTRIM(RTRIM([Mobile])), N'')
WHERE [WhatsApp] IS NULL
  AND [Mobile] IS NOT NULL
  AND LTRIM(RTRIM([Mobile])) <> N'';
GO

PRINT 'TblEmp WhatsApp migration complete';
