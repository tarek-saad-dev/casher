-- ============================================================
-- Migration: Salon Concierge Brain V1 knowledge tables
-- Idempotent. Safe to re-run.
-- Curated brand knowledge ONLY — live ERP remains authority for
-- prices / hours / availability / employees.
-- ============================================================
SET NOCOUNT ON;

-- Knowledge items (FAQ, directions, brand copy, policies, …)
IF OBJECT_ID(N'dbo.TblSalonKnowledge', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblSalonKnowledge] (
        [KnowledgeID]           BIGINT         IDENTITY(1,1) NOT NULL,
        [ItemKey]               NVARCHAR(120)  NOT NULL,
        [Category]              NVARCHAR(60)   NOT NULL,
        [BranchID]              INT            NULL,
        [BranchCode]            NVARCHAR(50)   NULL,
        [EmployeeID]            INT            NULL,
        [Language]              NVARCHAR(10)   NOT NULL
            CONSTRAINT [DF_TblSalonKnowledge_Language] DEFAULT (N'ar'),
        [Title]                 NVARCHAR(300)  NOT NULL,
        [Subject]               NVARCHAR(500)  NULL,
        [AnswerText]            NVARCHAR(MAX)  NOT NULL,
        [AliasesJson]           NVARCHAR(MAX)  NULL,
        [TagsJson]              NVARCHAR(MAX)  NULL,
        [Source]                NVARCHAR(40)   NOT NULL
            CONSTRAINT [DF_TblSalonKnowledge_Source] DEFAULT (N'curated'),
        [Status]                NVARCHAR(20)   NOT NULL
            CONSTRAINT [DF_TblSalonKnowledge_Status] DEFAULT (N'active'),
        [Priority]              INT            NOT NULL
            CONSTRAINT [DF_TblSalonKnowledge_Priority] DEFAULT (100),
        [ValidFrom]             DATETIME2(3)   NULL,
        [ValidTo]               DATETIME2(3)   NULL,
        [NormalizedSubject]     NVARCHAR(400)  NULL,
        [SourceId]              BIGINT         NULL,
        [CreatedAt]             DATETIME2(3)   NOT NULL
            CONSTRAINT [DF_TblSalonKnowledge_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]             DATETIME2(3)   NULL,
        CONSTRAINT [PK_TblSalonKnowledge] PRIMARY KEY CLUSTERED ([KnowledgeID]),
        CONSTRAINT [UQ_TblSalonKnowledge_ItemKey] UNIQUE ([ItemKey]),
        CONSTRAINT [CK_TblSalonKnowledge_Status] CHECK ([Status] IN (N'active', N'draft', N'inactive')),
        CONSTRAINT [CK_TblSalonKnowledge_Source] CHECK ([Source] IN (N'curated', N'imported', N'erp_mirror'))
    );
    PRINT N'Created TblSalonKnowledge';
END
ELSE
    PRINT N'TblSalonKnowledge already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblSalonKnowledge_Category_Status'
      AND object_id = OBJECT_ID(N'dbo.TblSalonKnowledge')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblSalonKnowledge_Category_Status]
        ON [dbo].[TblSalonKnowledge] ([Category], [Status], [Priority]);
END
GO

-- Capabilities / expertise
IF OBJECT_ID(N'dbo.TblSalonCapability', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblSalonCapability] (
        [CapabilityID]          BIGINT         IDENTITY(1,1) NOT NULL,
        [CapabilityKey]         NVARCHAR(120)  NOT NULL,
        [DisplayNameAr]         NVARCHAR(200)  NOT NULL,
        [AliasesJson]           NVARCHAR(MAX)  NULL,
        [DescriptionAr]         NVARCHAR(MAX)  NULL,
        [ServiceIdsJson]        NVARCHAR(500)  NULL,
        [EmployeeIdsJson]       NVARCHAR(500)  NULL,
        [EmployeeNamesJson]     NVARCHAR(500)  NULL,
        [BranchCodesJson]       NVARCHAR(500)  NULL,
        [Status]                NVARCHAR(20)   NOT NULL
            CONSTRAINT [DF_TblSalonCapability_Status] DEFAULT (N'active'),
        [CreatedAt]             DATETIME2(3)   NOT NULL
            CONSTRAINT [DF_TblSalonCapability_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]             DATETIME2(3)   NULL,
        CONSTRAINT [PK_TblSalonCapability] PRIMARY KEY CLUSTERED ([CapabilityID]),
        CONSTRAINT [UQ_TblSalonCapability_Key] UNIQUE ([CapabilityKey]),
        CONSTRAINT [CK_TblSalonCapability_Status] CHECK ([Status] IN (N'active', N'draft', N'inactive'))
    );
    PRINT N'Created TblSalonCapability';
END
ELSE
    PRINT N'TblSalonCapability already exists';
GO

-- External links (website, maps, social)
IF OBJECT_ID(N'dbo.TblSalonExternalLink', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblSalonExternalLink] (
        [LinkID]                BIGINT         IDENTITY(1,1) NOT NULL,
        [LinkKey]               NVARCHAR(120)  NOT NULL,
        [LinkType]              NVARCHAR(40)   NOT NULL,
        [BranchID]              INT            NULL,
        [BranchCode]            NVARCHAR(50)   NULL,
        [LabelAr]               NVARCHAR(200)  NOT NULL,
        [Url]                   NVARCHAR(1000) NOT NULL,
        [Status]                NVARCHAR(20)   NOT NULL
            CONSTRAINT [DF_TblSalonExternalLink_Status] DEFAULT (N'active'),
        [CreatedAt]             DATETIME2(3)   NOT NULL
            CONSTRAINT [DF_TblSalonExternalLink_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]             DATETIME2(3)   NULL,
        CONSTRAINT [PK_TblSalonExternalLink] PRIMARY KEY CLUSTERED ([LinkID]),
        CONSTRAINT [UQ_TblSalonExternalLink_Key] UNIQUE ([LinkKey]),
        CONSTRAINT [CK_TblSalonExternalLink_Status] CHECK ([Status] IN (N'active', N'inactive'))
    );
    PRINT N'Created TblSalonExternalLink';
