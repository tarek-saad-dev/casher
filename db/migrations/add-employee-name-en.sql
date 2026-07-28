-- ============================================================
-- Add EmpNameEn column to TblEmp for bilingual public booking names
-- Idempotent
-- ============================================================

IF COL_LENGTH(N'dbo.TblEmp', N'EmpNameEn') IS NULL
BEGIN
    ALTER TABLE dbo.TblEmp
    ADD EmpNameEn NVARCHAR(200) NULL;
    PRINT 'Added: TblEmp.EmpNameEn';
END
ELSE
    PRINT 'Exists: TblEmp.EmpNameEn';
GO
