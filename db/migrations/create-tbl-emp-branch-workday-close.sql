-- ============================================================
-- Migration: TblEmpBranchWorkDayClose (Phase 1 — closing foundation)
-- Grain: one row per BranchID + WorkDate (employee payroll day lock).
-- No row ⇒ treat as OPEN in application code.
-- Does NOT alter TblEmpDailyPayroll.Status or TblNewDay.
-- Safe to re-run.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblEmpBranchWorkDayClose', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblEmpBranchWorkDayClose] (
        [ID]                 INT            IDENTITY(1,1) NOT NULL,
        [BranchID]           INT            NOT NULL,
        [WorkDate]           DATE           NOT NULL,
        [State]              NVARCHAR(20)   NOT NULL
            CONSTRAINT [DF_TblEmpBranchWorkDayClose_State] DEFAULT (N'OPEN'),
        [ClosedAt]           DATETIME2(0)   NULL,
        [ClosedByUserID]     INT            NULL,
        [ReopenedAt]         DATETIME2(0)   NULL,
        [ReopenedByUserID]   INT            NULL,
        [ReopenReason]       NVARCHAR(500)  NULL,
        [CreatedAt]          DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblEmpBranchWorkDayClose_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]          DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblEmpBranchWorkDayClose_UpdatedAt] DEFAULT (SYSUTCDATETIME()),
        [CreatedByUserID]    INT            NULL,
        [UpdatedByUserID]    INT            NULL,
        CONSTRAINT [PK_TblEmpBranchWorkDayClose] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [UQ_TblEmpBranchWorkDayClose_Branch_WorkDate]
            UNIQUE ([BranchID], [WorkDate]),
        CONSTRAINT [CK_TblEmpBranchWorkDayClose_State] CHECK ([State] IN (
            N'OPEN',
            N'NEEDS_REVIEW',
            N'READY_TO_CLOSE',
            N'CLOSED',
            N'REOPENED'
        )),
        CONSTRAINT [FK_TblEmpBranchWorkDayClose_BranchID]
            FOREIGN KEY ([BranchID]) REFERENCES [dbo].[TblBranch] ([BranchID]),
        CONSTRAINT [FK_TblEmpBranchWorkDayClose_ClosedByUserID]
            FOREIGN KEY ([ClosedByUserID]) REFERENCES [dbo].[TblUser] ([UserID]),
        CONSTRAINT [FK_TblEmpBranchWorkDayClose_ReopenedByUserID]
            FOREIGN KEY ([ReopenedByUserID]) REFERENCES [dbo].[TblUser] ([UserID]),
        CONSTRAINT [FK_TblEmpBranchWorkDayClose_CreatedByUserID]
            FOREIGN KEY ([CreatedByUserID]) REFERENCES [dbo].[TblUser] ([UserID]),
        CONSTRAINT [FK_TblEmpBranchWorkDayClose_UpdatedByUserID]
            FOREIGN KEY ([UpdatedByUserID]) REFERENCES [dbo].[TblUser] ([UserID])
    );
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.TblEmpBranchWorkDayClose')
      AND name = N'IX_TblEmpBranchWorkDayClose_State_WorkDate'
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpBranchWorkDayClose_State_WorkDate]
        ON [dbo].[TblEmpBranchWorkDayClose] ([State], [WorkDate])
        INCLUDE ([BranchID]);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.TblEmpBranchWorkDayClose')
      AND name = N'IX_TblEmpBranchWorkDayClose_WorkDate'
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpBranchWorkDayClose_WorkDate]
        ON [dbo].[TblEmpBranchWorkDayClose] ([WorkDate])
        INCLUDE ([BranchID], [State]);
END
GO

PRINT 'TblEmpBranchWorkDayClose ready.';
GO