END
ELSE
    PRINT N'TblSalonExternalLink already exists';
GO

-- Offers / promotions
IF OBJECT_ID(N'dbo.TblSalonOffer', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblSalonOffer] (
        [OfferID]               BIGINT         IDENTITY(1,1) NOT NULL,
        [OfferKey]              NVARCHAR(120)  NOT NULL,
        [TitleAr]               NVARCHAR(300)  NOT NULL,
        [DescriptionAr]         NVARCHAR(MAX)  NOT NULL,
        [BranchCodesJson]       NVARCHAR(500)  NULL,
        [ServiceIdsJson]        NVARCHAR(500)  NULL,
        [ValidFrom]             DATETIME2(3)   NULL,
        [ValidTo]               DATETIME2(3)   NULL,
        [Status]                NVARCHAR(20)   NOT NULL
            CONSTRAINT [DF_TblSalonOffer_Status] DEFAULT (N'active'),
        [Priority]              INT            NOT NULL
            CONSTRAINT [DF_TblSalonOffer_Priority] DEFAULT (100),
        [CreatedAt]             DATETIME2(3)   NOT NULL
            CONSTRAINT [DF_TblSalonOffer_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]             DATETIME2(3)   NULL,
        CONSTRAINT [PK_TblSalonOffer] PRIMARY KEY CLUSTERED ([OfferID]),
        CONSTRAINT [UQ_TblSalonOffer_Key] UNIQUE ([OfferKey]),
        CONSTRAINT [CK_TblSalonOffer_Status] CHECK ([Status] IN (N'active', N'inactive', N'draft'))
    );
    PRINT N'Created TblSalonOffer';
END
ELSE
    PRINT N'TblSalonOffer already exists';
GO

-- Brand voice profile (structured config, not a giant prompt dump)
IF OBJECT_ID(N'dbo.TblSalonBrandVoice', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblSalonBrandVoice] (
        [VoiceID]               BIGINT         IDENTITY(1,1) NOT NULL,
        [ProfileKey]            NVARCHAR(80)   NOT NULL,
        [ConfigJson]            NVARCHAR(MAX)  NOT NULL,
        [ExampleRepliesJson]    NVARCHAR(MAX)  NULL,
        [Status]                NVARCHAR(20)   NOT NULL
            CONSTRAINT [DF_TblSalonBrandVoice_Status] DEFAULT (N'active'),
        [CreatedAt]             DATETIME2(3)   NOT NULL
            CONSTRAINT [DF_TblSalonBrandVoice_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]             DATETIME2(3)   NULL,
        CONSTRAINT [PK_TblSalonBrandVoice] PRIMARY KEY CLUSTERED ([VoiceID]),
        CONSTRAINT [UQ_TblSalonBrandVoice_Key] UNIQUE ([ProfileKey]),
        CONSTRAINT [CK_TblSalonBrandVoice_Status] CHECK ([Status] IN (N'active', N'inactive'))
    );
    PRINT N'Created TblSalonBrandVoice';
END
ELSE
    PRINT N'TblSalonBrandVoice already exists';
GO

-- Knowledge gaps (aggregated, no full conversation dump)
IF OBJECT_ID(N'dbo.TblSalonKnowledgeGap', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblSalonKnowledgeGap] (
        [GapID]                 BIGINT         IDENTITY(1,1) NOT NULL,
        [NormalizedSubject]     NVARCHAR(300)  NOT NULL,
        [CategoryGuess]         NVARCHAR(60)   NULL,
        [HitCount]              INT            NOT NULL
            CONSTRAINT [DF_TblSalonKnowledgeGap_HitCount] DEFAULT (1),
        [FirstSeenAt]           DATETIME2(3)   NOT NULL
            CONSTRAINT [DF_TblSalonKnowledgeGap_FirstSeen] DEFAULT (SYSUTCDATETIME()),
        [LastSeenAt]            DATETIME2(3)   NOT NULL
            CONSTRAINT [DF_TblSalonKnowledgeGap_LastSeen] DEFAULT (SYSUTCDATETIME()),
        [Status]                NVARCHAR(20)   NOT NULL
            CONSTRAINT [DF_TblSalonKnowledgeGap_Status] DEFAULT (N'open'),
        [UpdatedAt]             DATETIME2(3)   NULL,
        CONSTRAINT [PK_TblSalonKnowledgeGap] PRIMARY KEY CLUSTERED ([GapID]),
        CONSTRAINT [UQ_TblSalonKnowledgeGap_Subject] UNIQUE ([NormalizedSubject])
    );
    PRINT N'Created TblSalonKnowledgeGap';
END
ELSE
    PRINT N'TblSalonKnowledgeGap already exists';
GO

PRINT N'Salon Concierge Brain V1 schema ready';
GO

-- Voice examples + knowledge sources (also in add-tbl-salon-concierge-v11.sql for existing DBs)
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
END
GO

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
END
GO

