-- ============================================================
-- Add ImageUrl column to TblEmp for barber/employee photos
-- Idempotent — safe to run multiple times
-- ============================================================

IF COL_LENGTH(N'dbo.TblEmp', N'ImageUrl') IS NULL
BEGIN
    ALTER TABLE dbo.TblEmp
    ADD ImageUrl NVARCHAR(1000) NULL;
    PRINT 'Added: TblEmp.ImageUrl';
END
ELSE
    PRINT 'Exists: TblEmp.ImageUrl';
GO

PRINT '============================================================';
GO
