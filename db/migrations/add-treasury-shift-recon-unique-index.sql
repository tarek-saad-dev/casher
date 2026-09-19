-- Unique shift-level treasury reconciliation: one row per (ShiftMoveID, PaymentMethodID)
-- Day-level recon keeps ShiftMoveID NULL and is unaffected by this filtered index.

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_TblTreasuryCloseRecon_Shift_Payment'
      AND object_id = OBJECT_ID(N'dbo.TblTreasuryCloseRecon')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblTreasuryCloseRecon_Shift_Payment]
        ON [dbo].[TblTreasuryCloseRecon] ([ShiftMoveID], [PaymentMethodID])
        WHERE [ShiftMoveID] IS NOT NULL;
    PRINT N'Created UX_TblTreasuryCloseRecon_Shift_Payment';
END
ELSE
BEGIN
    PRINT N'UX_TblTreasuryCloseRecon_Shift_Payment already exists';
END
GO
