-- ============================================================
-- Phase 1G: Second-branch operational readiness schema
-- Adds uniqueness for BranchName + ShortName (when present).
-- Idempotent. Does NOT create a second branch.
-- Does NOT touch HR / payroll / attendance / ledger / targets.
-- ============================================================
SET NOCOUNT ON;
GO

-- Prevent duplicate public display names
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UQ_TblBranch_BranchName' AND object_id = OBJECT_ID(N'dbo.TblBranch')
)
BEGIN
    ALTER TABLE dbo.TblBranch
        ADD CONSTRAINT UQ_TblBranch_BranchName UNIQUE (BranchName);
    PRINT 'Created UQ_TblBranch_BranchName';
END
ELSE
    PRINT 'UQ_TblBranch_BranchName already exists';
GO

-- ShortName unique among non-null values (multiple NULLs allowed)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblBranch_ShortName_NotNull' AND object_id = OBJECT_ID(N'dbo.TblBranch')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_TblBranch_ShortName_NotNull
        ON dbo.TblBranch (ShortName)
        WHERE ShortName IS NOT NULL;
    PRINT 'Created UX_TblBranch_ShortName_NotNull';
END
ELSE
    PRINT 'UX_TblBranch_ShortName_NotNull already exists';
GO

PRINT 'Phase 1G branch uniqueness migration complete';
GO
