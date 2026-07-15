-- ============================================================
-- Migration: Employee Daily Target System (Phase 1 foundation)
-- Creates TblEmpTargetPlan / TblEmpTargetTier / TblEmpDailyTarget
-- Idempotent. Does NOT seed plans, touch legacy Target* columns,
-- write ledger entries, or write CashMove rows.
-- ============================================================
SET NOCOUNT ON;

-- ── 1) TblEmpTargetPlan ─────────────────────────────────────────────────────

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TblEmpTargetPlan'
)
BEGIN
    CREATE TABLE [dbo].[TblEmpTargetPlan] (
        [ID]              INT             IDENTITY(1,1) NOT NULL,
        [EmpID]           INT             NOT NULL,
        [IsEnabled]       BIT             NOT NULL
            CONSTRAINT [DF_TblEmpTargetPlan_IsEnabled] DEFAULT (1),
        [InputBasis]      NVARCHAR(10)    NOT NULL,
        [ConversionDays]  INT             NOT NULL
            CONSTRAINT [DF_TblEmpTargetPlan_ConversionDays] DEFAULT (26),
        [EffectiveFrom]   DATE            NOT NULL,
        [EffectiveTo]     DATE            NULL,
        [Notes]           NVARCHAR(500)   NULL,
        [CreatedByUserID] INT             NULL,
        [UpdatedByUserID] INT             NULL,
        [CreatedAt]       DATETIME2(0)    NOT NULL
            CONSTRAINT [DF_TblEmpTargetPlan_CreatedAt] DEFAULT (SYSDATETIME()),
        [UpdatedAt]       DATETIME2(0)    NULL,
        CONSTRAINT [PK_TblEmpTargetPlan] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [FK_TblEmpTargetPlan_EmpID] FOREIGN KEY ([EmpID])
            REFERENCES [dbo].[TblEmp] ([EmpID]),
        CONSTRAINT [FK_TblEmpTargetPlan_CreatedByUserID] FOREIGN KEY ([CreatedByUserID])
            REFERENCES [dbo].[TblUser] ([UserID]),
        CONSTRAINT [FK_TblEmpTargetPlan_UpdatedByUserID] FOREIGN KEY ([UpdatedByUserID])
            REFERENCES [dbo].[TblUser] ([UserID]),
        CONSTRAINT [CK_TblEmpTargetPlan_InputBasis]
            CHECK ([InputBasis] IN (N'monthly', N'daily')),
        CONSTRAINT [CK_TblEmpTargetPlan_ConversionDays]
            CHECK ([ConversionDays] BETWEEN 1 AND 31),
        CONSTRAINT [CK_TblEmpTargetPlan_EffectiveRange]
            CHECK ([EffectiveTo] IS NULL OR [EffectiveTo] >= [EffectiveFrom])
    );
    PRINT 'Created TblEmpTargetPlan';
END
ELSE
    PRINT 'TblEmpTargetPlan already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_TblEmpTargetPlan_EmpID_Effective'
      AND object_id = OBJECT_ID('dbo.TblEmpTargetPlan')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpTargetPlan_EmpID_Effective]
        ON [dbo].[TblEmpTargetPlan] ([EmpID], [EffectiveFrom], [EffectiveTo])
        INCLUDE ([IsEnabled], [InputBasis], [ConversionDays]);
    PRINT 'Created IX_TblEmpTargetPlan_EmpID_Effective';
END
GO

-- ── 2) TblEmpTargetTier ─────────────────────────────────────────────────────

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TblEmpTargetTier'
)
BEGIN
    CREATE TABLE [dbo].[TblEmpTargetTier] (
        [ID]                INT             IDENTITY(1,1) NOT NULL,
        [TargetPlanID]      INT             NOT NULL,
        [InputStartAmount]  DECIMAL(18, 6)  NOT NULL,
        [DailyStartAmount]  DECIMAL(18, 6)  NOT NULL,
        [RatePercent]       DECIMAL(9, 6)   NOT NULL,
        [SortOrder]         INT             NOT NULL,
        [CreatedAt]         DATETIME2(0)    NOT NULL
            CONSTRAINT [DF_TblEmpTargetTier_CreatedAt] DEFAULT (SYSDATETIME()),
        CONSTRAINT [PK_TblEmpTargetTier] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [FK_TblEmpTargetTier_TargetPlanID] FOREIGN KEY ([TargetPlanID])
            REFERENCES [dbo].[TblEmpTargetPlan] ([ID]),
        CONSTRAINT [CK_TblEmpTargetTier_InputStartAmount]
            CHECK ([InputStartAmount] >= 0),
        CONSTRAINT [CK_TblEmpTargetTier_DailyStartAmount]
            CHECK ([DailyStartAmount] >= 0),
        CONSTRAINT [CK_TblEmpTargetTier_RatePercent]
            CHECK ([RatePercent] >= 0 AND [RatePercent] <= 100),
        CONSTRAINT [CK_TblEmpTargetTier_SortOrder]
            CHECK ([SortOrder] >= 1),
        CONSTRAINT [UQ_TblEmpTargetTier_Plan_SortOrder]
            UNIQUE ([TargetPlanID], [SortOrder]),
        CONSTRAINT [UQ_TblEmpTargetTier_Plan_DailyStart]
            UNIQUE ([TargetPlanID], [DailyStartAmount])
    );
    PRINT 'Created TblEmpTargetTier';
