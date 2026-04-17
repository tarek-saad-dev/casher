-- =============================================
-- Update TblExpCatEmpMap to Support Revenue Transactions
-- =============================================

-- Drop the old CHECK constraint
ALTER TABLE [dbo].[TblExpCatEmpMap]
DROP CONSTRAINT [CHK_ExpCatEmpMap_TxnKind];

-- Add new CHECK constraint that allows 'advance', 'deduction', and 'revenue'
ALTER TABLE [dbo].[TblExpCatEmpMap]
ADD CONSTRAINT [CHK_ExpCatEmpMap_TxnKind] 
CHECK ([TxnKind] IN (N'advance', N'deduction', N'revenue'));

PRINT 'TxnKind constraint updated successfully to support revenue transactions';
