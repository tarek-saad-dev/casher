-- ============================================================
-- Migration: Unique active ledger entry per payroll reference
-- Prevents duplicate non-voided entries for RefType + RefID + EntryReason
-- ============================================================
SET NOCOUNT ON;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_TblEmpLedgerEntry_ActiveRefReason'
      AND object_id = OBJECT_ID('dbo.TblEmpLedgerEntry')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblEmpLedgerEntry_ActiveRefReason]
        ON [dbo].[TblEmpLedgerEntry] ([RefType], [RefID], [EntryReason])
        WHERE [IsVoided] = 0
          AND [RefType] IS NOT NULL
          AND [RefID] IS NOT NULL;
    PRINT 'Created UX_TblEmpLedgerEntry_ActiveRefReason';
END
ELSE
    PRINT 'UX_TblEmpLedgerEntry_ActiveRefReason already exists';
GO
