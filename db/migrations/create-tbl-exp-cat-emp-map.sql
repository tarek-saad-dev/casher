-- =============================================
-- Migration: Create TblExpCatEmpMap
-- Purpose: Map expense categories to employees for advance tracking
-- Date: 2026-03-30
-- =============================================

-- Create the mapping table
CREATE TABLE [dbo].[TblExpCatEmpMap] (
    [ID] INT IDENTITY(1,1) PRIMARY KEY,
    [ExpINID] INT NOT NULL,                    -- FK to TblExpINCat (expense category)
    [EmpID] INT NOT NULL,                      -- FK to TblEmp (employee)
    [TxnKind] NVARCHAR(20) NOT NULL,          -- 'advance' or 'deduction'
    [IsActive] BIT NOT NULL DEFAULT 1,         -- soft delete flag
    [Notes] NVARCHAR(500) NULL,                -- optional notes for admin
    [CreatedDate] DATETIME NOT NULL DEFAULT GETDATE(),
    [ModifiedDate] DATETIME NOT NULL DEFAULT GETDATE(),
    
    -- Foreign key constraints
    CONSTRAINT [FK_ExpCatEmpMap_ExpINID] FOREIGN KEY ([ExpINID]) 
        REFERENCES [dbo].[TblExpINCat]([ExpINID]),
    CONSTRAINT [FK_ExpCatEmpMap_EmpID] FOREIGN KEY ([EmpID]) 
        REFERENCES [dbo].[TblEmp]([EmpID]),
    
    -- Check constraint for TxnKind
    CONSTRAINT [CHK_ExpCatEmpMap_TxnKind] CHECK ([TxnKind] IN (N'advance', N'deduction'))
);

-- Create indexes for performance
CREATE NONCLUSTERED INDEX [IX_ExpCatEmpMap_ExpINID] 
    ON [dbo].[TblExpCatEmpMap]([ExpINID]) 
    INCLUDE ([EmpID], [TxnKind], [IsActive]);

CREATE NONCLUSTERED INDEX [IX_ExpCatEmpMap_EmpID] 
    ON [dbo].[TblExpCatEmpMap]([EmpID]) 
    INCLUDE ([ExpINID], [TxnKind], [IsActive]);

CREATE NONCLUSTERED INDEX [IX_ExpCatEmpMap_Active] 
    ON [dbo].[TblExpCatEmpMap]([IsActive]) 
    WHERE [IsActive] = 1;

GO

-- =============================================
-- Sample data insertion (commented out - uncomment to use)
-- =============================================

/*
-- Example: Map advance categories to employees
-- Replace ExpINID and EmpID with actual values from your database

-- محمد's advance category
INSERT INTO [dbo].[TblExpCatEmpMap] ([ExpINID], [EmpID], [TxnKind], [Notes])
VALUES (123, 1, N'advance', N'سلفه ( محمد )');

-- هدى's advance category
INSERT INTO [dbo].[TblExpCatEmpMap] ([ExpINID], [EmpID], [TxnKind], [Notes])
VALUES (124, 2, N'advance', N'سلفه ( هدى )');

-- ذياد's advance category
INSERT INTO [dbo].[TblExpCatEmpMap] ([ExpINID], [EmpID], [TxnKind], [Notes])
VALUES (125, 3, N'advance', N'سلفه ( ذياد )');

-- كريم's advance category
INSERT INTO [dbo].[TblExpCatEmpMap] ([ExpINID], [EmpID], [TxnKind], [Notes])
VALUES (126, 4, N'advance', N'سلفة(كريم)');
*/

GO

PRINT 'TblExpCatEmpMap table created successfully';
