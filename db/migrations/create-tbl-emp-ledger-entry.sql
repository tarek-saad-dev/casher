-- ============================================================
-- Migration: Create TblEmpLedgerEntry (Employee Ledger — Phase 1)
-- Safe to re-run: creates table, constraints, and indexes idempotently.
-- ============================================================
SET NOCOUNT ON;

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TblEmpLedgerEntry'
)
BEGIN
    CREATE TABLE [dbo].[TblEmpLedgerEntry] (
        [ID]              INT             IDENTITY(1,1) NOT NULL,
        [EmpID]           INT             NOT NULL,
        [EntryDate]       DATE            NOT NULL,
        [EntryDirection]  NVARCHAR(10)    NOT NULL,
        [EntryReason]     NVARCHAR(40)    NOT NULL,
        [Amount]          DECIMAL(12, 2)  NOT NULL,
        [PayrollMonth]    NVARCHAR(7)     NULL,
        [RefType]         NVARCHAR(80)    NULL,
        [RefID]           INT             NULL,
        [CashMoveID]      INT             NULL,
        [AttendanceID]    INT             NULL,
        [Notes]           NVARCHAR(500)   NULL,
        [IsVoided]        BIT             NOT NULL CONSTRAINT DF_TblEmpLedgerEntry_IsVoided DEFAULT (0),
        [VoidReason]      NVARCHAR(500)   NULL,
        [CreatedByUserID] INT             NULL,
        [CreatedAt]       DATETIME2(0)    NOT NULL CONSTRAINT DF_TblEmpLedgerEntry_CreatedAt DEFAULT (SYSDATETIME()),
        [UpdatedAt]       DATETIME2(0)    NULL,
        CONSTRAINT [PK_TblEmpLedgerEntry] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [FK_TblEmpLedgerEntry_EmpID] FOREIGN KEY ([EmpID])
            REFERENCES [dbo].[TblEmp] ([EmpID]),
        CONSTRAINT [FK_TblEmpLedgerEntry_CashMoveID] FOREIGN KEY ([CashMoveID])
            REFERENCES [dbo].[TblCashMove] ([ID]),
        CONSTRAINT [CK_TblEmpLedgerEntry_EntryDirection] CHECK ([EntryDirection] IN (N'credit', N'debit')),
        CONSTRAINT [CK_TblEmpLedgerEntry_EntryReason] CHECK ([EntryReason] IN (
            N'hourly_wage', N'monthly_salary', N'target', N'commission', N'bonus',
            N'advance', N'payout', N'deduction', N'settlement', N'adjustment',
            N'employee_funding'
        )),
        CONSTRAINT [CK_TblEmpLedgerEntry_Amount_Positive] CHECK ([Amount] > 0)
    );
    PRINT 'Created TblEmpLedgerEntry';
END
ELSE
    PRINT 'TblEmpLedgerEntry already exists';
GO

-- ── Indexes (idempotent) ────────────────────────────────────────────────────

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_TblEmpLedgerEntry_EmpID_EntryDate'
      AND object_id = OBJECT_ID('dbo.TblEmpLedgerEntry')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpLedgerEntry_EmpID_EntryDate]
        ON [dbo].[TblEmpLedgerEntry] ([EmpID], [EntryDate] DESC)
        INCLUDE ([EntryDirection], [EntryReason], [Amount], [IsVoided], [PayrollMonth]);
    PRINT 'Created IX_TblEmpLedgerEntry_EmpID_EntryDate';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_TblEmpLedgerEntry_PayrollMonth'
      AND object_id = OBJECT_ID('dbo.TblEmpLedgerEntry')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpLedgerEntry_PayrollMonth]
        ON [dbo].[TblEmpLedgerEntry] ([PayrollMonth])
        INCLUDE ([EmpID], [EntryDirection], [EntryReason], [Amount], [IsVoided])
        WHERE [PayrollMonth] IS NOT NULL;
    PRINT 'Created IX_TblEmpLedgerEntry_PayrollMonth';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_TblEmpLedgerEntry_EntryReason'
      AND object_id = OBJECT_ID('dbo.TblEmpLedgerEntry')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpLedgerEntry_EntryReason]
        ON [dbo].[TblEmpLedgerEntry] ([EntryReason])
        INCLUDE ([EmpID], [EntryDate], [EntryDirection], [Amount], [IsVoided]);
    PRINT 'Created IX_TblEmpLedgerEntry_EntryReason';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_TblEmpLedgerEntry_CashMoveID'
      AND object_id = OBJECT_ID('dbo.TblEmpLedgerEntry')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpLedgerEntry_CashMoveID]
        ON [dbo].[TblEmpLedgerEntry] ([CashMoveID])
        WHERE [CashMoveID] IS NOT NULL;
    PRINT 'Created IX_TblEmpLedgerEntry_CashMoveID';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_TblEmpLedgerEntry_RefType_RefID'
      AND object_id = OBJECT_ID('dbo.TblEmpLedgerEntry')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpLedgerEntry_RefType_RefID]
        ON [dbo].[TblEmpLedgerEntry] ([RefType], [RefID])
        WHERE [RefType] IS NOT NULL AND [RefID] IS NOT NULL;
    PRINT 'Created IX_TblEmpLedgerEntry_RefType_RefID';
END
GO

PRINT 'TblEmpLedgerEntry migration complete';
GO
