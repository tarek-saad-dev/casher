-- =============================================
-- Treasury Close Reconciliation Table
-- Purpose: Store end-of-day manual count reconciliation
-- =============================================

-- Check if table exists, drop if needed (for development only)
IF OBJECT_ID(N'dbo.TblTreasuryCloseRecon', N'U') IS NOT NULL
BEGIN
    PRINT 'Dropping existing TblTreasuryCloseRecon table...';
    DROP TABLE [dbo].[TblTreasuryCloseRecon];
END
GO

-- Create the reconciliation table
CREATE TABLE [dbo].[TblTreasuryCloseRecon] (
    [ID] INT IDENTITY(1,1) NOT NULL,
    [NewDay] INT NOT NULL,
    [ShiftMoveID] INT NULL,
    [PaymentMethodID] INT NOT NULL,
    [SystemAmount] DECIMAL(18,2) NOT NULL,
    [CountedAmount] DECIMAL(18,2) NOT NULL,
    [VarianceAmount] AS ([CountedAmount] - [SystemAmount]) PERSISTED,
    [Notes] NVARCHAR(500) NULL,
    [ClosedByUserID] INT NOT NULL,
    [ClosedAt] DATETIME NOT NULL DEFAULT GETDATE(),
    [IsActive] BIT NOT NULL DEFAULT 1,
    
    CONSTRAINT [PK_TreasuryCloseRecon] PRIMARY KEY CLUSTERED ([ID] ASC),
    
    CONSTRAINT [FK_TreasuryCloseRecon_NewDay] 
        FOREIGN KEY ([NewDay]) 
        REFERENCES [dbo].[TblNewDay]([NewDay]),
    
    CONSTRAINT [FK_TreasuryCloseRecon_ShiftMove] 
        FOREIGN KEY ([ShiftMoveID]) 
        REFERENCES [dbo].[TblShiftMove]([ShiftMoveID]),
    
    CONSTRAINT [FK_TreasuryCloseRecon_PaymentMethod] 
        FOREIGN KEY ([PaymentMethodID]) 
        REFERENCES [dbo].[TblPaymentMethods]([PaymentMethodID]),
    
    CONSTRAINT [FK_TreasuryCloseRecon_User] 
        FOREIGN KEY ([ClosedByUserID]) 
        REFERENCES [dbo].[TblUser]([UserID])
);
GO

-- Create indexes for performance
CREATE NONCLUSTERED INDEX [IX_TreasuryCloseRecon_NewDay] 
    ON [dbo].[TblTreasuryCloseRecon]([NewDay] ASC);
GO

CREATE NONCLUSTERED INDEX [IX_TreasuryCloseRecon_ShiftMove] 
    ON [dbo].[TblTreasuryCloseRecon]([ShiftMoveID] ASC);
GO

CREATE NONCLUSTERED INDEX [IX_TreasuryCloseRecon_PaymentMethod] 
    ON [dbo].[TblTreasuryCloseRecon]([PaymentMethodID] ASC);
GO

CREATE NONCLUSTERED INDEX [IX_TreasuryCloseRecon_ClosedAt] 
    ON [dbo].[TblTreasuryCloseRecon]([ClosedAt] DESC);
GO

PRINT 'TblTreasuryCloseRecon table created successfully!';
GO

-- Sample query to verify structure
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'TblTreasuryCloseRecon'
ORDER BY ORDINAL_POSITION;
GO
