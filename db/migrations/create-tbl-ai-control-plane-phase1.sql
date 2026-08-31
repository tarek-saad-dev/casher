-- ============================================================
-- Migration: CUT AI Control Plane Phase 1
-- Idempotent. Safe to re-run.
-- Learning registry ONLY — no runtime compilation in Phase 1.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblAiLearningSubmission', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblAiLearningSubmission] (
        [SubmissionID]          BIGINT         IDENTITY(1,1) NOT NULL,
        [RawInput]              NVARCHAR(4000) NOT NULL,
        [SourceType]            NVARCHAR(40)   NOT NULL,
        [SubmittedByUserID]     INT            NOT NULL,
        [ContextJson]           NVARCHAR(MAX)  NULL,
        [Status]                NVARCHAR(30)   NOT NULL,
        [InterpreterVersion]    NVARCHAR(60)   NULL,
        [ModelName]             NVARCHAR(120)  NULL,
        [CreatedAt]             DATETIME2(3)   NOT NULL
            CONSTRAINT [DF_TblAiLearningSubmission_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]             DATETIME2(3)   NOT NULL
            CONSTRAINT [DF_TblAiLearningSubmission_UpdatedAt] DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT [PK_TblAiLearningSubmission] PRIMARY KEY CLUSTERED ([SubmissionID])
    );
    PRINT N'Created TblAiLearningSubmission';
END
ELSE PRINT N'TblAiLearningSubmission already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TblAiLearningSubmission_Status' AND object_id = OBJECT_ID(N'dbo.TblAiLearningSubmission'))
    CREATE NONCLUSTERED INDEX [IX_TblAiLearningSubmission_Status] ON [dbo].[TblAiLearningSubmission] ([Status], [CreatedAt] DESC);
GO

IF OBJECT_ID(N'dbo.TblAiLearningArtifact', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblAiLearningArtifact] (
        [ArtifactID]            BIGINT         IDENTITY(1,1) NOT NULL,
        [SubmissionID]          BIGINT         NOT NULL,
        [ArtifactType]          NVARCHAR(40)   NOT NULL,
        [Domain]                NVARCHAR(40)   NOT NULL,
        [ScopeType]             NVARCHAR(30)   NOT NULL,
        [ScopeKey]              NVARCHAR(200)  NULL,
        [TargetLayer]           NVARCHAR(40)   NOT NULL,
        [EntityType]            NVARCHAR(20)   NULL,
        [EntityID]              INT            NULL,
        [EntityCode]            NVARCHAR(80)   NULL,
        [TopicKey]              NVARCHAR(200)  NOT NULL,
        [NormalizedKey]         NVARCHAR(300)  NOT NULL,
        [Title]                 NVARCHAR(300)  NOT NULL,
        [Summary]               NVARCHAR(1000) NOT NULL,
        [StructuredPayloadJson] NVARCHAR(MAX)  NOT NULL,
        [AuthorityClass]        NVARCHAR(40)   NOT NULL,
        [Priority]              INT            NOT NULL CONSTRAINT [DF_TblAiLearningArtifact_Priority] DEFAULT (100),
        [Confidence]            DECIMAL(5,4)   NOT NULL CONSTRAINT [DF_TblAiLearningArtifact_Confidence] DEFAULT (0),
        [Status]                NVARCHAR(30)   NOT NULL,
        [Version]               INT            NOT NULL CONSTRAINT [DF_TblAiLearningArtifact_Version] DEFAULT (1),
        [SupersedesArtifactID]  BIGINT         NULL,
        [EffectiveFrom]         DATETIME2(3)   NULL,
        [EffectiveUntil]        DATETIME2(3)   NULL,
        [CreatedByUserID]       INT            NOT NULL,
        [ApprovedByUserID]      INT            NULL,
        [ApprovedAt]            DATETIME2(3)   NULL,
        [CreatedAt]             DATETIME2(3)   NOT NULL CONSTRAINT [DF_TblAiLearningArtifact_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]             DATETIME2(3)   NOT NULL CONSTRAINT [DF_TblAiLearningArtifact_UpdatedAt] DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT [PK_TblAiLearningArtifact] PRIMARY KEY CLUSTERED ([ArtifactID]),
        CONSTRAINT [FK_TblAiLearningArtifact_Submission] FOREIGN KEY ([SubmissionID]) REFERENCES [dbo].[TblAiLearningSubmission]([SubmissionID])
    );
    PRINT N'Created TblAiLearningArtifact';
END
ELSE PRINT N'TblAiLearningArtifact already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TblAiLearningArtifact_NormalizedKey' AND object_id = OBJECT_ID(N'dbo.TblAiLearningArtifact'))
    CREATE NONCLUSTERED INDEX [IX_TblAiLearningArtifact_NormalizedKey] ON [dbo].[TblAiLearningArtifact] ([NormalizedKey], [Status], [EntityCode]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TblAiLearningArtifact_Submission' AND object_id = OBJECT_ID(N'dbo.TblAiLearningArtifact'))
    CREATE NONCLUSTERED INDEX [IX_TblAiLearningArtifact_Submission] ON [dbo].[TblAiLearningArtifact] ([SubmissionID], [Status]);
GO

IF OBJECT_ID(N'dbo.TblAiLearningConflict', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblAiLearningConflict] (
        [ConflictID]            BIGINT         IDENTITY(1,1) NOT NULL,
        [SubmissionID]          BIGINT         NOT NULL,
        [ArtifactIndex]         INT            NOT NULL,
        [ConflictType]          NVARCHAR(40)   NOT NULL,
        [MessageAr]             NVARCHAR(1000) NOT NULL,
        [ExistingArtifactID]    BIGINT         NULL,
        [DetailsJson]           NVARCHAR(MAX)  NULL,
        [CreatedAt]             DATETIME2(3)   NOT NULL CONSTRAINT [DF_TblAiLearningConflict_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT [PK_TblAiLearningConflict] PRIMARY KEY CLUSTERED ([ConflictID]),
        CONSTRAINT [FK_TblAiLearningConflict_Submission] FOREIGN KEY ([SubmissionID]) REFERENCES [dbo].[TblAiLearningSubmission]([SubmissionID])
    );
    PRINT N'Created TblAiLearningConflict';
END
ELSE PRINT N'TblAiLearningConflict already exists';
GO

IF OBJECT_ID(N'dbo.TblAiLearningAuditEvent', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblAiLearningAuditEvent] (
        [EventID]               BIGINT         IDENTITY(1,1) NOT NULL,
        [SubmissionID]          BIGINT         NULL,
        [ArtifactID]            BIGINT         NULL,
        [EventType]             NVARCHAR(60)   NOT NULL,
        [ActorUserID]           INT            NULL,
        [ModelName]             NVARCHAR(120)  NULL,
        [DetailsJson]           NVARCHAR(MAX)  NULL,
        [CreatedAt]             DATETIME2(3)   NOT NULL CONSTRAINT [DF_TblAiLearningAuditEvent_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT [PK_TblAiLearningAuditEvent] PRIMARY KEY CLUSTERED ([EventID])
    );
    PRINT N'Created TblAiLearningAuditEvent';
END
ELSE PRINT N'TblAiLearningAuditEvent already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TblAiLearningAuditEvent_Submission' AND object_id = OBJECT_ID(N'dbo.TblAiLearningAuditEvent'))
    CREATE NONCLUSTERED INDEX [IX_TblAiLearningAuditEvent_Submission] ON [dbo].[TblAiLearningAuditEvent] ([SubmissionID], [CreatedAt] DESC);
GO