END
ELSE
    PRINT 'TblEmpTargetTier already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_TblEmpTargetTier_TargetPlanID'
      AND object_id = OBJECT_ID('dbo.TblEmpTargetTier')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpTargetTier_TargetPlanID]
        ON [dbo].[TblEmpTargetTier] ([TargetPlanID])
        INCLUDE ([DailyStartAmount], [RatePercent], [SortOrder]);
    PRINT 'Created IX_TblEmpTargetTier_TargetPlanID';
END
GO

-- ── 3) TblEmpDailyTarget ────────────────────────────────────────────────────

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TblEmpDailyTarget'
)
BEGIN
    CREATE TABLE [dbo].[TblEmpDailyTarget] (
        [ID]                     INT             IDENTITY(1,1) NOT NULL,
        [EmpID]                  INT             NOT NULL,
        [WorkDate]               DATE            NOT NULL,
        [TargetPlanID]           INT             NOT NULL,
        [NetSalesAfterDiscount]  DECIMAL(18, 2)  NOT NULL
            CONSTRAINT [DF_TblEmpDailyTarget_NetSales] DEFAULT (0),
        [TargetAmount]           DECIMAL(18, 2)  NOT NULL
            CONSTRAINT [DF_TblEmpDailyTarget_TargetAmount] DEFAULT (0),
        [CalculationBreakdownJson] NVARCHAR(MAX) NULL,
        [CalculationVersion]     NVARCHAR(20)    NOT NULL
            CONSTRAINT [DF_TblEmpDailyTarget_CalcVersion] DEFAULT (N'v1'),
        [Status]                 NVARCHAR(20)    NOT NULL
            CONSTRAINT [DF_TblEmpDailyTarget_Status] DEFAULT (N'generated'),
        [GeneratedByUserID]      INT             NULL,
        [GeneratedAt]            DATETIME2(0)    NOT NULL
            CONSTRAINT [DF_TblEmpDailyTarget_GeneratedAt] DEFAULT (SYSDATETIME()),
        [UpdatedAt]              DATETIME2(0)    NULL,
        CONSTRAINT [PK_TblEmpDailyTarget] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [FK_TblEmpDailyTarget_EmpID] FOREIGN KEY ([EmpID])
            REFERENCES [dbo].[TblEmp] ([EmpID]),
        CONSTRAINT [FK_TblEmpDailyTarget_TargetPlanID] FOREIGN KEY ([TargetPlanID])
            REFERENCES [dbo].[TblEmpTargetPlan] ([ID]),
        CONSTRAINT [FK_TblEmpDailyTarget_GeneratedByUserID] FOREIGN KEY ([GeneratedByUserID])
            REFERENCES [dbo].[TblUser] ([UserID]),
        CONSTRAINT [UQ_TblEmpDailyTarget_Emp_WorkDate]
            UNIQUE ([EmpID], [WorkDate]),
        CONSTRAINT [CK_TblEmpDailyTarget_NetSales]
            CHECK ([NetSalesAfterDiscount] >= 0),
        CONSTRAINT [CK_TblEmpDailyTarget_TargetAmount]
            CHECK ([TargetAmount] >= 0),
        CONSTRAINT [CK_TblEmpDailyTarget_Status]
            CHECK ([Status] IN (N'generated', N'recalculated', N'voided'))
    );
    PRINT 'Created TblEmpDailyTarget';
END
ELSE
    PRINT 'TblEmpDailyTarget already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_TblEmpDailyTarget_WorkDate'
      AND object_id = OBJECT_ID('dbo.TblEmpDailyTarget')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpDailyTarget_WorkDate]
        ON [dbo].[TblEmpDailyTarget] ([WorkDate])
        INCLUDE ([EmpID], [TargetAmount], [NetSalesAfterDiscount], [Status]);
    PRINT 'Created IX_TblEmpDailyTarget_WorkDate';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_TblEmpDailyTarget_TargetPlanID'
      AND object_id = OBJECT_ID('dbo.TblEmpDailyTarget')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpDailyTarget_TargetPlanID]
        ON [dbo].[TblEmpDailyTarget] ([TargetPlanID]);
    PRINT 'Created IX_TblEmpDailyTarget_TargetPlanID';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_TblEmpDailyTarget_EmpID'
      AND object_id = OBJECT_ID('dbo.TblEmpDailyTarget')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpDailyTarget_EmpID]
        ON [dbo].[TblEmpDailyTarget] ([EmpID], [WorkDate] DESC)
        INCLUDE ([TargetAmount], [Status], [TargetPlanID]);
    PRINT 'Created IX_TblEmpDailyTarget_EmpID';
END
GO

PRINT 'Employee daily target foundation migration complete (no data seeded).';
GO
