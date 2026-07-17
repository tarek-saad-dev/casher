-- ============================================================
-- Migration: Add tip EntryReason to TblEmpLedgerEntry
-- Safe to re-run.
-- ============================================================
SET NOCOUNT ON;

IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_TblEmpLedgerEntry_EntryReason'
      AND parent_object_id = OBJECT_ID('dbo.TblEmpLedgerEntry')
)
BEGIN
    ALTER TABLE [dbo].[TblEmpLedgerEntry] DROP CONSTRAINT [CK_TblEmpLedgerEntry_EntryReason];
    PRINT 'Dropped CK_TblEmpLedgerEntry_EntryReason';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_TblEmpLedgerEntry_EntryReason'
      AND parent_object_id = OBJECT_ID('dbo.TblEmpLedgerEntry')
)
BEGIN
    ALTER TABLE [dbo].[TblEmpLedgerEntry] WITH CHECK ADD CONSTRAINT [CK_TblEmpLedgerEntry_EntryReason]
        CHECK ([EntryReason] IN (
            N'hourly_wage', N'monthly_salary', N'target', N'commission', N'bonus',
            N'advance', N'payout', N'deduction', N'settlement', N'adjustment',
            N'employee_funding', N'tip'
        ));
    PRINT 'Created CK_TblEmpLedgerEntry_EntryReason with tip';
END
GO
