-- ============================================================
-- Add ImageUrl column to TblPro for service/product thumbnails
-- Idempotent — safe to run multiple times
-- ============================================================

IF COL_LENGTH(N'dbo.TblPro', N'ImageUrl') IS NULL
BEGIN
    ALTER TABLE dbo.TblPro
    ADD ImageUrl NVARCHAR(1000) NULL;
    PRINT 'Added: TblPro.ImageUrl';
END
ELSE
    PRINT 'Exists: TblPro.ImageUrl';
GO

PRINT '============================================================';
GO
