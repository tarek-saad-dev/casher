-- ============================================================
-- Additive V1.1: Voice examples, knowledge sources, extra indexes/columns.
-- Idempotent. No DROP. Safe to re-run after create-tbl-salon-concierge.sql.
-- ============================================================
SET NOCOUNT ON;

-- Voice examples (style only — never business truth)
IF OBJECT_ID(N'dbo.TblSalonBrandVoiceExample', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblSalonBrandVoiceExample] (
        [ExampleID]             BIGINT         IDENTITY(1,1) NOT NULL,
        [ScenarioKey]           NVARCHAR(120)  NOT NULL,
        [Category]              NVARCHAR(60)   NOT NULL,
        [CustomerMessage]       NVARCHAR(500)  NOT NULL,
        [PreferredResponse]     NVARCHAR(MAX)  NOT NULL,
        [Notes]                 NVARCHAR(500)  NULL,
        [Priority]              INT            NOT NULL
            CONSTRAINT [DF_TblSalonBrandVoiceExample_Priority] DEFAULT (100),
        [IsActive]              BIT            NOT NULL
            CONSTRAINT [DF_TblSalonBrandVoiceExample_IsActive] DEFAULT (1),
        [CreatedAt]             DATETIME2(3)   NOT NULL
            CONSTRAINT [DF_TblSalonBrandVoiceExample_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]             DATETIME2(3)   NULL,
        CONSTRAINT [PK_TblSalonBrandVoiceExample] PRIMARY KEY CLUSTERED ([ExampleID])
    );
    PRINT N'Created TblSalonBrandVoiceExample';
END
ELSE
    PRINT N'TblSalonBrandVoiceExample already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblSalonBrandVoiceExample_Category_Active'
      AND object_id = OBJECT_ID(N'dbo.TblSalonBrandVoiceExample')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblSalonBrandVoiceExample_Category_Active]
        ON [dbo].[TblSalonBrandVoiceExample] ([Category], [IsActive], [Priority]);
END
GO

-- Knowledge sources (future import adapters; not authoritative until reviewed)
IF OBJECT_ID(N'dbo.TblSalonKnowledgeSource', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblSalonKnowledgeSource] (
        [SourceID]              BIGINT         IDENTITY(1,1) NOT NULL,
        [SourceName]            NVARCHAR(200)  NOT NULL,
        [SourceType]            NVARCHAR(40)   NOT NULL,
        [UrlOrRef]              NVARCHAR(1000) NULL,
        [BranchCode]            NVARCHAR(50)   NULL,
        [Active]                BIT            NOT NULL
            CONSTRAINT [DF_TblSalonKnowledgeSource_Active] DEFAULT (1),
        [LastReviewedAt]        DATETIME2(3)   NULL,
        [Notes]                 NVARCHAR(500)  NULL,
        [CreatedAt]             DATETIME2(3)   NOT NULL
            CONSTRAINT [DF_TblSalonKnowledgeSource_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]             DATETIME2(3)   NULL,
        CONSTRAINT [PK_TblSalonKnowledgeSource] PRIMARY KEY CLUSTERED ([SourceID])
    );
    PRINT N'Created TblSalonKnowledgeSource';
END
ELSE
    PRINT N'TblSalonKnowledgeSource already exists';
GO

-- Knowledge: normalized subject + optional source id
IF COL_LENGTH(N'dbo.TblSalonKnowledge', N'NormalizedSubject') IS NULL
    ALTER TABLE [dbo].[TblSalonKnowledge] ADD [NormalizedSubject] NVARCHAR(400) NULL;
GO
IF COL_LENGTH(N'dbo.TblSalonKnowledge', N'SourceId') IS NULL
    ALTER TABLE [dbo].[TblSalonKnowledge] ADD [SourceId] BIGINT NULL;
GO
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblSalonKnowledge_NormalizedSubject'
      AND object_id = OBJECT_ID(N'dbo.TblSalonKnowledge')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblSalonKnowledge_NormalizedSubject]
        ON [dbo].[TblSalonKnowledge] ([NormalizedSubject], [Status]);
