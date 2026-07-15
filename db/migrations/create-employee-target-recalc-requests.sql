-- ============================================================
-- Migration: TblEmpTargetRecalcRequest (Phase 5 durable enqueue)
-- Idempotent. No seed / no backfill.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblEmp', N'U') IS NULL
BEGIN
    RAISERROR(N'TblEmp غير موجودة.', 16, 1);
    RETURN;
END
GO

IF OBJECT_ID(N'dbo.TblEmpTargetRecalcRequest', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblEmpTargetRecalcRequest] (
        [ID]               INT            IDENTITY(1,1) NOT NULL,
        [EmpID]            INT            NOT NULL,
        [WorkDate]         DATE           NOT NULL,
        [Status]           NVARCHAR(20)   NOT NULL
            CONSTRAINT [DF_TblEmpTargetRecalcRequest_Status] DEFAULT (N'pending'),
        [RequestedVersion] INT            NOT NULL
            CONSTRAINT [DF_TblEmpTargetRecalcRequest_RequestedVersion] DEFAULT (1),
        [ProcessedVersion] INT            NOT NULL
            CONSTRAINT [DF_TblEmpTargetRecalcRequest_ProcessedVersion] DEFAULT (0),
        [AttemptCount]     INT            NOT NULL
            CONSTRAINT [DF_TblEmpTargetRecalcRequest_AttemptCount] DEFAULT (0),
        [LastReason]       NVARCHAR(100)  NULL,
        [SourceType]       NVARCHAR(50)   NULL,
        [SourceRef]        NVARCHAR(100)  NULL,
        [LastError]        NVARCHAR(1000) NULL,
        [RequestedAt]      DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblEmpTargetRecalcRequest_RequestedAt] DEFAULT (SYSDATETIME()),
        [ProcessingAt]     DATETIME2(0)   NULL,
        [ProcessedAt]      DATETIME2(0)   NULL,
        [CreatedAt]        DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblEmpTargetRecalcRequest_CreatedAt] DEFAULT (SYSDATETIME()),
        [UpdatedAt]        DATETIME2(0)   NULL,
        CONSTRAINT [PK_TblEmpTargetRecalcRequest] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [FK_TblEmpTargetRecalcRequest_EmpID] FOREIGN KEY ([EmpID])
            REFERENCES [dbo].[TblEmp] ([EmpID]),
        CONSTRAINT [CK_TblEmpTargetRecalcRequest_Status] CHECK ([Status] IN (
            N'pending', N'processing', N'completed', N'failed'
        )),
        CONSTRAINT [CK_TblEmpTargetRecalcRequest_RequestedVersion] CHECK ([RequestedVersion] >= 1),
        CONSTRAINT [CK_TblEmpTargetRecalcRequest_ProcessedVersion] CHECK ([ProcessedVersion] >= 0),
        CONSTRAINT [CK_TblEmpTargetRecalcRequest_AttemptCount] CHECK ([AttemptCount] >= 0)
    );
    PRINT N'Created TblEmpTargetRecalcRequest';
END
ELSE
    PRINT N'TblEmpTargetRecalcRequest already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblEmpTargetRecalcRequest_EmpID_WorkDate'
      AND object_id = OBJECT_ID(N'dbo.TblEmpTargetRecalcRequest')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblEmpTargetRecalcRequest_EmpID_WorkDate]
        ON [dbo].[TblEmpTargetRecalcRequest] ([EmpID], [WorkDate]);
    PRINT N'Created UX_TblEmpTargetRecalcRequest_EmpID_WorkDate';
END
ELSE
    PRINT N'UX_TblEmpTargetRecalcRequest_EmpID_WorkDate already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblEmpTargetRecalcRequest_Status_RequestedAt'
      AND object_id = OBJECT_ID(N'dbo.TblEmpTargetRecalcRequest')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpTargetRecalcRequest_Status_RequestedAt]
        ON [dbo].[TblEmpTargetRecalcRequest] ([Status], [RequestedAt]);
    PRINT N'Created IX_TblEmpTargetRecalcRequest_Status_RequestedAt';
END
ELSE
    PRINT N'IX_TblEmpTargetRecalcRequest_Status_RequestedAt already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblEmpTargetRecalcRequest_WorkDate'
      AND object_id = OBJECT_ID(N'dbo.TblEmpTargetRecalcRequest')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpTargetRecalcRequest_WorkDate]
        ON [dbo].[TblEmpTargetRecalcRequest] ([WorkDate]);
    PRINT N'Created IX_TblEmpTargetRecalcRequest_WorkDate';
END
ELSE
    PRINT N'IX_TblEmpTargetRecalcRequest_WorkDate already exists';
GO

PRINT N'TblEmpTargetRecalcRequest migration complete.';
GO