END
GO

-- Capability: employee display names (curated; not quality ranking)
IF COL_LENGTH(N'dbo.TblSalonCapability', N'EmployeeNamesJson') IS NULL
    ALTER TABLE [dbo].[TblSalonCapability] ADD [EmployeeNamesJson] NVARCHAR(500) NULL;
GO

-- Offers: priority
IF COL_LENGTH(N'dbo.TblSalonOffer', N'Priority') IS NULL
    ALTER TABLE [dbo].[TblSalonOffer] ADD [Priority] INT NOT NULL
        CONSTRAINT [DF_TblSalonOffer_Priority] DEFAULT (100);
GO

-- Gaps: operator status
IF COL_LENGTH(N'dbo.TblSalonKnowledgeGap', N'Status') IS NULL
    ALTER TABLE [dbo].[TblSalonKnowledgeGap] ADD [Status] NVARCHAR(20) NOT NULL
        CONSTRAINT [DF_TblSalonKnowledgeGap_Status] DEFAULT (N'open');
GO
IF COL_LENGTH(N'dbo.TblSalonKnowledgeGap', N'UpdatedAt') IS NULL
    ALTER TABLE [dbo].[TblSalonKnowledgeGap] ADD [UpdatedAt] DATETIME2(3) NULL;
GO

-- Links: type + branch lookup
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblSalonExternalLink_Type_Branch_Status'
      AND object_id = OBJECT_ID(N'dbo.TblSalonExternalLink')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblSalonExternalLink_Type_Branch_Status]
        ON [dbo].[TblSalonExternalLink] ([LinkType], [BranchCode], [Status]);
END
GO

-- Offers: status + validity
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblSalonOffer_Status_ValidTo'
      AND object_id = OBJECT_ID(N'dbo.TblSalonOffer')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblSalonOffer_Status_ValidTo]
        ON [dbo].[TblSalonOffer] ([Status], [ValidTo], [Priority]);
END
GO

-- Knowledge source FK (additive; only if both tables exist and constraint missing)
IF OBJECT_ID(N'dbo.TblSalonKnowledge', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.TblSalonKnowledgeSource', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.TblSalonKnowledge', N'SourceId') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblSalonKnowledge_Source'
   )
BEGIN
    ALTER TABLE [dbo].[TblSalonKnowledge] WITH NOCHECK
        ADD CONSTRAINT [FK_TblSalonKnowledge_Source]
        FOREIGN KEY ([SourceId]) REFERENCES [dbo].[TblSalonKnowledgeSource] ([SourceID]);
END
GO

-- Sources: type + active
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblSalonKnowledgeSource_Type_Active'
      AND object_id = OBJECT_ID(N'dbo.TblSalonKnowledgeSource')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblSalonKnowledgeSource_Type_Active]
        ON [dbo].[TblSalonKnowledgeSource] ([SourceType], [Active]);
END
GO

-- Gaps: status dashboard
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblSalonKnowledgeGap_Status_LastSeen'
      AND object_id = OBJECT_ID(N'dbo.TblSalonKnowledgeGap')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblSalonKnowledgeGap_Status_LastSeen]
        ON [dbo].[TblSalonKnowledgeGap] ([Status], [LastSeenAt] DESC);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UQ_TblSalonBrandVoiceExample_ScenarioKey'
      AND object_id = OBJECT_ID(N'dbo.TblSalonBrandVoiceExample')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UQ_TblSalonBrandVoiceExample_ScenarioKey]
        ON [dbo].[TblSalonBrandVoiceExample] ([ScenarioKey]);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UQ_TblSalonKnowledgeSource_Name'
      AND object_id = OBJECT_ID(N'dbo.TblSalonKnowledgeSource')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UQ_TblSalonKnowledgeSource_Name]
        ON [dbo].[TblSalonKnowledgeSource] ([SourceName]);
END
GO

PRINT N'Salon Concierge Brain V1.1 additive schema ready';
GO
